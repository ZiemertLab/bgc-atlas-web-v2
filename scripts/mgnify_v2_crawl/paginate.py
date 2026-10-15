"""Paginated iterator for v2 list endpoints (``{"count": int, "items": [...]}``)."""

from typing import Iterator

from scripts.mgnify_v2_crawl import config
from scripts.mgnify_v2_crawl.client import get_json


def iter_pages(path, params=None, *, page_size=config.PAGE_SIZE, get=get_json) -> Iterator[dict]:
    """Stops at the declared ``count`` or at an empty page, in case ``count`` is stale."""
    base_params = dict(params or {})
    page = 1
    count = None
    yielded = 0

    while True:
        page_params = dict(base_params)
        page_params["page"] = page
        page_params["page_size"] = page_size

        body = get(path, params=page_params)
        # 404 -> end of collection.
        if body is None:
            break
        if count is None:
            count = body.get("count") or 0

        items = body.get("items", []) or []
        if not items:
            break

        for item in items:
            yield item
            yielded += 1

        if page * page_size >= count or yielded >= count:
            break
        page += 1
