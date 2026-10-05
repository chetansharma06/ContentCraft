from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.api.schemas import (
    AuditRead,
    ContentStatusResponse,
    RejectionRequest,
)
from app.db.models import AuditLog, ContentItem, QCResult
from app.db.session import get_session

router = APIRouter(tags=["review and audit"])


@router.post("/content/{content_id}/approve", response_model=ContentStatusResponse)
def approve_content(
    content_id: int,
    reviewed_by: str = Query(default="system", min_length=1, max_length=200),
    session: Session = Depends(get_session),
) -> ContentStatusResponse:
    content = session.get(ContentItem, content_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Content item not found")
    latest_qc = session.exec(
        select(QCResult)
        .where(QCResult.content_item_id == content_id)
        .order_by(QCResult.checked_at.desc(), QCResult.id.desc())
    ).first()
    if content.approval_status != "QC_PASSED" or latest_qc is None or latest_qc.status != "QC_PASSED":
        raise HTTPException(status_code=409, detail="Only QC_PASSED content can be approved")

    content.approval_status = "APPROVED"
    session.add(content)
    session.add(
        AuditLog(
            action="content.approved",
            entity_type="content_item",
            entity_id=str(content_id),
            details={"reviewed_by": reviewed_by, "qc_result_id": latest_qc.id},
        )
    )
    session.commit()
    return ContentStatusResponse(content_id=content_id, status="APPROVED")


@router.post("/content/{content_id}/unapprove", response_model=ContentStatusResponse)
def unapprove_content(
    content_id: int,
    reviewed_by: str = Query(default="system", min_length=1, max_length=200),
    session: Session = Depends(get_session),
) -> ContentStatusResponse:
    content = session.get(ContentItem, content_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Content item not found")
    if content.approval_status != "APPROVED":
        raise HTTPException(status_code=409, detail="Only approved content can be unapproved")

    latest_qc = session.exec(
        select(QCResult)
        .where(QCResult.content_item_id == content_id)
        .order_by(QCResult.checked_at.desc(), QCResult.id.desc())
    ).first()
    if latest_qc is None or latest_qc.status != "QC_PASSED":
        raise HTTPException(status_code=409, detail="Content must still have a passing QC result")

    content.approval_status = "QC_PASSED"
    session.add(content)
    session.add(
        AuditLog(
            action="content.approval_undone",
            entity_type="content_item",
            entity_id=str(content_id),
            details={"reviewed_by": reviewed_by, "qc_result_id": latest_qc.id},
        )
    )
    session.commit()
    return ContentStatusResponse(content_id=content_id, status="QC_PASSED")


@router.post("/content/{content_id}/reject", response_model=ContentStatusResponse)
def reject_content(
    content_id: int,
    request: RejectionRequest,
    session: Session = Depends(get_session),
) -> ContentStatusResponse:
    content = session.get(ContentItem, content_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Content item not found")
    if content.approval_status in {"PUBLISHED", "REJECTED"}:
        raise HTTPException(status_code=409, detail="Content cannot be rejected in its current state")

    content.approval_status = "REJECTED"
    session.add(content)
    session.add(
        AuditLog(
            action="content.rejected",
            entity_type="content_item",
            entity_id=str(content_id),
            details={"reviewed_by": request.reviewed_by, "reason": request.reason},
        )
    )
    session.commit()
    return ContentStatusResponse(content_id=content_id, status="REJECTED")


@router.get("/audit", response_model=list[AuditRead])
def list_audit_logs(
    action: str | None = None,
    entity_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> list[AuditLog]:
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        query = query.where(AuditLog.action == action)
    if entity_id:
        query = query.where(AuditLog.entity_id == entity_id)
    return session.exec(query.offset(offset).limit(limit)).all()