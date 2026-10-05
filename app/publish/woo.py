from collections.abc import Sequence

from app.db.models import ContentItem


def publish_to_woocommerce(items: Sequence[ContentItem]) -> None:
    raise NotImplementedError("WooCommerce publishing integration is not configured")