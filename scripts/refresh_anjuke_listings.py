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


def _configure_stdio_utf8() -> None:
    """Windows default (cp1252) cannot print Chinese district/community names."""
    if sys.platform != "win32":
        return
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (OSError, ValueError):
                pass


from data_collection.anjuke import run_scrape, test_cookie
from anjuke_off_market import (
    LISTINGS_FILE,
    sync_off_market_after_scrape,
    sync_saved_listings_from_raw_file,
)
from prepare_frontend_data import prepare_anjuke
from utils.anjuke_cookie import resolve_anjuke_cookie
from utils.github_progress import decompress_progress_archives, reset_retry_count
from utils.notify import notify, notify_exception


def resolve_cookie(args: argparse.Namespace) -> str:
    return resolve_anjuke_cookie(cli_cookie=args.cookie)


def run_refresh(cookie: str, *, skip_prepare: bool, fresh: bool = False) -> None:
    n = decompress_progress_archives()
    if n:
        print(f"Restored {n} compressed progress file(s) from anjuke-scrape-cache")

    notify("Anjuke refresh started", level="info")

    print("\n=== Scraping Anjuke (no transit) ===")
    if fresh:
        print("Fresh mode: not reusing cached rows from the previous main file.")
    total = run_scrape(cookie, fresh=fresh)
    print(f"Scraped {total} active listing rows.")

    print("\n=== Marking removed listings ===")
    stats = sync_off_market_after_scrape()
    summary = (
        f"Active: {stats.active_count}\n"
        f"Newly removed: {stats.newly_removed}\n"
        f"Off-market: {stats.total_off_market}\n"
        f"Saved tagged (file): {stats.saved_tagged}\n"
        f"Saved tagged (Supabase): {stats.supabase_saved_tagged}"
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
    _configure_stdio_utf8()
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
        "--sync-saved-only",
        action="store_true",
        help="Tag off-market saved favourites (local file + Supabase) from current raw JSONL",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Ignore cached listing rows from the previous main file (still replaces main with this run only at end)",
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

    if args.sync_saved_only:
        print("=== Sync saved favourites against active listings ===")
        if not LISTINGS_FILE.exists():
            raise SystemExit(f"Missing {LISTINGS_FILE} — run a scrape first.")
        file_tagged, file_untagged, supabase_tagged, supabase_untagged = sync_saved_listings_from_raw_file()
        print(
            f"Done. File tagged={file_tagged} untagged={file_untagged}, "
            f"Supabase tagged={supabase_tagged} untagged={supabase_untagged}"
        )
        return

    if args.prepare_only:
        print("=== Off-market sync (scrape diff) ===")
        try:
            stats = sync_off_market_after_scrape()
            print(
                f"Active: {stats.active_count} | newly removed: {stats.newly_removed} | "
                f"off-market total: {stats.total_off_market}"
            )
            print("\n=== Prepare frontend (Anjuke only, no transit) ===")
            prepare_anjuke()
            print("\n=== Syncing saved favourites ===")
            file_tagged, file_untagged, supabase_tagged, supabase_untagged = sync_saved_listings_from_raw_file()
            print(
                f"Saved sync: file tagged={file_tagged} untagged={file_untagged}, "
                f"Supabase tagged={supabase_tagged} untagged={supabase_untagged}"
            )
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
        run_refresh(cookie, skip_prepare=args.skip_prepare, fresh=args.fresh)
    except Exception as e:
        from utils.scrape_checkpoint import save_local_checkpoint

        save_local_checkpoint("scrape crashed")
        notify_exception("Refresh crashed", e)
        raise


if __name__ == "__main__":
    main()
