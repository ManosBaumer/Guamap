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


def resolve_cookie(args: argparse.Namespace) -> str:
    cookie = (args.cookie or os.environ.get("ANJUKE_COOKIE") or "").strip()
    if not cookie:
        raise SystemExit(
            "Missing Anjuke cookie. Set ANJUKE_COOKIE in .env or pass --cookie."
        )
    return cookie


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
    args = parser.parse_args()

    if args.prepare_only:
        print("=== Prepare frontend (Anjuke only, no transit) ===")
        prepare_anjuke()
        print("Done.")
        return

    cookie = resolve_cookie(args)

    print("=== Testing Anjuke cookie ===")
    try:
        et, bst = test_cookie(cookie)
        print(f"Cookie OK (et={et}, bst={bst})")
    except ValueError as e:
        raise SystemExit(f"Cookie invalid: {e}") from e

    if args.test_cookie_only:
        print("Cookie test passed.")
        return

    print("\n=== Scraping Anjuke (no transit) ===")
    total = run_scrape(cookie)
    print(f"Scraped {total} active listing rows.")

    print("\n=== Marking removed listings ===")
    stats = sync_off_market_after_scrape()
    print(
        f"Active: {stats.active_count} | "
        f"Newly removed: {stats.newly_removed} | "
        f"Off-market total: {stats.total_off_market} | "
        f"Saved favourites tagged: {stats.saved_tagged}"
    )

    if args.skip_prepare:
        print("Skipping frontend export (--skip-prepare).")
        return

    print("\n=== Preparing frontend data ===")
    prepare_anjuke()
    print("\nAll done.")


if __name__ == "__main__":
    main()
