"""
Fetch bus/metro lines serving each stop from Amap /v3/bus/stopname API.
Extends stops_deduped.csv with a 'lines' column (e.g. "4号线,7号线").

WARNING: This API has a strict daily quota. Do not call ensure_stop_lines() in routine
pipelines — only with an explicit --force-lines flag when you have quota headroom.
"""
import logging
import re

import pandas as pd

from config import AMAP_WEB_SERVICE_KEY, GEOCODE_CITY, get_data_path, STOPS_DEDUPED_CSV
from utils.api_client import get_with_retry
from utils.io import load_csv, save_csv

logger = logging.getLogger(__name__)

BUS_STOPNAME_URL = "https://restapi.amap.com/v3/bus/stopname"


def _query_variants(name: str) -> list[str]:
    """
    Generate search variants for the bus API. The API uses keyword matching;
    POI names often differ from bus DB (e.g. 中山七路 vs 中山七路站).
    Returns variants to try in order (try base first, then +站 if no match).
    """
    base = name.strip()
    for suffix in ("(公交站)", "(地铁站)", "公交站", "地铁站"):
        if base.endswith(suffix):
            base = base[: -len(suffix)].strip()
            break
    variants = [base]
    if base and not base.endswith("站"):
        variants.append(base + "站")
    return variants


def _line_short_name(full_name: str) -> str:
    """Extract short line identifier: 地铁4号线 -> 4号线, 123路 -> 123路."""
    s = full_name.strip()
    if not s:
        return ""
    # Metro: 地铁4号线, 地铁7号线 -> 4号线, 7号线
    m = re.search(r"地铁\s*(\d+号线)", s)
    if m:
        return m.group(1)
    # Light rail etc: 轻轨X号线 -> X号线
    m = re.search(r"(?:轻轨|有轨)\s*(\d+号线)", s)
    if m:
        return m.group(1)
    # Bus: 123路, B21路, 夜20路 -> keep as-is (already short)
    return s


def fetch_lines_for_station(keywords: str, city: str = GEOCODE_CITY) -> list[str]:
    """
    Query Amap /v3/bus/stopname for a station. Returns list of line short names.
    Empty list on failure or no results.
    """
    if not AMAP_WEB_SERVICE_KEY:
        return []
    params = {
        "key": AMAP_WEB_SERVICE_KEY,
        "keywords": keywords,
        "city": city,
        "output": "json",
    }
    try:
        resp = get_with_retry(BUS_STOPNAME_URL, params=params)
        body = resp.json()
        if body.get("status") != "1":
            logger.debug("Bus stopname status %s: %s", body.get("status"), body.get("info"))
            return []
        busstops = body.get("busstops") or []
        if not busstops:
            return []
        # Take first match; each stop has buslines list
        stop = busstops[0]
        buslines = stop.get("buslines") or []
        seen_full = set()
        seen_short = set()
        names = []
        for bl in buslines:
            full = bl.get("name", "").strip()
            if not full or full in seen_full:
                continue
            seen_full.add(full)
            short = _line_short_name(full)
            if short and short not in seen_short:
                seen_short.add(short)
                names.append(short)
        return names
    except Exception as e:
        logger.debug("Bus stopname error for %s: %s", keywords, e)
        return []


def ensure_stop_lines(force: bool = False) -> pd.DataFrame:
    """
    Load stops_deduped, fetch lines for each stop from Amap, add 'lines' column.
    Saves back to stops_deduped.csv. Returns updated DataFrame.
    """
    path = get_data_path(STOPS_DEDUPED_CSV)
    df = load_csv(path)
    if df.empty:
        logger.warning("No deduped stops to enrich with lines")
        return df

    if "lines" in df.columns and not force:
        logger.info("Using cached stop lines (run with --force-lines to re-fetch)")
        return df

    if not AMAP_WEB_SERVICE_KEY:
        logger.warning("AMAP_KEY not set; skipping line enrichment")
        if "lines" not in df.columns:
            df["lines"] = ""
        return df

    lines_col = []
    unique_names = df["name"].drop_duplicates()
    name_to_lines: dict[str, str] = {}
    for i, name in enumerate(unique_names):
        if (i + 1) % 100 == 0:
            logger.info("Fetched lines for %d/%d unique stop names", i + 1, len(unique_names))
        line_list = []
        for q in _query_variants(str(name)):
            line_list = fetch_lines_for_station(q)
            if line_list:
                break
        name_to_lines[str(name)] = ",".join(line_list) if line_list else ""

    df["lines"] = df["name"].map(lambda n: name_to_lines.get(str(n), ""))
    save_csv(path, df)
    filled = (df["lines"] != "").sum()
    logger.info("Enriched %d stops with lines (%d have line data)", len(df), filled)
    return df
