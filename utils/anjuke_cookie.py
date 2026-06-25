"""Resolve Anjuke browser cookie from env, file, or CLI."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_COOKIE_FILE = ROOT / "data" / "anjuke_cookie.txt"


def resolve_anjuke_cookie(*, cli_cookie: str | None = None) -> str:
    """
    Priority: --cookie arg > ANJUKE_COOKIE env > ANJUKE_COOKIE_FILE env > data/anjuke_cookie.txt

    In .env, wrap ANJUKE_COOKIE in double quotes if it contains '=' characters:
      ANJUKE_COOKIE="id58=...; aQQ_ajk-appId=...; ..."
    Or put the raw cookie string in data/anjuke_cookie.txt (one line, gitignored).
    """
    if cli_cookie and cli_cookie.strip():
        return cli_cookie.strip()

    env_cookie = (os.environ.get("ANJUKE_COOKIE") or "").strip()
    if env_cookie:
        return env_cookie

    file_path = (os.environ.get("ANJUKE_COOKIE_FILE") or "").strip()
    path = Path(file_path) if file_path else DEFAULT_COOKIE_FILE
    if not path.is_absolute():
        path = ROOT / path

    if path.is_file():
        cookie = path.read_text(encoding="utf-8").strip()
        if cookie:
            return cookie

    raise SystemExit(
        "Missing Anjuke cookie. Set ANJUKE_COOKIE (quoted) in .env, "
        f"save it to {DEFAULT_COOKIE_FILE.relative_to(ROOT)}, "
        "or pass --cookie."
    )
