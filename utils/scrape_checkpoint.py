"""
Local scrape checkpoints (disk snapshots under data/scraping/checkpoints/).

GitHub Actions uses utils.github_progress for remote branch pushes; local runs
use this module so a crash does not lose hours of work.
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECKPOINT_DIR = ROOT / "data" / "scraping" / "checkpoints"
LATEST_DIR = CHECKPOINT_DIR / "latest"
PROGRESS_LOG = ROOT / "data" / "scraping" / "progress.log"

CHECKPOINT_PATHS = [
    "data/anjuke_blocks.json",
    "data/anjuke_communities.json",
    "data/anjuke_listings_raw.jsonl",
    "data/anjuke_listings_raw.jsonl.bak",
    "data/anjuke_off_market.jsonl",
    "data/scraping/communities_state.json",
    "data/scraping/listings_state.json",
    "data/scraping/anjuke_listings_new.jsonl",
]

_ticks_since_save = 0


def _checkpoint_interval() -> int:
    try:
        return max(1, int(os.environ.get("GUAMAP_CHECKPOINT_EVERY", "10")))
    except ValueError:
        return 10


def _count_listing_lines(path: Path) -> int:
    if not path.is_file():
        return 0
    count = 0
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                count += 1
    return count


def _manifest_for(label: str) -> dict:
    listings_main = ROOT / "data" / "anjuke_listings_raw.jsonl"
    listings_new = ROOT / "data" / "scraping" / "anjuke_listings_new.jsonl"
    communities = ROOT / "data" / "anjuke_communities.json"
    comm_count = 0
    if communities.is_file():
        try:
            raw = json.loads(communities.read_text(encoding="utf-8"))
            comm_count = sum(
                1 for k, v in raw.items() if not str(k).startswith("_") and isinstance(v, dict)
            )
        except json.JSONDecodeError:
            pass
    state_path = ROOT / "data" / "scraping" / "listings_state.json"
    fetched = 0
    if state_path.is_file():
        try:
            fetched = len(json.loads(state_path.read_text(encoding="utf-8")).get("fetched_communities", []))
        except json.JSONDecodeError:
            pass
    return {
        "label": label,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "communities_file": comm_count,
        "listings_main_lines": _count_listing_lines(listings_main),
        "listings_new_lines": _count_listing_lines(listings_new),
        "listings_fetched_communities": fetched,
    }


def append_progress_log(label: str, manifest: dict) -> None:
    PROGRESS_LOG.parent.mkdir(parents=True, exist_ok=True)
    line = (
        f"{manifest['saved_at']} | {label} | "
        f"communities={manifest['communities_file']} "
        f"listings_main={manifest['listings_main_lines']} "
        f"listings_new={manifest['listings_new_lines']} "
        f"fetched={manifest['listings_fetched_communities']}\n"
    )
    with PROGRESS_LOG.open("a", encoding="utf-8") as f:
        f.write(line)
        f.flush()
        os.fsync(f.fileno())


def save_local_checkpoint(label: str) -> bool:
    """Copy current scrape files into data/scraping/checkpoints/latest/."""
    try:
        if LATEST_DIR.exists():
            shutil.rmtree(LATEST_DIR)
        LATEST_DIR.mkdir(parents=True, exist_ok=True)

        copied: list[str] = []
        for rel in CHECKPOINT_PATHS:
            src = ROOT / rel
            if not src.is_file():
                continue
            dest = LATEST_DIR / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            copied.append(rel)

        manifest = _manifest_for(label)
        manifest["copied"] = copied
        manifest_path = LATEST_DIR / "manifest.json"
        tmp = manifest_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(manifest_path)

        append_progress_log(label, manifest)
        print(
            f"[checkpoint] saved locally ({label}): "
            f"main={manifest['listings_main_lines']} lines, "
            f"new={manifest['listings_new_lines']} lines, "
            f"fetched={manifest['listings_fetched_communities']} communities"
        )
        return True
    except OSError as exc:
        print(f"[checkpoint] local save failed: {exc}")
        return False


def maybe_save_local_checkpoint(label: str, *, force: bool = False) -> bool:
    global _ticks_since_save
    if not force:
        _ticks_since_save += 1
        if _ticks_since_save < _checkpoint_interval():
            return False
    _ticks_since_save = 0
    return save_local_checkpoint(label)


def maybe_checkpoint(label: str, *, force: bool = False) -> None:
    """Local disk checkpoint always; GitHub branch push when on Actions."""
    maybe_save_local_checkpoint(label, force=force)
    from utils.github_progress import maybe_push_github_progress

    maybe_push_github_progress(label, force=force)


def push_checkpoint(label: str) -> None:
    """Force an immediate local + GitHub checkpoint."""
    save_local_checkpoint(label)
    from utils.github_progress import push_scrape_progress

    push_scrape_progress(label)
