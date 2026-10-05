from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, false, or_
from sqlmodel import Session, select

from app.api.jobs import _session_factory_for
from app.api.schemas import (
    ContentDetail,
    ContentEditRequest,
    ContentListItem,
    ContentStatus,
    ContentVersionRead,
    QCRead,
    QCRulesRead,
)
from app.db.models import AuditLog, ContentItem, ContentVersion, GenerationJob, Product, QCResult
from app.db.session import get_session
from app.qc.pipeline import QCPipeline

router = APIRouter(prefix="/content", tags=["content"])


def _content_detail(session: Session, content: ContentItem) -> ContentDetail:
    job = session.get(GenerationJob, content.generation_job_id) if content.generation_job_id else None
    latest_qc = session.exec(
        select(QCResult)
        .where(QCResult.content_item_id == content.id)
        .order_by(QCResult.checked_at.desc(), QCResult.id.desc())
    ).first()
    versions = session.exec(
        select(ContentVersion)
        .where(ContentVersion.content_item_id == content.id)
        .order_by(ContentVersion.version.desc())
    ).all()
    return ContentDetail(
        id=content.id,
        product_id=content.product_id,
        title=content.title,
        body=content.body,
        keywords=content.keywords,
        version=content.version,
        approval_status=content.approval_status,
        created_at=content.created_at,
        language=content.generation_context.get("language") or _language_from_prompt(job.prompt if job else None),
        content_type=content.generation_context.get("content_type", "product_description"),
        generation_job_id=content.generation_job_id,
        generation_context=content.generation_context,
        image_urls=content.image_urls,
        versions=[ContentVersionRead.model_validate(version) for version in versions],
        latest_qc=QCRead.model_validate(latest_qc) if latest_qc else None,
        qc_rules=_qc_rules(),
    )


def _language_from_prompt(prompt: str | None) -> str | None:
    marker = " content in "
    return prompt.rsplit(marker, maxsplit=1)[-1] if prompt and marker in prompt else None


@lru_cache(maxsize=1)
def _qc_rules() -> QCRulesRead:
    pipeline = QCPipeline()
    return QCRulesRead(
        banned_brand_terms=pipeline.banned_brand_terms,
        prohibited_claims=pipeline.prohibited_claims,
    )


@router.get("", response_model=list[ContentListItem])
def list_content(
    status: ContentStatus | None = Query(default=None),
    product_id: int | None = Query(default=None, gt=0),
    language: str | None = Query(default=None, min_length=1, max_length=100),
    content_type: str | None = Query(default=None, alias="type", min_length=1),
    flagged: bool | None = Query(default=None),
    sort_by: Literal["created_at", "title", "status"] = Query(default="created_at"),
    sort_order: Literal["asc", "desc"] = Query(default="desc"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> list[ContentListItem]:
    query = select(ContentItem, GenerationJob.prompt).outerjoin(
        GenerationJob,
        ContentItem.generation_job_id == GenerationJob.id,
    )
    if status:
        query = query.where(ContentItem.approval_status == status)
    if product_id:
        query = query.where(ContentItem.product_id == product_id)
    if language:
        context_language = ContentItem.generation_context["language"].as_string()
        query = query.where(
            or_(
                context_language == language,
                and_(
                    context_language.is_(None),
                    GenerationJob.prompt.endswith(f" content in {language}"),
                ),
            )
        )
    if content_type:
        context_type = ContentItem.generation_context["content_type"].as_string()
        if content_type == "product_description":
            query = query.where(or_(context_type == content_type, context_type.is_(None)))
        else:
            query = query.where(false())
    if flagged is True:
        query = query.where(ContentItem.approval_status == "QC_FLAGGED")
    elif flagged is False:
        query = query.where(ContentItem.approval_status != "QC_FLAGGED")

    sort_columns = {
        "created_at": ContentItem.created_at,
        "title": ContentItem.title,
        "status": ContentItem.approval_status,
    }
    sort_column = sort_columns[sort_by]
    ordering = sort_column.asc() if sort_order == "asc" else sort_column.desc()
    rows = session.exec(
        query.order_by(ordering, ContentItem.id.asc() if sort_order == "asc" else ContentItem.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [
        ContentListItem.model_validate(content).model_copy(
            update={
                "language": content.generation_context.get("language") or _language_from_prompt(prompt),
                "content_type": content.generation_context.get("content_type", "product_description"),
                "generation_context": content.generation_context,
            }
        )
        for content, prompt in rows
    ]


@router.get("/{content_id}", response_model=ContentDetail)
def get_content(content_id: int, session: Session = Depends(get_session)) -> ContentDetail:
    content = session.get(ContentItem, content_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Content item not found")
    return _content_detail(session, content)


@router.put("/{content_id}", response_model=ContentDetail)
def edit_content(
    content_id: int,
    request: ContentEditRequest,
    session: Session = Depends(get_session),
) -> ContentDetail:
    updates = request.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="Provide at least one content field to edit")
    if any(value is None for value in updates.values()):
        raise HTTPException(status_code=422, detail="Content fields cannot be null")

    content = session.get(ContentItem, content_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Content item not found")
    if content.approval_status == "PUBLISHED":
        raise HTTPException(status_code=409, detail="Published content cannot be edited")

    before = {
        "title": content.title,
        "body": content.body,
        "keywords": list(content.keywords),
        "version": content.version,
    }
    for field, value in updates.items():
        setattr(content, field, value)
    content.version += 1
    content.approval_status = "GENERATED"
    after = {
        "title": content.title,
        "body": content.body,
        "keywords": list(content.keywords),
        "version": content.version,
    }
    session.add(content)
    session.add(
        ContentVersion(
            content_item_id=content.id,
            version=content.version,
            snapshot=after,
        )
    )
    session.add(
        AuditLog(
            action="content.edited",
            entity_type="content_item",
            entity_id=str(content.id),
            details={"before": before, "after": after},
        )
    )
    session.commit()
    session.refresh(content)

    product = session.get(Product, content.product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Content product not found")
    pipeline = QCPipeline(session_factory=_session_factory_for(session.get_bind()))
    pipeline.run(content, product)
    session.refresh(content)
    return _content_detail(session, content)