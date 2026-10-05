from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlmodel import Session, select

from app.api.schemas import AuditRead, OverviewRead, RecentJobRead
from app.db.models import AuditLog, ContentItem, GenerationJob, Product, QCResult
from app.db.session import get_session

router = APIRouter(tags=["overview"])
CONTENT_STATUSES = (
    "GENERATED",
    "QC_PASSED",
    "QC_FLAGGED",
    "APPROVED",
    "REJECTED",
    "PUBLISHED",
)


@router.get("/overview", response_model=OverviewRead)
def get_overview(session: Session = Depends(get_session)) -> OverviewRead:
    status_counts = {status: 0 for status in CONTENT_STATUSES}
    for status, count in session.exec(
        select(ContentItem.approval_status, func.count(ContentItem.id)).group_by(ContentItem.approval_status)
    ).all():
        status_counts[status] = count

    latest_qc_ids = (
        select(QCResult.content_item_id, func.max(QCResult.id).label("qc_id"))
        .group_by(QCResult.content_item_id)
        .subquery()
    )
    qc_counts = dict(
        session.exec(
            select(QCResult.status, func.count(QCResult.id))
            .join(latest_qc_ids, QCResult.id == latest_qc_ids.c.qc_id)
            .group_by(QCResult.status)
        ).all()
    )

    job_rows = session.exec(
        select(GenerationJob, Product.name)
        .join(Product, GenerationJob.product_id == Product.id)
        .order_by(GenerationJob.created_at.desc(), GenerationJob.id.desc())
        .limit(6)
    ).all()
    events = session.exec(
        select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(8)
    ).all()

    return OverviewRead(
        status_counts=status_counts,
        qc_passed=qc_counts.get("QC_PASSED", 0),
        qc_flagged=qc_counts.get("QC_FLAGGED", 0),
        recent_jobs=[
            RecentJobRead(
                id=job.id,
                product_id=job.product_id,
                product_name=product_name,
                status=job.status,
                progress=job.progress,
                error=job.error,
                created_at=job.created_at,
                completed_at=job.completed_at,
            )
            for job, product_name in job_rows
        ],
        recent_events=[AuditRead.model_validate(event) for event in events],
    )