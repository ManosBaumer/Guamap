"""Shared API client: rate limiting and exponential backoff retry."""
import logging
import time
from typing import Any

import requests

from config import RATE_LIMIT_DELAY_MS, RETRY_BACKOFF_BASE_S, RETRY_MAX_ATTEMPTS

logger = logging.getLogger(__name__)


def rate_limited_get(url: str, params: dict[str, Any] | None = None, **kwargs) -> requests.Response:
    """GET request with rate limit delay before the call."""
    time.sleep(RATE_LIMIT_DELAY_MS / 1000.0)
    return requests.get(url, params=params or {}, timeout=30, **kwargs)


def get_with_retry(
    url: str,
    params: dict[str, Any] | None = None,
    **kwargs,
) -> requests.Response:
    """
    GET with rate limit and exponential backoff retry.
    Raises after RETRY_MAX_ATTEMPTS failed attempts.
    """
    params = params or {}
    last_exc = None
    for attempt in range(RETRY_MAX_ATTEMPTS):
        try:
            time.sleep(RATE_LIMIT_DELAY_MS / 1000.0)
            resp = requests.get(url, params=params, timeout=30, **kwargs)
            resp.raise_for_status()
            return resp
        except (requests.RequestException, OSError) as e:
            last_exc = e
            if attempt < RETRY_MAX_ATTEMPTS - 1:
                delay = RETRY_BACKOFF_BASE_S * (2 ** attempt)
                logger.warning("API request failed (attempt %s/%s), retry in %s s: %s",
                              attempt + 1, RETRY_MAX_ATTEMPTS, delay, e)
                time.sleep(delay)
    raise last_exc
