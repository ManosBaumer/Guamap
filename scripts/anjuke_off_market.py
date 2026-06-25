"""
Track Anjuke listings removed from the market and tag them as sold/off-market.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

OFF_MARKET_TAG = "【已下架】"
LISTINGS_FILE = DATA / "anjuke_listings_raw.jsonl"
LISTINGS_BACKUP = DATA / "anjuke_listings_raw.jsonl.bak"
OFF_MARKET_FILE = DATA / "anjuke_off_market.jsonl"
LAST_RUN_SEEN_IDS = DATA / "scraping" / "last_run_seen_ids.json"
SAVED_LISTINGS_FILE = DATA / "saved_listings.json"


@dataclass
class OffMarketStats:
    newly_removed: int
    total_off_market: int
    saved_tagged: int
    supabase_saved_tagged: int
    active_count: int


def tag_off_market_title(title: str) -> str:
    title = (title or "").strip()
    if OFF_MARKET_TAG in title:
        return title
    return f"{OFF_MARKET_TAG}{title}" if title else OFF_MARKET_TAG


def strip_off_market_title(title: str) -> str:
    return str(title or "").replace(OFF_MARKET_TAG, "").strip()


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


def load_last_run_seen_ids() -> set[str] | None:
    if not LAST_RUN_SEEN_IDS.is_file():
        return None
    try:
        payload = json.loads(LAST_RUN_SEEN_IDS.read_text(encoding="utf-8"))
        ids = payload.get("ids")
        if isinstance(ids, list):
            return {str(x) for x in ids}
    except (json.JSONDecodeError, TypeError, OSError):
        pass
    return None


def load_active_ids_for_saved_sync() -> tuple[set[str], str]:
    """IDs that represent currently active Anjuke listings for saved-fav sync."""
    seen = load_last_run_seen_ids()
    if seen is not None:
        return seen, "last_run_seen_ids.json"

    active_ids = set(load_listings_map(LISTINGS_FILE))
    if LISTINGS_BACKUP.is_file():
        previous_ids = set(load_listings_map(LISTINGS_BACKUP))
        if (
            previous_ids
            and previous_ids <= active_ids
            and len(active_ids) > len(previous_ids) * 1.2
        ):
            print(
                "  Warning: raw file still contains a stale union merge "
                f"({len(active_ids)} rows, pre-scrape {len(previous_ids)}). "
                "Re-run the scrape so only this run's listings replace the main file."
            )
    return active_ids, "anjuke_listings_raw.jsonl"


def sync_saved_listings_by_membership(
    active_ids: set[str],
) -> tuple[int, int, int, int]:
    """Tag saved favourites not in active_ids; untag those that are."""
    file_tagged, file_untagged = sync_file_saved_listings_by_membership(active_ids)
    supabase_tagged, supabase_untagged = sync_supabase_saved_listings_by_membership(
        active_ids
    )
    if file_tagged:
        print(f"  Local file: tagged {file_tagged} saved listing(s) as off-market.")
    if file_untagged:
        print(f"  Local file: untagged {file_untagged} saved listing(s).")
    if supabase_tagged:
        print(f"  Supabase: tagged {supabase_tagged} saved listing(s) as off-market.")
    if supabase_untagged:
        print(f"  Supabase: untagged {supabase_untagged} saved listing(s).")
    if not any((file_tagged, file_untagged, supabase_tagged, supabase_untagged)):
        print("  Saved favourites already match active listings.")
    return file_tagged, file_untagged, supabase_tagged, supabase_untagged


def sync_off_market_after_scrape() -> OffMarketStats:
    """
    Compare pre-scrape backup (.bak) with listings seen on Anjuke this run.

    The active JSONL should contain only this run's listings; delistings are
    previous_ids - seen_this_run. Saved favourites are synced by membership.
    """
    active = load_listings_map(LISTINGS_FILE)
    active_ids = set(active.keys())

    previous_source = LISTINGS_BACKUP if LISTINGS_BACKUP.exists() else LISTINGS_FILE
    previous = load_listings_map(previous_source)
    previous_ids = set(previous.keys())

    off_market = load_listings_map(OFF_MARKET_FILE)

    seen_ids = load_last_run_seen_ids()
    if seen_ids is not None:
        newly_removed = previous_ids - seen_ids
        relisted = seen_ids & set(off_market.keys())
        active_for_saved = seen_ids
        print(
            f"  Off-market diff: {len(previous_ids)} pre-scrape vs "
            f"{len(seen_ids)} seen this run"
        )
    else:
        newly_removed = previous_ids - active_ids
        relisted = active_ids & set(off_market.keys())
        active_for_saved = active_ids
        if LISTINGS_BACKUP.exists() and previous_ids and previous_ids <= active_ids:
            print(
                "  Note: no last_run_seen_ids.json — using active raw file for saved sync."
            )

    for lid in relisted:
        off_market.pop(lid, None)

    for lid in newly_removed:
        row = dict(previous.get(lid) or off_market.get(lid) or {})
        if not row:
            continue
        row["title"] = tag_off_market_title(str(row.get("title", "")))
        off_market[lid] = row

    save_listings_map(OFF_MARKET_FILE, off_market)

    print(
        f"  Syncing saved favourites against {len(active_for_saved)} active listing IDs..."
    )
    saved_tagged, saved_untagged, supabase_tagged, supabase_untagged = (
        sync_saved_listings_by_membership(active_for_saved)
    )

    return OffMarketStats(
        newly_removed=len(newly_removed),
        total_off_market=len(off_market),
        saved_tagged=saved_tagged,
        supabase_saved_tagged=supabase_tagged,
        active_count=len(active_ids),
    )


def _supabase_config() -> tuple[str, str] | None:
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("VITE_SUPABASE_URL")
        or ""
    ).rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        return None
    return url, key


def sync_file_saved_listings_by_membership(active_ids: set[str]) -> tuple[int, int]:
    if not SAVED_LISTINGS_FILE.exists():
        return 0, 0
    try:
        rows = json.loads(SAVED_LISTINGS_FILE.read_text("utf-8"))
    except json.JSONDecodeError:
        return 0, 0
    if not isinstance(rows, list):
        return 0, 0

    tagged = 0
    untagged = 0
    changed = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        listing = row.get("listing")
        if not isinstance(listing, dict):
            continue
        lid = str(listing.get("id", ""))
        if not lid:
            continue
        title = str(listing.get("title", ""))
        has_tag = OFF_MARKET_TAG in title
        is_active = lid in active_ids

        if is_active and has_tag:
            listing["title"] = strip_off_market_title(title)
            untagged += 1
            changed = True
        elif not is_active and not has_tag:
            listing["title"] = tag_off_market_title(title)
            tagged += 1
            changed = True

    if changed:
        SAVED_LISTINGS_FILE.write_text(
            json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return tagged, untagged


def sync_supabase_saved_listings_by_membership(
    active_ids: set[str],
) -> tuple[int, int]:
    """Tag saved favourites missing from active_ids; untag those present."""
    cfg = _supabase_config()
    if not cfg:
        print("  Supabase saved-listings sync skipped (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).")
        return 0, 0

    url, key = cfg
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    session = requests.Session()
    session.headers.update(headers)

    rows: list[dict] = []
    page_size = 1000
    offset = 0
    while True:
        resp = session.get(
            f"{url}/rest/v1/saved_listings",
            params={
                "select": "id,listing_id,listing",
                "offset": offset,
                "limit": page_size,
            },
            timeout=60,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    tagged = 0
    untagged = 0
    for row in rows:
        lid = str(row.get("listing_id", ""))
        listing = row.get("listing")
        if not isinstance(listing, dict):
            continue
        title = str(listing.get("title", ""))
        has_tag = OFF_MARKET_TAG in title
        is_active = lid in active_ids

        if is_active and has_tag:
            listing["title"] = strip_off_market_title(title)
            patch = session.patch(
                f"{url}/rest/v1/saved_listings",
                params={"id": f"eq.{row['id']}"},
                json={"listing": listing},
                timeout=30,
            )
            patch.raise_for_status()
            untagged += 1
        elif not is_active and not has_tag:
            listing["title"] = tag_off_market_title(title)
            patch = session.patch(
                f"{url}/rest/v1/saved_listings",
                params={"id": f"eq.{row['id']}"},
                json={"listing": listing},
                timeout=30,
            )
            patch.raise_for_status()
            tagged += 1

    return tagged, untagged


def sync_saved_listings_from_raw_file() -> tuple[int, int, int, int]:
    """Compare saved favourites to the current active listing set."""
    active_ids, source = load_active_ids_for_saved_sync()
    print(f"  Active set: {len(active_ids)} IDs ({source})")
    return sync_saved_listings_by_membership(active_ids)
