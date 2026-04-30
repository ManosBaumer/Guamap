#!/usr/bin/env python3
"""
Collect unique `orient` values from anjuke_listings_raw.jsonl.

Each listing has a single orientation string (e.g. 朝南, 东南). If a value
ever contains "/", segments are split like metro_info (rare).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "data" / "anjuke_listings_raw.jsonl"
DEFAULT_JSON_OUT = ROOT / "data" / "orient_unique.json"


def tokens_from_orient(raw: str | None, *, split_slash: bool) -> list[str]:
    if not raw or not isinstance(raw, str):
        return []
    s = raw.strip()
    if not s:
        return []
    if split_slash and "/" in s:
        return [p.strip() for p in s.split("/") if p.strip()]
    return [s]


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples (one command per line in PowerShell):\n"
            "  python scripts/unique_orient.py\n"
            "  python scripts/unique_orient.py --json-out\n"
            "  python scripts/unique_orient.py -i data/anjuke_listings_raw.jsonl "
            "-o data/orient_custom.json --no-print"
        ),
    )
    ap.add_argument(
        "--input",
        "-i",
        type=Path,
        default=DEFAULT_INPUT,
        help="Path to anjuke_listings_raw.jsonl",
    )
    ap.add_argument(
        "--json-out",
        "-o",
        type=Path,
        nargs="?",
        const=DEFAULT_JSON_OUT,
        default=None,
        help=f"Write sorted unique values as JSON array (default: {DEFAULT_JSON_OUT.name})",
    )
    ap.add_argument(
        "--no-print",
        action="store_true",
        help="Only write JSON; do not print values to stdout",
    )
    ap.add_argument(
        "--split-slash",
        action="store_true",
        help="Split orient on '/' into separate tokens (default: treat whole string as one value)",
    )
    args = ap.parse_args()
    path: Path = args.input
    if not path.is_file():
        print(f"Input not found: {path}", file=sys.stderr)
        return 1

    unique: set[str] = set()
    lines_total = 0
    lines_with_orient = 0
    empty_orient = 0

    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            lines_total += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"JSON error line ~{lines_total}: {e}", file=sys.stderr)
                return 1
            o = obj.get("orient")
            if o is None or (isinstance(o, str) and not o.strip()):
                empty_orient += 1
                continue
            ts = tokens_from_orient(o if isinstance(o, str) else str(o), split_slash=args.split_slash)
            if not ts:
                empty_orient += 1
                continue
            lines_with_orient += 1
            unique.update(ts)

    sorted_unique = sorted(unique)

    print(f"File: {path}", file=sys.stderr)
    print(f"Lines read: {lines_total}", file=sys.stderr)
    print(f"Lines with non-empty orient: {lines_with_orient}", file=sys.stderr)
    print(f"Lines missing/empty orient: {empty_orient}", file=sys.stderr)
    print(f"Unique orient values: {len(sorted_unique)}", file=sys.stderr)
    if args.split_slash:
        print("(split-slash: values containing '/' were split)", file=sys.stderr)
    print(file=sys.stderr)

    if not args.no_print:
        for t in sorted_unique:
            print(t)

    if args.json_out is not None:
        out_path: Path = args.json_out
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(sorted_unique, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {out_path}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
