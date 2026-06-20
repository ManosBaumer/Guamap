"""
POI search for transit stops: district text search + metro bbox polygon search.
Merge all results; deduplication is done separately.
"""
import logging

import pandas as pd

from config import (
    AMAP_WEB_SERVICE_KEY,
    DISTRICTS,
    GUANGZHOU_METRO_STOP_BBOX,
    METRO_POI_KEYWORDS,
    POI_KEYWORDS,
    get_data_path,
    STOPS_RAW_CSV,
)
from utils.api_client import get_with_retry
from utils.io import load_csv, save_csv

logger = logging.getLogger(__name__)

POI_TEXT_URL = "https://restapi.amap.com/v3/place/text"
POI_POLYGON_URL = "https://restapi.amap.com/v3/place/polygon"
MAX_RESULTS_PER_QUERY = 200
PAGE_SIZE = 20


def _is_metro_poi(poi: dict, keyword: str) -> bool:
    if "地铁" in keyword:
        return True
    name = str(poi.get("name", ""))
    typ = str(poi.get("type", ""))
    typecode = str(poi.get("typecode", ""))
    if "地铁" in name or "地铁" in typ:
        return True
    if typecode.startswith("1505"):
        return True
    return False


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


def _search_polygon_page(polygon: str, keywords: str, page: int) -> tuple[list[dict], int]:
    """POI search inside a polygon (GCJ lng,lat ring). Returns (pois, total count)."""
    params = {
        "key": AMAP_WEB_SERVICE_KEY,
        "polygon": polygon,
        "keywords": keywords,
        "offset": PAGE_SIZE,
        "page": page,
        "output": "json",
    }
    resp = get_with_retry(POI_POLYGON_URL, params=params)
    body = resp.json()
    if body.get("status") != "1":
        logger.warning(
            "POI polygon search returned status %s: %s",
            body.get("status"),
            body.get("info"),
        )
        return [], 0
    pois = body.get("pois") or []
    count = int(body.get("count", 0))
    return pois, count


def _bbox_polygon_ring(south: float, west: float, north: float, east: float) -> str:
    """Closed rectangle polygon for Amap (lng,lat pairs)."""
    return f"{west},{south}|{east},{south}|{east},{north}|{west},{north}|{west},{south}"


def _poi_to_row(poi: dict, district_adcode: str, keyword: str) -> dict:
    """Map Amap POI to our stop row."""
    loc = poi.get("location", "")
    if ";" in loc:
        loc = loc.split(";")[0]
    parts = loc.split(",")
    lon = float(parts[0]) if len(parts) >= 2 else 0.0
    lat = float(parts[1]) if len(parts) >= 2 else 0.0
    poi_type = "metro" if _is_metro_poi(poi, keyword) else "bus"
    return {
        "stop_id": poi.get("id", ""),
        "name": poi.get("name", ""),
        "lon": lon,
        "lat": lat,
        "type": poi_type,
        "district_adcode": district_adcode,
    }


def _fetch_district_stops(rows: list[dict]) -> None:
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


def _fetch_metro_bbox_stops(rows: list[dict]) -> None:
    """Metro stops across greater Guangzhou bbox (covers stations outside core 4 districts)."""
    south, west, north, east = GUANGZHOU_METRO_STOP_BBOX
    polygon = _bbox_polygon_ring(south, west, north, east)
    seen_ids: set[str] = set()

    for keyword in METRO_POI_KEYWORDS:
        page = 1
        total_fetched = 0
        while True:
            pois, count = _search_polygon_page(polygon, keyword, page)
            added = 0
            for poi in pois:
                if not _is_metro_poi(poi, keyword):
                    continue
                poi_id = str(poi.get("id", ""))
                if poi_id and poi_id in seen_ids:
                    continue
                if poi_id:
                    seen_ids.add(poi_id)
                rows.append(_poi_to_row(poi, "bbox", keyword))
                added += 1
            total_fetched += len(pois)
            logger.debug(
                "Metro bbox %s page %d: %d pois (%d metro kept, total %d/%d)",
                keyword,
                page,
                len(pois),
                added,
                total_fetched,
                count,
            )
            if len(pois) < PAGE_SIZE or total_fetched >= min(count, MAX_RESULTS_PER_QUERY):
                break
            page += 1
            if page > 10:
                break

    logger.info("Metro bbox search added %d unique metro POIs", len(seen_ids))


def fetch_all_stops(force: bool = False) -> pd.DataFrame:
    """
    Fetch transit stops: district text search + metro bbox polygon search.
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

    rows: list[dict] = []
    _fetch_district_stops(rows)
    _fetch_metro_bbox_stops(rows)

    df = pd.DataFrame(rows)
    if not df.empty:
        save_csv(path, df)
        logger.info(
            "Saved %d raw stops to %s (%d metro)",
            len(df),
            path,
            int((df["type"] == "metro").sum()) if "type" in df.columns else 0,
        )
    return df
