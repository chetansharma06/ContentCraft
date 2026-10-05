from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select

from app.api.schemas import PublishRequest
from app.db.models import AuditLog, ContentItem
from app.db.session import get_session
from app.publish.csv_exporter import export_approved_content
from app.publish.shopify import publish_to_shopify
from app.publish.woo import publish_to_woocommerce

router = APIRouter(tags=["publishing"])


@router.post("/publish")
def publish_content(
    request: PublishRequest,
    session: Session = Depends(get_session),
) -> Response:
    content_ids = list(dict.fromkeys(request.content_ids))
    items = session.exec(
        select(ContentItem).where(ContentItem.id.in_(content_ids))
    ).all()
    items_by_id = {item.id: item for item in items}
    missing = [content_id for content_id in content_ids if content_id not in items_by_id]
    if missing:
        session.add(
            AuditLog(
                action="publish.blocked",
                entity_type="publish_request",
                details={"content_ids": missing, "reason": "content not found"},
            )
        )
        session.commit()
        raise HTTPException(status_code=404, detail=f"Content not found: {missing}")

    unapproved = [item for item in items if item.approval_status != "APPROVED"]
    if unapproved:
        for item in unapproved:
            session.add(
                AuditLog(
                    action="publish.blocked",
                    entity_type="content_item",
                    entity_id=str(item.id),
                    details={
                        "destination": request.destination,
                        "reason": "only APPROVED content can be published",
                        "status": item.approval_status,
                    },
                )
            )
        session.commit()
        raise HTTPException(status_code=409, detail="Only APPROVED content can be published")

    if request.destination == "shopify":
        session.add(
            AuditLog(
                action="publish.unavailable",
                entity_type="publish_request",
                details={"content_ids": content_ids, "destination": "shopify"},
            )
        )
        session.commit()
        try:
            publish_to_shopify(items)
        except NotImplementedError as error:
            raise HTTPException(status_code=501, detail=str(error)) from error
    if request.destination == "woocommerce":
        session.add(
            AuditLog(
                action="publish.unavailable",
                entity_type="publish_request",
                details={"content_ids": content_ids, "destination": "woocommerce"},
            )
        )
        session.commit()
        try:
            publish_to_woocommerce(items)
        except NotImplementedError as error:
            raise HTTPException(status_code=501, detail=str(error)) from error

    csv_content = export_approved_content(items)
    for item in items:
        item.approval_status = "PUBLISHED"
        session.add(item)
        session.add(
            AuditLog(
                action="content.published",
                entity_type="content_item",
                entity_id=str(item.id),
                details={"destination": "csv"},
            )
        )
    session.commit()
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=contentcraft-export.csv"},
    )