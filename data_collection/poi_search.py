"""
POI search for transit stops: 5 keyword variants × 4 districts, paginated.
Merge all results; deduplication is done separately.
"""
import logging

import pandas as pd

from config import (
    AMAP_WEB_SERVICE_KEY,
    DISTRICTS,
    POI_KEYWORDS,
    get_data_path,
    STOPS_RAW_CSV,
)
from utils.api_client import get_with_retry
from utils.io import load_csv, save_csv

logger = logging.getLogger(__name__)

POI_TEXT_URL = "https://restapi.amap.com/v3/place/text"
MAX_RESULTS_PER_QUERY = 200
PAGE_SIZE = 20


def _search_page(keywords: str, city: str, page: int) -> tuple[list[dict], int]:
    """One POI text search request. Returns (list of poi dicts, total count)."""
    params = {
        "key": AMAP_WEB_SERVICE_KEY,
        "keywords": keywords,
        "city": city,
        "citylimit": "true",
        "offset": PAGE_SIZE,
        "page": page,
        "output": "json",
    }
    resp = get_with_retry(POI_TEXT_URL, params=params)
    body = resp.json()
    if body.get("status") != "1":
        logger.warning("POI search returned status %s: %s", body.get("status"), body.get("info"))
        return [], 0

    pois = body.get("pois") or []
    count = int(body.get("count", 0))
    return pois, count


def _poi_to_row(poi: dict, district_adcode: str, keyword: str) -> dict:
    """Map Amap POI to our stop row. type: bus or metro from keyword."""
    loc = poi.get("location", "")
    if ";" in loc:
        loc = loc.split(";")[0]
    parts = loc.split(",")
    lon = float(parts[0]) if len(parts) >= 2 else 0.0
    lat = float(parts[1]) if len(parts) >= 2 else 0.0
    poi_type = "metro" if "地铁" in keyword else "bus"
    return {
        "stop_id": poi.get("id", ""),
        "name": poi.get("name", ""),
        "lon": lon,
        "lat": lat,
        "type": poi_type,
        "district_adcode": district_adcode,
    }


def fetch_all_stops(force: bool = False) -> pd.DataFrame:
    """
    Fetch all transit stops: 5 keywords × 4 districts, paginated (max 200 per query).
    Save to stops_raw.csv; return DataFrame. Skip if cache exists and not force.
    """
    path = get_data_path(STOPS_RAW_CSV)
    if not force and path.exists():
        df = load_csv(path)
        if not df.empty:
            logger.info("Using cached raw stops: %s (%d rows)", path, len(df))
            return df

    if not AMAP_WEB_SERVICE_KEY:
        raise ValueError("AMAP_KEY required for POI search")

    rows = []
    for adcode, _ in DISTRICTS:
        for keyword in POI_KEYWORDS:
            page = 1
            total_fetched = 0
            while True:
                pois, count = _search_page(keyword, adcode, page)
                for poi in pois:
                    rows.append(_poi_to_row(poi, adcode, keyword))
                total_fetched += len(pois)
                if len(pois) < PAGE_SIZE or total_fetched >= min(count, MAX_RESULTS_PER_QUERY):
                    break
                page += 1
                if page > 10:
                    break
            logger.debug("POI %s %s: %d from page %d", adcode, keyword, total_fetched, page)

    df = pd.DataFrame(rows)
    if not df.empty:
        save_csv(path, df)
        logger.info("Saved %d raw stops to %s", len(df), path)
    return df
