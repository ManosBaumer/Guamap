"""Utilities: I/O, API client, deduplication, notifications.

Import submodules directly, e.g. `from utils.notify import notify`.
Avoid re-exporting heavy deps here so scrape-only installs (requirements-scrape.txt)
do not require pandas.
"""
