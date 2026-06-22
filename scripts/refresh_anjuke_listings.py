#!/usr/bin/env python3
"""
Refresh Guangzhou Anjuke communities + listings for the React map.

Steps:
  1. Validate Anjuke browser cookie
  2. Incremental scrape (no transit API calls)
  3. Mark removed listings as off-market (【已下架】)
  4. Export frontend/public/data (communities + listings only)

Usage:
  ANJUKE_COOKIE='...' python scripts/refresh_anjuke_listings.py
  python scripts/refresh_anjuke_listings.py --cookie '...'
  python scripts/refresh_anjuke_listings.py --test-cookie-only
  python scripts/refresh_anjuke_listings.py --prepare-only
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

load_dotenv(ROOT / ".env")

from data_collection.anjuke import run_scrape, test_cookie
from anjuke_off_market import sync_off_market_after_scrape
from prepare_frontend_data import prepare_anjuke
from utils.github_progress import decompress_progress_archives, reset_retry_count
from utils.notify import notify, notify_exception


def resolve_cookie(args: argparse.Namespace) -> str:
    cookie = (args.cookie or os.environ.get("ANJUKE_COOKIE") or "").strip()
    if not cookie:
        raise SystemExit(
            "Missing Anjuke cookie. Set ANJUKE_COOKIE in .env or pass --cookie."
        )
    return cookie


def run_refresh(cookie: str, *, skip_prepare: bool) -> None:
    n = decompress_progress_archives()
    if n:
        print(f"Restored {n} compressed progress file(s) from anjuke-scrape-cache")

    notify("Anjuke refresh started", level="info")

    print("\n=== Scraping Anjuke (no transit) ===")
    total = run_scrape(cookie)
    print(f"Scraped {total} active listing rows.")

    print("\n=== Marking removed listings ===")
    stats = sync_off_market_after_scrape()
    summary = (
        f"Active: {stats.active_count}\n"
        f"Newly removed: {stats.newly_removed}\n"
        f"Off-market: {stats.total_off_market}\n"
        f"Saved tagged: {stats.saved_tagged}"
    )
    print(summary.replace("\n", " | "))

    if skip_prepare:
        print("Skipping frontend export (--skip-prepare).")
        notify(
            "Refresh scrape done (no export)",
            f"Listings: {stats.active_count}, removed: {stats.newly_removed}",
            level="success",
        )
        return

    print("\n=== Preparing frontend data ===")
    prepare_anjuke()
    print("\nAll done.")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        reset_retry_count()
    notify(
        "Refresh complete",
        f"Active: {stats.active_count}, removed: {stats.newly_removed}, scraped rows: {total}",
        level="success",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh Anjuke listings for Guamap")
    parser.add_argument("--cookie", help="Anjuke browser cookie string")
    parser.add_argument(
        "--test-cookie-only",
        action="store_true",
        help="Only validate the cookie, do not scrape",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Skip scrape; re-export frontend data from existing raw files",
    )
    parser.add_argument(
        "--skip-prepare",
        action="store_true",
        help="Scrape only; skip frontend export",
    )
    parser.add_argument(
        "--notify-test",
        action="store_true",
        help="Send a test email and exit",
    )
    args = parser.parse_args()

    if args.notify_test:
        ok = notify("Test message", "Guamap notify is configured.", level="info")
        raise SystemExit(0 if ok else 1)

    if args.prepare_only:
        print("=== Prepare frontend (Anjuke only, no transit) ===")
        try:
            prepare_anjuke()
            print("Done.")
        except Exception as e:
            notify_exception("Prepare failed", e)
            raise
        return

    try:
        cookie = resolve_cookie(args)
    except SystemExit as e:
        notify("Refresh aborted", str(e), level="error")
        raise

    print("=== Testing Anjuke cookie ===")
    try:
        et, bst = test_cookie(cookie)
        print(f"Cookie OK (et={et}, bst={bst})")
    except ValueError as e:
        notify("Cookie invalid", str(e), level="error")
        raise SystemExit(f"Cookie invalid: {e}") from e

    if args.test_cookie_only:
        print("Cookie test passed.")
        return

    try:
        run_refresh(cookie, skip_prepare=args.skip_prepare)
    except Exception as e:
        notify_exception("Refresh crashed", e)
        raise


if __name__ == "__main__":
    main()
