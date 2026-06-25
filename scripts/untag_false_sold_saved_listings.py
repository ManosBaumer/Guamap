#!/usr/bin/env python3
"""Untag saved favourites that are still live on Anjuke (false sold tags)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env.local")

from anjuke_off_market import OFF_MARKET_TAG, SAVED_LISTINGS_FILE, strip_off_market_title

EMAIL = "manossos06@gmail.com"
PASSWORD = "GuamapPassword2026!"
REPORT_PATH = ROOT / "data" / "scraping" / "sold_listings_sanity_check.json"


def auth_session() -> tuple[str, str, str, str]:
    base = (os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    anon = os.environ.get("VITE_SUPABASE_ANON_KEY") or ""

    if service_key:
        return base, service_key, service_key, ""

    if not base or not anon:
        raise SystemExit("Need VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY")

    resp = requests.post(
        f"{base}/auth/v1/token?grant_type=password",
        headers={"apikey": anon, "Content-Type": "application/json"},
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    resp.raise_for_status()
    token = resp.json()["access_token"]
    return base, anon, token, resp.json()["user"]["id"]


def fetch_rows(base: str, apikey: str, token: str, user_id: str | None) -> list[dict]:
    headers = {"apikey": apikey, "Authorization": f"Bearer {token}"}
    params: dict = {"select": "id,listing_id,listing"}
    if user_id:
        params["user_id"] = f"eq.{user_id}"

    rows: list[dict] = []
    offset = 0
    while True:
        resp = requests.get(
            f"{base}/rest/v1/saved_listings",
            headers=headers,
            params={**params, "offset": offset, "limit": 1000},
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def untag_local_file(untag_ids: set[int]) -> int:
    if not SAVED_LISTINGS_FILE.exists():
        return 0
    try:
        rows = json.loads(SAVED_LISTINGS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return 0
    if not isinstance(rows, list):
        return 0

    changed = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        listing = row.get("listing")
        if not isinstance(listing, dict):
            continue
        lid = int(listing.get("id", 0) or 0)
        if lid not in untag_ids:
            continue
        title = str(listing.get("title", ""))
        if OFF_MARKET_TAG not in title:
            continue
        listing["title"] = strip_off_market_title(title)
        changed += 1

    if changed:
        SAVED_LISTINGS_FILE.write_text(
            json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return changed


def main() -> None:
    if not REPORT_PATH.exists():
        raise SystemExit(f"Missing report: {REPORT_PATH} — run check_sold_saved_listings.py first")

    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    untag_ids = {int(x["listing_id"]) for x in report.get("false_positives", [])}
    if not untag_ids:
        print("No false positives in report.")
        return

    base, apikey, token, user_id = auth_session()
    rows = fetch_rows(base, apikey, token, user_id or None)
    headers = {
        "apikey": apikey,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    untagged = 0
    for row in rows:
        lid = int(row["listing_id"])
        if lid not in untag_ids:
            continue
        listing = row.get("listing")
        if not isinstance(listing, dict):
            continue
        title = str(listing.get("title", ""))
        if OFF_MARKET_TAG not in title:
            continue
        listing["title"] = strip_off_market_title(title)
        resp = requests.patch(
            f"{base}/rest/v1/saved_listings",
            headers=headers,
            params={"id": f"eq.{row['id']}"},
            json={"listing": listing},
            timeout=30,
        )
        resp.raise_for_status()
        untagged += 1
        print(f"  untagged {lid}")

    print(f"Done. Untagged {untagged} of {len(untag_ids)} false positives in Supabase.")
    local = untag_local_file(untag_ids)
    if local:
        print(f"Also untagged {local} in {SAVED_LISTINGS_FILE.name}.")


if __name__ == "__main__":
    main()
