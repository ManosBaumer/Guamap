"""
Push Anjuke scrape checkpoints to a dedicated Git branch (GitHub Actions).

Uses git commit-tree so main is never polluted with gitignored data/ files.
Branch: anjuke-scrape-cache
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROGRESS_BRANCH = "anjuke-scrape-cache"
RETRY_COUNT_FILE = ROOT / "data" / "scraping" / "gha_retry_count"

# Paths written during scrape (only existing files are added).
SCRAPE_REL_PATHS = [
    "data/anjuke_blocks.json",
    "data/anjuke_communities.json",
    "data/anjuke_listings_raw.jsonl",
    "data/anjuke_listings_raw.jsonl.bak",
    "data/anjuke_off_market.jsonl",
    "data/scraping/communities_state.json",
    "data/scraping/listings_state.json",
    "data/scraping/anjuke_listings_new.jsonl",
    "data/scraping/gha_retry_count",
]

_ticks_since_push = 0


def _on_github_actions() -> bool:
    return os.environ.get("GITHUB_ACTIONS") == "true"


def _progress_interval() -> int:
    try:
        n = int(os.environ.get("GUAMAP_PROGRESS_EVERY", "25"))
        return max(1, n)
    except ValueError:
        return 25


def _run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=ROOT,
        check=check,
        text=True,
        capture_output=True,
    )


def _existing_scrape_rel_paths() -> list[str]:
    out: list[str] = []
    for rel in SCRAPE_REL_PATHS:
        path = ROOT / rel
        if path.is_file():
            out.append(rel)
    scraping = ROOT / "data" / "scraping"
    if scraping.is_dir():
        for f in scraping.iterdir():
            if f.is_file() and f.name not in {
                p.split("/")[-1] for p in SCRAPE_REL_PATHS if "/scraping/" in p
            }:
                rel = str(f.relative_to(ROOT)).replace("\\", "/")
                if rel not in out:
                    out.append(rel)
    return out


def _remote_branch_sha() -> str | None:
    _run(["git", "fetch", "origin", PROGRESS_BRANCH], check=False)
    r = _run(["git", "rev-parse", f"origin/{PROGRESS_BRANCH}"], check=False)
    if r.returncode != 0 or not r.stdout.strip():
        return None
    return r.stdout.strip()


def push_scrape_progress(message: str) -> bool:
    """Push current data/ scrape files to anjuke-scrape-cache. Never raises."""
    if not _on_github_actions():
        return False

    paths = _existing_scrape_rel_paths()
    if not paths:
        print("[github] no scrape files to push")
        return False

    try:
        for rel in paths:
            _run(["git", "add", "-f", rel])

        if _run(["git", "diff", "--cached", "--quiet"], check=False).returncode == 0:
            _run(["git", "reset", "HEAD"], check=False)
            print("[github] no changes to push")
            return False

        tree = _run(["git", "write-tree"]).stdout.strip()
        parent = _remote_branch_sha()
        if parent:
            commit = _run(
                ["git", "commit-tree", tree, "-p", parent, "-m", message],
            ).stdout.strip()
        else:
            commit = _run(["git", "commit-tree", tree, "-m", message]).stdout.strip()

        _run(["git", "push", "origin", f"{commit}:{PROGRESS_BRANCH}"])
        _run(["git", "reset", "HEAD"], check=False)
        print(f"[github] pushed progress → {PROGRESS_BRANCH}: {message}")
        return True
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        print(f"[github] progress push failed: {stderr or e}")
        _run(["git", "reset", "HEAD"], check=False)
        return False


def maybe_push_github_progress(label: str, *, force: bool = False) -> bool:
    """Push every N checkpoints (default 25), or immediately when force=True."""
    global _ticks_since_push
    if not _on_github_actions():
        return False
    if not force:
        _ticks_since_push += 1
        if _ticks_since_push < _progress_interval():
            return False
    _ticks_since_push = 0
    return push_scrape_progress(label)


def _max_auto_retries() -> int:
    try:
        return max(1, int(os.environ.get("GUAMAP_MAX_AUTO_RETRIES", "20")))
    except ValueError:
        return 20


def get_retry_count() -> int:
    if not RETRY_COUNT_FILE.is_file():
        return 0
    try:
        return max(0, int(RETRY_COUNT_FILE.read_text(encoding="utf-8").strip()))
    except ValueError:
        return 0


def set_retry_count(count: int) -> None:
    RETRY_COUNT_FILE.parent.mkdir(parents=True, exist_ok=True)
    RETRY_COUNT_FILE.write_text(str(max(0, count)), encoding="utf-8")


def bump_retry_count() -> tuple[int, bool]:
    """Increment retry counter on progress branch. Returns (new_count, may_retry)."""
    current = get_retry_count()
    new_count = current + 1
    set_retry_count(new_count)
    push_scrape_progress(f"auto-retry {new_count}/{_max_auto_retries()}")
    return new_count, new_count <= _max_auto_retries()


def reset_retry_count() -> None:
    """Reset after a fully successful refresh."""
    set_retry_count(0)
    if _on_github_actions():
        push_scrape_progress("auto-retry counter reset (refresh complete)")


def reset_progress_counter() -> None:
    global _ticks_since_push
    _ticks_since_push = 0
