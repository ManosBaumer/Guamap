#!/usr/bin/env python3
"""
Collect unique metro tokens from anjuke_listings_raw.jsonl.

Each listing's `metro_info` is split on "/" (e.g.
"1/3号线(北延段)/3号线/APM线" -> four distinct values).

Anjuke often encodes a line as a bare line number before another segment, e.g. "1/3号线(北延段)".
By default, segments that are only digits are normalized to "N号线" so "1" and "1号线" count once.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "data" / "anjuke_listings_raw.jsonl"
DEFAULT_JSON_OUT = ROOT / "data" / "metro_info_unique.json"

_DIGITS_ONLY = re.compile(r"^\d+$")
_LINE_RE = re.compile(r"^(\d+)号线(?:\((.+)\))?$")


def normalize_metro_token(part: str, *, raw: bool) -> str:
    """Map bare line numbers to full line names (e.g. 3 -> 3号线)."""
    t = part.strip()
    if not t or raw:
        return t
    if _DIGITS_ONLY.match(t):
        return f"{t}号线"
    return t


def tokens_from_metro_info(raw: str | None, *, raw_tokens: bool) -> list[str]:
    if not raw or not isinstance(raw, str):
        return []
    out: list[str] = []
    for part in raw.split("/"):
        t = normalize_metro_token(part, raw=raw_tokens)
        if t:
            out.append(t)
    return out


def sort_metro_tokens(tokens: list[str]) -> list[str]:
    """广佛 first, then numeric 号线 in line order, branch lines after base, APM last."""

    def key(s: str) -> tuple:
        if s == "广佛线":
            return (0, 0, 0, s)
        if s == "APM线":
            return (4, 0, 0, s)
        m = _LINE_RE.match(s)
        if m:
            n = int(m.group(1))
            extra = m.group(2)
            branch = 1 if extra else 0
            return (1, n, branch, s)
        return (3, 0, 0, s)

    return sorted(tokens, key=key)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples (run each line separately in PowerShell):\n"
            "  python scripts/unique_metro_info.py\n"
            "  python scripts/unique_metro_info.py --json-out\n"
            "  python scripts/unique_metro_info.py -i data/anjuke_listings_raw.jsonl "
            "-o data/metro_custom.json --no-print\n"
            "\n"
            "Default input is data/anjuke_listings_raw.jsonl — you only need -i for another file."
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
        help=f"Write sorted unique tokens as JSON array (default path: {DEFAULT_JSON_OUT.name})",
    )
    ap.add_argument(
        "--no-print",
        action="store_true",
        help="Only write JSON; do not print the list to stdout",
    )
    ap.add_argument(
        "--raw-tokens",
        action="store_true",
        help="Do not normalize digit-only segments to N号线 (keeps e.g. both '1' and '1号线')",
    )
    args = ap.parse_args()
    path: Path = args.input
    if not path.is_file():
        print(f"Input not found: {path}", file=sys.stderr)
        return 1

    unique: set[str] = set()
    lines_total = 0
    lines_with_metro = 0
    empty_metro = 0

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
            mi = obj.get("metro_info")
            if mi is None or (isinstance(mi, str) and not mi.strip()):
                empty_metro += 1
                continue
            ts = tokens_from_metro_info(
                mi if isinstance(mi, str) else str(mi),
                raw_tokens=args.raw_tokens,
            )
            if not ts:
                empty_metro += 1
                continue
            lines_with_metro += 1
            unique.update(ts)

    sorted_unique = sort_metro_tokens(list(unique))

    print(f"File: {path}", file=sys.stderr)
    print(f"Lines read: {lines_total}", file=sys.stderr)
    print(f"Lines with non-empty metro_info (after split): {lines_with_metro}", file=sys.stderr)
    print(f"Lines missing/empty metro_info: {empty_metro}", file=sys.stderr)
    print(f"Unique tokens: {len(sorted_unique)}", file=sys.stderr)
    if args.raw_tokens:
        print("(raw-tokens: digit-only segments not merged to N号线)", file=sys.stderr)
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
