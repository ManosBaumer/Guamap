#!/usr/bin/env python3
"""Restore scrape files from data/scraping/checkpoints/latest/."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LATEST = ROOT / "data" / "scraping" / "checkpoints" / "latest"


def main() -> None:
    manifest_path = LATEST / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"No checkpoint found at {LATEST}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    copied = manifest.get("copied") or []
    if not copied:
        raise SystemExit("Checkpoint manifest has no files.")

    for rel in copied:
        src = LATEST / rel
        if not src.is_file():
            print(f"  skip missing {rel}")
            continue
        dest = ROOT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f"  restored {rel}")

    print(
        f"Restored checkpoint from {manifest.get('saved_at')} "
        f"({manifest.get('label')})."
    )


if __name__ == "__main__":
    main()
