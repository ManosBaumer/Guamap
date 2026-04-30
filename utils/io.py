"""I/O helpers for cache and output files."""
import json
from pathlib import Path

import pandas as pd


def load_json(path: Path) -> dict | list | None:
    """Load JSON file; return None if missing or invalid."""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def save_json(path: Path, data: dict | list) -> None:
    """Write JSON file (UTF-8)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_csv(path: Path, **kwargs) -> pd.DataFrame:
    """Load CSV; return empty DataFrame if missing."""
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, **kwargs)


def save_csv(path: Path, df: pd.DataFrame, **kwargs) -> None:
    """Write DataFrame to CSV (UTF-8)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8-sig", **kwargs)


def append_csv(path: Path, df: pd.DataFrame, **kwargs) -> None:
    """Append rows to CSV (creates file with header if new)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.exists()
    df.to_csv(
        path, index=False, encoding="utf-8-sig",
        mode="a", header=write_header, **kwargs
    )
