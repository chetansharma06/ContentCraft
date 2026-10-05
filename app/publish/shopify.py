from collections.abc import Sequence

from app.db.models import ContentItem


def publish_to_shopify(items: Sequence[ContentItem]) -> None:
    raise NotImplementedError("Shopify publishing integration is not configured")