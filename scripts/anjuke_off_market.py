"""
Track Anjuke listings removed from the market and tag them as sold/off-market.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

OFF_MARKET_TAG = "【已下架】"
LISTINGS_FILE = DATA / "anjuke_listings_raw.jsonl"
LISTINGS_BACKUP = DATA / "anjuke_listings_raw.jsonl.bak"
OFF_MARKET_FILE = DATA / "anjuke_off_market.jsonl"
SAVED_LISTINGS_FILE = DATA / "saved_listings.json"


@dataclass
class OffMarketStats:
    newly_removed: int
    total_off_market: int
    saved_tagged: int
    active_count: int


def tag_off_market_title(title: str) -> str:
    title = (title or "").strip()
    if OFF_MARKET_TAG in title:
        return title
    return f"{OFF_MARKET_TAG}{title}" if title else OFF_MARKET_TAG


def load_listings_map(path: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not path.exists():
        return out
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                out[str(row["id"])] = row
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
    return out


def save_listings_map(path: Path, rows: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows.values():
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def sync_off_market_after_scrape() -> OffMarketStats:
    """
    Compare pre-scrape backup (.bak) with the new active JSONL.
    Newly removed listings are appended to anjuke_off_market.jsonl.
    Saved favourites in saved_listings.json get the off-market title tag.
    """
    active = load_listings_map(LISTINGS_FILE)
    active_ids = set(active.keys())

    previous_source = LISTINGS_BACKUP if LISTINGS_BACKUP.exists() else LISTINGS_FILE
    previous = load_listings_map(previous_source)
    previous_ids = set(previous.keys())

    off_market = load_listings_map(OFF_MARKET_FILE)

    newly_removed = previous_ids - active_ids
    relisted = active_ids & set(off_market.keys())

    for lid in relisted:
        off_market.pop(lid, None)

    for lid in newly_removed:
        row = dict(previous.get(lid) or off_market.get(lid) or {})
        if not row:
            continue
        row["title"] = tag_off_market_title(str(row.get("title", "")))
        off_market[lid] = row

    save_listings_map(OFF_MARKET_FILE, off_market)

    saved_tagged = tag_saved_listings(active_ids)

    return OffMarketStats(
        newly_removed=len(newly_removed),
        total_off_market=len(off_market),
        saved_tagged=saved_tagged,
        active_count=len(active_ids),
    )


def tag_saved_listings(known_ids: set[str]) -> int:
    if not SAVED_LISTINGS_FILE.exists():
        return 0
    try:
        rows = json.loads(SAVED_LISTINGS_FILE.read_text("utf-8"))
    except json.JSONDecodeError:
        return 0
    if not isinstance(rows, list):
        return 0

    tagged = 0
    changed = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        listing = row.get("listing")
        if not isinstance(listing, dict):
            continue
        lid = str(listing.get("id", ""))
        if not lid or lid in known_ids:
            continue
        new_title = tag_off_market_title(str(listing.get("title", "")))
        if listing.get("title") != new_title:
            listing["title"] = new_title
            tagged += 1
            changed = True

    if changed:
        SAVED_LISTINGS_FILE.write_text(
            json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return tagged
