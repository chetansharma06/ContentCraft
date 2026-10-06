import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.api.dependencies import get_content_generator
from app.db.models import Product
from app.db.session import get_session
from app.generation.schemas import ProductDescription
from app.main import app


class DeterministicGenerator:
    async def generate_product_description(
        self,
        product: Product,
        category: str = "home_kitchen",
        tone: str | None = None,
        language: str | None = None,
        content_angle: str = "Emphasize the most relevant verified benefit.",
    ) -> ProductDescription:
        tone = tone or "clear"
        if "Lead with" in content_angle:
            angle_copy = "Feature layout organizes listed details without comparison."
        elif "Connect" in content_angle:
            angle_copy = "Use context describes an ordinary routine without claiming an outcome."
        else:
            angle_copy = "Value framing records supplied details without implying savings."

        tone_copy = {
            "warm": "Friendly wording keeps the description welcoming and clear for readers.",
            "confident": "Direct statements make the supplied details easy for shoppers to review.",
            "bright": "Upbeat phrasing gives the verified information an energetic rhythm.",
        }
        tone_key = next((key for key in tone_copy if key in tone), "warm")
        specification_text = "; ".join(
            f"{key.replace('_', ' ')}: {value}"
            for key, value in product.specifications.items()
        )
        keywords = ", ".join(product.keywords)
        body = (
            f"{product.name} is described as {product.description}. "
            f"Supplied specifications: {specification_text or 'none provided'}. "
            f"Provided search terms: {keywords or 'none provided'}. "
            f"{angle_copy} {tone_copy[tone_key]} "
            "This version contains only details in the product record."
        )
        return ProductDescription(
            title=f"{product.name}: {tone_key} {angle_copy.split()[0].lower()}",
            description=body,
            key_features=[f"{key.replace('_', ' ')}: {value}" for key, value in product.specifications.items()][:5],
            meta_description=f"Product details for {product.name}: {product.description}"[:160],
        )


@pytest.fixture
def api_client(tmp_path):
    database_engine = create_engine(
        f"sqlite:///{tmp_path / 'api.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(database_engine)

    def override_session():
        with Session(database_engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_content_generator] = lambda: DeterministicGenerator()
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    database_engine.dispose()


def test_api_upload_generation_review_publish_and_audit(api_client):
    csv_data = (
        "name,price,description,specifications,keywords\n"
        'Canvas Carry Bag,19.95,Reusable cotton bag,"{""material"": ""cotton""}",bag;reusable\n'
        ',5.00,Missing name,{},invalid\n'
    )
    upload = api_client.post(
        "/products/upload",
        files={"file": ("products.csv", csv_data.encode("utf-8"), "text/csv")},
    )

    assert upload.status_code == 201
    upload_result = upload.json()
    assert upload_result["inserted_count"] == 1
    assert upload_result["rejected_rows"][0]["reasons"] == ["Product name is required"]
    product_id = upload_result["products"][0]["id"]

    created = api_client.post("/jobs", json={"product_ids": [product_id]})
    assert created.status_code == 202
    job_id = created.json()["jobs"][0]["id"]
    job = api_client.get(f"/jobs/{job_id}")
    assert job.status_code == 200
    assert job.json()["progress"] == 100
    assert job.json()["status"] == "completed"

    content_response = api_client.get("/content", params={"product_id": product_id})
    assert content_response.status_code == 200
    content_items = content_response.json()
    assert len(content_items) == 9
    review_items = api_client.get(
        "/content",
        params={
            "language": "English",
            "type": "product_description",
            "flagged": "false",
            "sort_by": "title",
            "sort_order": "asc",
        },
    ).json()
    assert review_items
    assert all(item["language"] == "English" for item in review_items)
    assert all(item["content_type"] == "product_description" for item in review_items)
    assert [item["title"] for item in review_items] == sorted(item["title"] for item in review_items)
    flagged_items = api_client.get("/content", params={"flagged": "true"}).json()
    assert all(item["approval_status"] == "QC_FLAGGED" for item in flagged_items)
    passed = next(item for item in content_items if item["approval_status"] == "QC_PASSED")
    content_id = passed["id"]

    detail = api_client.get(f"/content/{content_id}")
    assert detail.status_code == 200
    assert len(detail.json()["versions"]) == 1
    assert detail.json()["qc_rules"]["banned_brand_terms"] == [
        "miracle cure",
        "guaranteed results",
        "risk-free",
    ]
    source_product = api_client.get(f"/products/{product_id}")
    assert source_product.status_code == 200
    assert source_product.json()["name"] == "Canvas Carry Bag"

    edited = api_client.put(
        f"/content/{content_id}",
        json={"body": detail.json()["body"] + " Manual editorial revision."},
    )
    assert edited.status_code == 200
    assert edited.json()["version"] == 2
    assert len(edited.json()["versions"]) == 2
    assert edited.json()["approval_status"] == "QC_PASSED"

    approved = api_client.post(f"/content/{content_id}/approve")
    assert approved.status_code == 200
    assert approved.json()["status"] == "APPROVED"
    undone = api_client.post(f"/content/{content_id}/unapprove")
    assert undone.status_code == 200
    assert undone.json()["status"] == "QC_PASSED"
    approved_again = api_client.post(f"/content/{content_id}/approve")
    assert approved_again.status_code == 200
    assert approved_again.json()["status"] == "APPROVED"

    published = api_client.post("/publish", json={"content_ids": [content_id]})
    assert published.status_code == 200
    assert "Canvas Carry Bag" in published.text
    assert api_client.get(f"/content/{content_id}").json()["approval_status"] == "PUBLISHED"

    unapproved_id = next(item["id"] for item in content_items if item["id"] != content_id)
    blocked = api_client.post("/publish", json={"content_ids": [unapproved_id]})
    assert blocked.status_code == 409

    rejected_id = next(
        item["id"] for item in content_items if item["id"] not in {content_id, unapproved_id}
    )
    rejected = api_client.post(
        f"/content/{rejected_id}/reject",
        json={"reason": "Brand review requested changes", "reviewed_by": "editor"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "REJECTED"

    audit = api_client.get("/audit")
    assert audit.status_code == 200
    actions = {entry["action"] for entry in audit.json()}
    assert {
        "content.edited",
        "content.approved",
        "content.approval_undone",
        "content.rejected",
        "content.published",
        "publish.blocked",
    } <= actions

    overview = api_client.get("/overview")
    assert overview.status_code == 200
    dashboard = overview.json()
    assert dashboard["status_counts"]["PUBLISHED"] == 1
    assert dashboard["qc_passed"] + dashboard["qc_flagged"] > 0
    assert any(job["product_name"] == "Canvas Carry Bag" for job in dashboard["recent_jobs"])
    assert any(event["action"] == "content.published" for event in dashboard["recent_events"])


def test_openapi_documents_swagger_routes(api_client):
    response = api_client.get("/openapi.json")

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/products/upload" in paths
    assert "/jobs/{job_id}" in paths
    assert "/content/{content_id}/approve" in paths
    assert "/publish" in paths


def test_cors_allows_the_development_frontend(api_client):
    response = api_client.options(
        "/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_generation_job_honors_selected_tones_and_content_angles(api_client):
    uploaded = api_client.post(
        "/products/upload",
        files={
            "file": (
                "one-product.csv",
                b"name,price,description,specifications,keywords\nDesk Lamp,20,Task lighting,{},lamp\n",
                "text/csv",
            )
        },
    )
    product_id = uploaded.json()["products"][0]["id"]

    created = api_client.post(
        "/jobs",
        json={
            "product_ids": [product_id],
            "tones": ["confident and concise"],
            "content_angles": ["emotional"],
        },
    )

    assert created.status_code == 202
    job_id = created.json()["jobs"][0]["id"]
    assert api_client.get(f"/jobs/{job_id}").json()["status"] == "completed"
    content = api_client.get("/content", params={"product_id": product_id}).json()
    assert len(content) == 1
    detail = api_client.get(f"/content/{content[0]['id']}").json()
    assert detail["generation_context"]["tone"] == "confident and concise"
    assert detail["generation_context"]["variant"] == "emotional-confident"