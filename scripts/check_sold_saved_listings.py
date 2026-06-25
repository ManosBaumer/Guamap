#!/usr/bin/env python3
"""Sanity-check sold-tagged saved listings against live Anjuke pages."""
from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env.local")

OFF_MARKET_TAG = "【已下架】"
EMAIL = "manossos06@gmail.com"
PASSWORD = "GuamapPassword2026!"
OUT_PATH = ROOT / "data" / "scraping" / "sold_listings_sanity_check.json"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


@dataclass
class ListingCheck:
    listing_id: int
    title: str
    community_name: str
    status: str  # gone | live | uncertain | error
    http_status: int
    signals: list[str]
    url: str


def supabase_session() -> tuple[str, str, str]:
    base = (os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
    anon = os.environ.get("VITE_SUPABASE_ANON_KEY") or ""
    if not base or not anon:
        raise SystemExit("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY")

    resp = requests.post(
        f"{base}/auth/v1/token?grant_type=password",
        headers={"apikey": anon, "Content-Type": "application/json"},
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return base, anon, data["access_token"]


def fetch_saved_rows(base: str, anon: str, token: str) -> list[dict]:
    headers = {"apikey": anon, "Authorization": f"Bearer {token}"}
    rows: list[dict] = []
    offset = 0
    while True:
        resp = requests.get(
            f"{base}/rest/v1/saved_listings",
            headers=headers,
            params={
                "select": "listing_id,community_name,listing",
                "offset": offset,
                "limit": 1000,
            },
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


GONE_SIGNALS = [
    "抱歉，该房源已过期",
    "房源不存在",
    "已下架",
    "已删除",
    "找不到",
    "抱歉，您访问的页面不存在",
    "页面不存在",
    "该房源已下架",
    "房源已失效",
    "信息已过期",
]

# Active rental pages show WeChat contact; expired pages do not.
LIVE_SIGNAL = "微信扫码联系"


def classify_page(listing_id: int, html: str, http_status: int) -> tuple[str, list[str]]:
    signals: list[str] = []
    if http_status == 404:
        signals.append("http_404")
        return "gone", signals

    for sig in GONE_SIGNALS:
        if sig in html:
            signals.append(f"gone:{sig}")

    if LIVE_SIGNAL in html:
        signals.append(f"live:{LIVE_SIGNAL}")

    has_gone = any(s.startswith("gone:") for s in signals)
    has_live = any(s.startswith("live:") for s in signals)

    if has_live and not has_gone:
        return "live", signals
    if has_gone and not has_live:
        return "gone", signals
    if has_gone and has_live:
        return "uncertain", signals
    if http_status >= 400:
        signals.append(f"http_{http_status}")
        return "gone", signals
    return "uncertain", signals


def check_listing(listing_id: int, title: str, community_name: str) -> ListingCheck:
    url = f"https://gz.zu.anjuke.com/fangyuan/{listing_id}"
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9"},
            timeout=20,
            allow_redirects=True,
        )
        status, signals = classify_page(listing_id, resp.text, resp.status_code)
        return ListingCheck(
            listing_id=listing_id,
            title=title,
            community_name=community_name,
            status=status,
            http_status=resp.status_code,
            signals=signals,
            url=url,
        )
    except requests.RequestException as exc:
        return ListingCheck(
            listing_id=listing_id,
            title=title,
            community_name=community_name,
            status="error",
            http_status=0,
            signals=[f"error:{exc.__class__.__name__}"],
            url=url,
        )


def main() -> None:
    if sys.platform == "win32":
        for stream in (sys.stdout, sys.stderr):
            reconfigure = getattr(stream, "reconfigure", None)
            if reconfigure is not None:
                try:
                    reconfigure(encoding="utf-8", errors="replace")
                except (OSError, ValueError):
                    pass

    base, anon, token = supabase_session()
    rows = fetch_saved_rows(base, anon, token)

    sold = [
        r
        for r in rows
        if OFF_MARKET_TAG in str((r.get("listing") or {}).get("title", ""))
    ]
    active = [r for r in rows if r not in sold]

    print(f"Account: {EMAIL}")
    print(f"Total saved: {len(rows)} | sold-tagged: {len(sold)} | active-tagged: {len(active)}")
    print()

    results: list[ListingCheck] = []
    for i, row in enumerate(sold, 1):
        listing = row.get("listing") or {}
        title = str(listing.get("title", "")).replace(OFF_MARKET_TAG, "")
        check = check_listing(int(row["listing_id"]), title, str(row.get("community_name", "")))
        results.append(check)
        if i % 10 == 0 or i == len(sold):
            print(f"  checked {i}/{len(sold)}...")
        time.sleep(0.35)

    # Also verify the 3 still-active favourites
    active_checks: list[ListingCheck] = []
    for row in active:
        listing = row.get("listing") or {}
        title = str(listing.get("title", ""))
        active_checks.append(
            check_listing(int(row["listing_id"]), title, str(row.get("community_name", "")))
        )
        time.sleep(0.35)

    counts = {"gone": 0, "live": 0, "uncertain": 0, "error": 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1

    false_positives = [r for r in results if r.status == "live"]
    uncertain = [r for r in results if r.status == "uncertain"]
    errors = [r for r in results if r.status == "error"]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(
            {
                "email": EMAIL,
                "sold_tagged": len(sold),
                "counts": counts,
                "false_positives": [asdict(r) for r in false_positives],
                "uncertain": [asdict(r) for r in uncertain],
                "errors": [asdict(r) for r in errors],
                "active_checks": [asdict(r) for r in active_checks],
                "all_sold_checks": [asdict(r) for r in results],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print("=== SOLD-TAGGED LISTINGS (Anjuke page check) ===")
    print(f"  Truly gone / unavailable: {counts['gone']}")
    print(f"  Still live (false positive): {counts['live']}")
    print(f"  Uncertain: {counts['uncertain']}")
    print(f"  Errors: {counts['error']}")
    print()
    print("=== STILL-ACTIVE FAVOURITES (control group) ===")
    for r in active_checks:
        print(f"  {r.listing_id}: {r.status} (HTTP {r.http_status}) — {r.title[:50]}")
    print()
    if false_positives:
        print("FALSE POSITIVES (marked sold but page looks live):")
        for r in false_positives[:20]:
            print(f"  {r.listing_id} {r.url}")
            print(f"    {r.title[:70]}")
    if uncertain:
        print(f"\nUNCERTAIN ({len(uncertain)}) — manual review suggested:")
        for r in uncertain[:15]:
            print(f"  {r.listing_id} HTTP {r.http_status} signals={r.signals}")
    print(f"\nFull report: {OUT_PATH}")


if __name__ == "__main__":
    main()
