"""
Push Anjuke scrape checkpoints to a dedicated Git branch (GitHub Actions).

Uses git commit-tree so main is never polluted with gitignored data/ files.
Branch: anjuke-scrape-cache

Large JSONL files are gzip-compressed before push (GitHub hard limit 100 MB).
"""
from __future__ import annotations

import gzip
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROGRESS_BRANCH = "anjuke-scrape-cache"
PROGRESS_REF = f"refs/heads/{PROGRESS_BRANCH}"
RETRY_COUNT_FILE = ROOT / "data" / "scraping" / "gha_retry_count"

# Stay under GitHub's 100 MB per-file limit (pre-receive hook).
MAX_GIT_FILE_BYTES = 95 * 1024 * 1024

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
        known = {p.split("/")[-1] for p in SCRAPE_REL_PATHS if "/scraping/" in p}
        for f in scraping.iterdir():
            if not f.is_file() or f.name in known:
                continue
            if f.name.endswith(".gz"):
                continue
            if f.stat().st_size > MAX_GIT_FILE_BYTES:
                continue
            rel = str(f.relative_to(ROOT)).replace("\\", "/")
            if rel not in out:
                out.append(rel)
    return out


def _gzip_for_git(rel: str) -> str | None:
    """Compress a large file; return git path to add (.gz), or None if still too large."""
    src = ROOT / rel
    gz_rel = f"{rel}.gz"
    gz_path = ROOT / gz_rel
    gz_path.parent.mkdir(parents=True, exist_ok=True)
    mb = src.stat().st_size / (1024 * 1024)
    print(f"[github] compressing {rel} ({mb:.1f} MB) for push")
    with src.open("rb") as fin, gzip.open(gz_path, "wb", compresslevel=6) as fout:
        shutil.copyfileobj(fin, fout)
    gz_mb = gz_path.stat().st_size / (1024 * 1024)
    print(f"[github] → {gz_rel} ({gz_mb:.1f} MB)")
    if gz_path.stat().st_size > MAX_GIT_FILE_BYTES:
        print(f"[github] skip {rel}: compressed size still exceeds GitHub limit")
        return None
    return gz_rel


def _paths_for_git_push() -> list[str]:
    """Map scrape paths to git-add paths, gzip-compressing files over the size limit."""
    push_paths: list[str] = []
    for rel in _existing_scrape_rel_paths():
        path = ROOT / rel
        if path.stat().st_size > MAX_GIT_FILE_BYTES:
            gz_rel = _gzip_for_git(rel)
            if gz_rel:
                push_paths.append(gz_rel)
        else:
            push_paths.append(rel)
    return push_paths


def decompress_progress_archives() -> int:
    """Gunzip data/**/*.jsonl.gz after restoring anjuke-scrape-cache. Returns count."""
    count = 0
    data = ROOT / "data"
    if not data.is_dir():
        return 0
    for gz_path in data.rglob("*.jsonl.gz"):
        out_path = Path(str(gz_path)[:-3])
        try:
            with gzip.open(gz_path, "rb") as fin, out_path.open("wb") as fout:
                shutil.copyfileobj(fin, fout)
            count += 1
            print(f"[github] decompressed {gz_path.relative_to(ROOT)}")
        except OSError as e:
            print(f"[github] decompress failed {gz_path}: {e}")
    return count


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

    paths = _paths_for_git_push()
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

        _run(["git", "push", "origin", f"{commit}:{PROGRESS_REF}"])
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
