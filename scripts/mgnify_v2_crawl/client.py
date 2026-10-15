"""HTTP client for the MGnify v2 API.

  * 200            -> parsed JSON
  * 404            -> ``None`` (entity retired/absent; the caller decides)
  * 429/5xx, connection/timeout errors -> retry with backoff (honours ``Retry-After``)
  * other 4xx, or retries exhausted   -> ``CrawlError``
"""

import time

import requests

from scripts.mgnify_v2_crawl import config


class CrawlError(Exception):
    pass


# Patched by tests.
_sleep = time.sleep

# Tests may reset this to None to force a fresh (patched) session.
_SESSION = None

_RETRYABLE_STATUSES = frozenset({429, 503})


def _get_session():
    global _SESSION
    if _SESSION is None:
        _SESSION = requests.Session()
    return _SESSION


def _is_retryable_status(status):
    return status in _RETRYABLE_STATUSES or 500 <= status < 600


def _backoff_seconds(attempt, retry_after=None):
    """``attempt`` is the 1-based retry index."""
    if retry_after is not None:
        try:
            ra = int(retry_after)
            if ra >= 0:
                return ra
        except (TypeError, ValueError):
            pass
    base = min(config.BACKOFF_CAP, config.BACKOFF_BASE ** attempt)
    # Deterministic jitter in [0, 0.5) keeps tests reproducible.
    jitter = (attempt * 0.131) % 0.5
    return min(config.BACKOFF_CAP, base + jitter)


def get_json(path, params=None, *, session=None):
    sess = session if session is not None else _get_session()
    url = config.BASE_URL + path
    timeout = (config.CONNECT_TIMEOUT, config.READ_TIMEOUT)

    last_status = None
    for attempt in range(config.MAX_RETRIES + 1):
        try:
            resp = sess.get(url, params=params, timeout=timeout)
        except requests.RequestException as exc:
            last_status = f"exception:{exc.__class__.__name__}"
            if attempt < config.MAX_RETRIES:
                _sleep(_backoff_seconds(attempt + 1))
                continue
            raise CrawlError(
                f"GET {path} failed after {attempt + 1} attempts "
                f"(last error: {last_status})"
            ) from exc

        status = resp.status_code
        if status == 200:
            return resp.json()
        if status == 404:
            return None
        if _is_retryable_status(status):
            last_status = status
            if attempt < config.MAX_RETRIES:
                _sleep(_backoff_seconds(attempt + 1, resp.headers.get("Retry-After")))
                continue
            raise CrawlError(
                f"GET {path} failed after {attempt + 1} attempts "
                f"(last status: {status})"
            )
        raise CrawlError(f"GET {path} returned non-retryable status {status}")

    raise CrawlError(f"GET {path} failed (last status: {last_status})")
