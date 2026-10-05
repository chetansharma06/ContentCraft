from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from collections.abc import Mapping
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Streamlit adds this script's directory ahead of the project root; keep the
# dashboard filename from shadowing the application's `app` package.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
loaded_app = sys.modules.get("app")
if getattr(loaded_app, "__file__", None) == __file__:
    del sys.modules["app"]

import streamlit as st
from sqlmodel import Session, select

from app.api.dependencies import get_content_generator
from app.db.models import ContentItem, ContentVersion, GenerationJob, Product, QCResult
from app.db.session import create_db, engine
from app.generation.schemas import AdCopy, AltText, EmailCampaign
from app.i18n import (
    convert_currency,
    convert_measurement,
    measurement_units,
    translate,
)
from app.qc.pipeline import QCPipeline


CONTENT_TEMPLATES: Mapping[str, tuple[str, str]] = {
    "Ad copy": ("ad_copy.j2", "ad_copy"),
    "Email campaign": ("email_campaign.j2", "email_campaign"),
    "Image alt text": ("alt_text.j2", "alt_text"),
}
CONTENT_LABEL_KEYS = {
    "Ad copy": "ad_copy",
    "Email campaign": "email_campaign",
    "Image alt text": "alt_text",
}
STATUS_ORDER = {
    "QC_FLAGGED": 0,
    "GENERATED": 1,
    "QC_PASSED": 2,
    "REJECTED": 3,
    "APPROVED": 4,
    "PUBLISHED": 5,
}


class DashboardAPIError(RuntimeError):
    pass


def _api_request(
    base_url: str,
    path: str,
    method: str = "GET",
    payload: dict | None = None,
    upload: tuple[str, bytes, str] | None = None,
) -> dict | list | bytes:
    headers: dict[str, str] = {"Accept": "application/json"}
    data = None
    if upload is not None:
        file_name, file_data, media_type = upload
        boundary = f"ContentCraft{uuid.uuid4().hex}"
        data = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\n'
            f"Content-Type: {media_type}\r\n\r\n"
        ).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("ascii")
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=30) as response:
            response_data = response.read()
            content_type = response.headers.get("Content-Type", "")
    except HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(message).get("detail", message)
        except (json.JSONDecodeError, AttributeError):
            detail = message
        raise DashboardAPIError(f"HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise DashboardAPIError(f"Could not connect to the API: {error.reason}") from error

    if "json" in content_type:
        return json.loads(response_data)
    return response_data


def _load_products() -> list[Product]:
    with Session(engine) as session:
        return session.exec(select(Product).order_by(Product.id.desc())).all()


def _generate_extra_content(
    product_id: int,
    content_type: str,
    language: str,
) -> tuple[ContentItem, str, list[str]]:
    template_name, context_type = CONTENT_TEMPLATES[content_type]
    with Session(engine, expire_on_commit=False) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise ValueError("Product not found")
        job = GenerationJob(
            product_id=product_id,
            prompt=f"Generate {context_type} content in {language}",
            status="running",
        )
        session.add(job)
        session.commit()
        session.refresh(job)

        generator = get_content_generator()
        generated = asyncio.run(
            generator.generate(
                product,
                template_name=template_name,
                language=language,
            )
        )
        values = generated.model_dump()
        if isinstance(generated, AdCopy):
            title = values["headline"]
            body = f"{values['primary_text']}\n\n{values['call_to_action']}"
        elif isinstance(generated, EmailCampaign):
            title = values["subject_line"]
            body = (
                f"{values['preview_text']}\n\n{values['body']}\n\n"
                f"{values['call_to_action']}"
            )
        elif isinstance(generated, AltText):
            title = f"Alt text: {product.name}"
            body = values["alt_text"]
        else:
            raise TypeError(f"Unsupported generated content schema: {type(generated).__name__}")

        job.status = "completed"
        job.progress = 100
        session.add(job)
        item = ContentItem(
            product_id=product_id,
            generation_job_id=job.id,
            title=title,
            body=body,
            keywords=list(product.keywords),
            generation_context={
                "content_type": context_type,
                "language": language,
                "generated_fields": json.dumps(values, ensure_ascii=False),
            },
        )
        session.add(item)
        session.flush()
        session.add(
            ContentVersion(
                content_item_id=item.id,
                version=1,
                snapshot={
                    "title": item.title,
                    "body": item.body,
                    "keywords": list(item.keywords),
                    "generation_context": dict(item.generation_context),
                },
            )
        )
        session.commit()
        session.refresh(item)
        session.refresh(product)
        content_id = item.id

    try:
        report = QCPipeline().run(item, product, requested_language=language)
        return item, report.status, report.issues
    except Exception as error:
        with Session(engine) as session:
            stored = session.get(ContentItem, content_id)
            if stored is not None:
                stored.approval_status = "QC_FLAGGED"
                session.add(stored)
                session.add(
                    QCResult(
                        content_item_id=content_id,
                        status="QC_FLAGGED",
                        score=0,
                        issues=[f"QC execution failed: {error}"],
                    )
                )
                session.commit()
        return item, "QC_FLAGGED", [f"QC execution failed: {error}"]


def _upload_page(api_url: str, language: str) -> None:
    tr = lambda key: translate(language, key)
    st.subheader(tr("upload_title"))
    uploaded_file = st.file_uploader(
        tr("choose_file"),
        type=["csv", "xlsx"],
        key="product_upload",
    )
    if st.button(tr("upload_button"), type="primary", disabled=uploaded_file is None):
        try:
            response = _api_request(
                api_url,
                "/products/upload",
                method="POST",
                upload=(
                    uploaded_file.name,
                    uploaded_file.getvalue(),
                    uploaded_file.type or "application/octet-stream",
                ),
            )
            st.success(f"{tr('inserted')}: {response['inserted_count']}")
            if response["rejected_rows"]:
                st.warning(tr("rejected_rows"))
                st.dataframe(response["rejected_rows"], width="stretch")
        except (DashboardAPIError, KeyError, TypeError) as error:
            st.error(f"{tr('api_error')}: {error}")


def _generation_page(api_url: str, language: str) -> None:
    tr = lambda key: translate(language, key)
    st.subheader(tr("generation_title"))
    products = _load_products()
    if not products:
        st.info(tr("no_products"))
        return

    product_options = {
        product.id: f"{product.name} (#{product.id})"
        for product in products
    }
    selected_ids = st.multiselect(
        tr("products"),
        options=list(product_options),
        format_func=product_options.get,
    )
    content_type = st.selectbox(
        tr("content_type"),
        [tr("description"), tr("ad_copy"), tr("email_campaign"), tr("alt_text")],
    )
    categories = {
        tr("category_beauty"): "beauty",
        tr("category_fashion"): "fashion",
        tr("category_home_kitchen"): "home_kitchen",
    }
    category_label = st.selectbox(tr("category"), list(categories))

    if st.button(tr("generate_button"), type="primary", disabled=not selected_ids):
        generated_language = "Hindi" if language == "Hindi" else "English"
        try:
            if content_type == tr("description"):
                response = _api_request(
                    api_url,
                    "/jobs",
                    method="POST",
                    payload={
                        "product_ids": selected_ids,
                        "category": categories[category_label],
                        "language": generated_language,
                    },
                )
                st.success(f"{tr('job_created')}: {len(response['jobs'])}")
                st.dataframe(response["jobs"], width="stretch")
            else:
                content_key = next(
                    key for key in CONTENT_TEMPLATES
                    if tr(CONTENT_LABEL_KEYS[key]) == content_type
                )
                results = []
                with st.spinner(tr("generate_button")):
                    for product_id in selected_ids:
                        item, qc_status, issues = _generate_extra_content(
                            product_id,
                            content_key,
                            generated_language,
                        )
                        results.append(
                            {
                                "id": item.id,
                                "title": item.title,
                                "status": qc_status,
                                "issues": "; ".join(issues),
                            }
                        )
                st.success(tr("extra_generated"))
                st.dataframe(results, width="stretch")
        except (DashboardAPIError, KeyError, TypeError, ValueError, RuntimeError) as error:
            st.error(f"{tr('api_error')}: {error}")


def _review_page(api_url: str, language: str) -> None:
    tr = lambda key: translate(language, key)
    st.subheader(tr("queue_title"))
    try:
        content = _api_request(api_url, "/content?limit=200")
    except DashboardAPIError as error:
        st.error(f"{tr('api_error')}: {error}")
        return

    content.sort(key=lambda item: (STATUS_ORDER.get(item["approval_status"], 9), -item["id"]))
    if not content:
        st.info(tr("no_content"))
        return

    st.dataframe(
        [
            {
                "ID": item["id"],
                tr("edit_title"): item["title"],
                tr("status"): item["approval_status"],
                tr("products"): item["product_id"],
            }
            for item in content
        ],
        width="stretch",
        hide_index=True,
    )
    selected_id = st.selectbox(
        tr("queue_title"),
        options=[item["id"] for item in content],
        format_func=lambda item_id: next(
            f"#{item['id']} · {item['approval_status']} · {item['title']}"
            for item in content if item["id"] == item_id
        ),
    )
    try:
        detail = _api_request(api_url, f"/content/{selected_id}")
    except DashboardAPIError as error:
        st.error(f"{tr('api_error')}: {error}")
        return

    status = detail["approval_status"]
    qc = detail.get("latest_qc")
    summary = st.columns(3)
    summary[0].metric(tr("status"), status)
    summary[1].metric(tr("qc_status"), qc["status"] if qc else "Not run")
    summary[2].metric(tr("score"), qc["score"] if qc and qc["score"] is not None else "-")
    if qc and qc["issues"]:
        st.warning("\n".join(f"- {issue}" for issue in qc["issues"]))

    with st.form(f"edit_content_{selected_id}"):
        title = st.text_input(tr("edit_title"), value=detail["title"])
        body = st.text_area(tr("edit_body"), value=detail["body"], height=180)
        keywords = st.text_input(tr("keywords"), value=", ".join(detail["keywords"]))
        save = st.form_submit_button(tr("save_edit"))
    if save:
        try:
            result = _api_request(
                api_url,
                f"/content/{selected_id}",
                method="PUT",
                payload={
                    "title": title,
                    "body": body,
                    "keywords": [word.strip() for word in keywords.split(",") if word.strip()],
                },
            )
            st.success(f"{tr('qc_status')}: {result['approval_status']}")
            st.rerun()
        except DashboardAPIError as error:
            st.error(f"{tr('api_error')}: {error}")

    action_columns = st.columns(2)
    if action_columns[0].button(
        tr("approve"),
        disabled=status != "QC_PASSED",
        key=f"approve_{selected_id}",
    ):
        try:
            _api_request(api_url, f"/content/{selected_id}/approve", method="POST")
            st.success(tr("approve"))
            st.rerun()
        except DashboardAPIError as error:
            st.error(f"{tr('api_error')}: {error}")
    if status == "QC_PASSED":
        action_columns[0].caption(tr("qc_required"))

    with action_columns[1].form(f"reject_content_{selected_id}"):
        reason = st.text_input(tr("reject_reason"), key=f"reject_reason_{selected_id}")
        reject = st.form_submit_button(
            tr("reject"),
            disabled=status in {"PUBLISHED", "REJECTED"} or not reason.strip(),
        )
    if reject:
        try:
            _api_request(
                api_url,
                f"/content/{selected_id}/reject",
                method="POST",
                payload={"reason": reason},
            )
            st.success(tr("reject"))
            st.rerun()
        except DashboardAPIError as error:
            st.error(f"{tr('api_error')}: {error}")

    approved = [item for item in content if item["approval_status"] == "APPROVED"]
    st.divider()
    st.subheader(tr("approved_only"))
    approved_options = {item["id"]: f"#{item['id']} · {item['title']}" for item in approved}
    selected_for_export = st.multiselect(
        tr("approved_only"),
        options=list(approved_options),
        format_func=approved_options.get,
        key="approved_export_ids",
    )
    if st.button(tr("publish_csv"), disabled=not selected_for_export):
        try:
            csv_data = _api_request(
                api_url,
                "/publish",
                method="POST",
                payload={"content_ids": selected_for_export, "destination": "csv"},
            )
            st.session_state["approved_csv"] = csv_data
            st.success(tr("download_csv"))
            st.rerun()
        except DashboardAPIError as error:
            st.error(f"{tr('api_error')}: {error}")
    if st.session_state.get("approved_csv"):
        st.download_button(
            tr("download_csv"),
            data=st.session_state["approved_csv"],
            file_name="contentcraft-approved.csv",
            mime="text/csv",
        )


def _audit_page(api_url: str, language: str) -> None:
    tr = lambda key: translate(language, key)
    st.subheader(tr("audit_title"))
    try:
        entries = _api_request(api_url, "/audit?limit=200")
        st.dataframe(entries, width="stretch", hide_index=True)
    except DashboardAPIError as error:
        st.error(f"{tr('api_error')}: {error}")


def _tools_page(language: str) -> None:
    tr = lambda key: translate(language, key)
    st.subheader(tr("tools_title"))
    currency_tab, measurement_tab = st.tabs([tr("currency"), tr("measurement")])
    with currency_tab:
        amount = st.number_input(tr("amount"), min_value=0.0, value=1.0)
        direction = st.selectbox(
            tr("currency_direction"),
            ["USD → INR", "INR → USD"],
        )
        rate = st.number_input(
            tr("exchange_rate"),
            min_value=0.000001,
            value=83.0,
            format="%.4f",
        )
        st.caption(tr("manual_rate_note"))
        source, target = direction.split(" → ")
        converted = convert_currency(amount, source, target, rate)
        st.metric(tr("converted_amount"), f"{target} {converted:,.2f}")

    with measurement_tab:
        dimension_labels = {
            tr("length"): "length",
            tr("mass"): "mass",
            tr("volume"): "volume",
        }
        dimension = st.selectbox(tr("dimension"), list(dimension_labels))
        units = measurement_units(dimension_labels[dimension])
        columns = st.columns(3)
        value = columns[0].number_input(tr("amount"), value=1.0, key="measurement_value")
        source_unit = columns[1].selectbox(tr("from_unit"), units)
        target_unit = columns[2].selectbox(
            tr("to_unit"),
            units,
            index=min(1, len(units) - 1),
        )
        converted_value = convert_measurement(value, source_unit, target_unit)
        st.metric(tr("measurement_result"), f"{converted_value:,.6g} {target_unit}")


def main() -> None:
    st.set_page_config(page_title="ContentCraft", layout="wide")
    create_db()
    language = st.sidebar.selectbox(
        translate("English", "language"),
        ["English", "Hindi"],
        index=0,
    )
    tr = lambda key: translate(language, key)
    api_url = st.sidebar.text_input(
        tr("api_url"),
        value=os.getenv("CONTENTCRAFT_API_URL", "http://127.0.0.1:8000"),
    )
    st.sidebar.divider()
    pages = [tr("upload"), tr("generate"), tr("review"), tr("audit"), tr("tools")]
    page = st.sidebar.radio(tr("title"), pages, label_visibility="collapsed")
    st.title(tr("title"))

    if page == tr("upload"):
        _upload_page(api_url, language)
    elif page == tr("generate"):
        _generation_page(api_url, language)
    elif page == tr("review"):
        _review_page(api_url, language)
    elif page == tr("audit"):
        _audit_page(api_url, language)
    else:
        _tools_page(language)


if __name__ == "__main__":
    main()
