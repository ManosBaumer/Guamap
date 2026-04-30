"""Utilities: I/O, API client, deduplication."""
from .io import load_json, save_json, load_csv, save_csv
from .api_client import get_with_retry, rate_limited_get
