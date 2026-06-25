"""Durable read/write helpers for anjuke_listings_raw.jsonl during long scrapes."""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LISTINGS_FILE = ROOT / "data" / "anjuke_listings_raw.jsonl"
LISTINGS_BACKUP = ROOT / "data" / "anjuke_listings_raw.jsonl.bak"
LISTINGS_FILE_NEW = ROOT / "data" / "scraping" / "anjuke_listings_new.jsonl"
LAST_RUN_SEEN_IDS = ROOT / "data" / "scraping" / "last_run_seen_ids.json"


def save_json_atomic(path: Path, data: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)


def load_listings_map(*paths: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for path in paths:
        if not path.is_file():
            continue
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


def load_existing_listings() -> dict[str, dict]:
    paths = [p for p in (LISTINGS_FILE, LISTINGS_FILE_NEW) if p.is_file()]
    if not paths:
        return {}
    print(f"Loading existing listings from {', '.join(str(p.name) for p in paths)}...")
    existing = load_listings_map(*paths)
    print(f"Loaded {len(existing)} existing listings.")
    return existing


def append_listings(path: Path, listings: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for listing in listings:
            f.write(json.dumps(listing, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def save_last_run_seen_ids(*paths: Path) -> int:
    """Persist listing IDs returned by Anjuke during this scrape (for off-market diff)."""
    seen = set(load_listings_map(*paths).keys())
    if not seen:
        return 0
    save_json_atomic(
        LAST_RUN_SEEN_IDS,
        {
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "count": len(seen),
            "ids": sorted(seen),
        },
    )
    return len(seen)


def merge_listings_into_main() -> int:
    """
    Promote this run's listings into anjuke_listings_raw.jsonl.

    Active listings = only what Anjuke returned this scrape (the new JSONL),
    not a union with the previous main file. The previous main is kept as .bak
    for off-market diffing.
    """
    run_only = load_listings_map(LISTINGS_FILE_NEW)
    if not run_only:
        if LISTINGS_FILE.is_file():
            return len(load_listings_map(LISTINGS_FILE))
        return 0

    if LISTINGS_FILE.is_file():
        if LISTINGS_BACKUP.is_file():
            LISTINGS_BACKUP.unlink()
        shutil.copy2(LISTINGS_FILE, LISTINGS_BACKUP)

    seen_count = save_last_run_seen_ids(LISTINGS_FILE_NEW)
    if seen_count:
        print(f"Saved {seen_count} listing IDs seen this scrape (active set).")

    tmp = LISTINGS_FILE.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for row in run_only.values():
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(LISTINGS_FILE)

    LISTINGS_FILE_NEW.unlink(missing_ok=True)

    print(
        f"Active listings file replaced with this run only "
        f"({len(run_only)} unique; previous main backed up to .bak)."
    )
    return len(run_only)
