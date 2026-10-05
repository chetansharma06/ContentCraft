import csv
from io import StringIO
from collections.abc import Iterable

from app.db.models import ContentItem


def export_approved_content(items: Iterable[ContentItem]) -> bytes:
    output = StringIO(newline="")
    writer = csv.DictWriter(
        output,
        fieldnames=("id", "product_id", "title", "body", "keywords"),
    )
    writer.writeheader()
    for item in items:
        if item.approval_status != "APPROVED":
            continue
        writer.writerow(
            {
                "id": item.id,
                "product_id": item.product_id,
                "title": item.title,
                "body": item.body,
                "keywords": "; ".join(item.keywords),
            }
        )
    return output.getvalue().encode("utf-8-sig")