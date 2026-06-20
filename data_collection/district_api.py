"""
Fetch district polygon boundaries from Amap District API.
Merge the four districts into one geometry for grid clipping.
"""
import json
import logging
from pathlib import Path

from shapely.geometry import Polygon
from shapely.ops import unary_union

from config import (
    AMAP_WEB_SERVICE_KEY,
    DISTRICTS,
    get_data_path,
    DISTRICT_POLYGONS_JSON,
)
from utils.api_client import get_with_retry
from utils.io import load_json, save_json

logger = logging.getLogger(__name__)

DISTRICT_URL = "https://restapi.amap.com/v3/config/district"


def _parse_polyline(polyline_str: str) -> list[Polygon]:
    """
    Parse Amap polyline: points separated by ';', multiple polygons by '|'.
    Each point is "lng,lat". Returns list of Shapely Polygons.
    """
    if not polyline_str or not polyline_str.strip():
        return []
    polygons = []
    for part in polyline_str.split("|"):
        part = part.strip()
        if not part:
            continue
        points = []
        for pt in part.split(";"):
            pt = pt.strip()
            if not pt:
                continue
            coords = pt.split(",")
            if len(coords) >= 2:
                try:
                    lng, lat = float(coords[0]), float(coords[1])
                    points.append((lng, lat))
                except ValueError:
                    continue
        if len(points) >= 3:
            try:
                poly = Polygon(points)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if not poly.is_empty:
                    polygons.append(poly)
            except Exception:
                continue
    return polygons


def fetch_district_polygons(force: bool = False) -> dict:
    """
    Fetch boundaries for the four districts; merge into one (union).
    Save to district_polygons.json. Return dict with 'merged_wkt' and optional 'districts'.
    """
    path = get_data_path(DISTRICT_POLYGONS_JSON)
    if not force and path.exists():
        data = load_json(path)
        if data and "merged_wkt" in data:
            logger.info("Using cached district polygons: %s", path)
            return data

    if not AMAP_WEB_SERVICE_KEY:
        raise ValueError("AMAP_KEY required for district API")

    all_polys = []
    district_geoms = []

    for adcode, name in DISTRICTS:
        params = {
            "key": AMAP_WEB_SERVICE_KEY,
            "keywords": adcode,
            "subdistrict": "0",
            "extensions": "all",
            "output": "json",
        }
        resp = get_with_retry(DISTRICT_URL, params=params)
        body = resp.json()
        if body.get("status") != "1":
            logger.warning("District API %s: %s", adcode, body.get("info"))
            continue

        districts = body.get("districts") or []
        if not districts:
            continue
        d = districts[0]
        polyline = d.get("polyline") or ""
        polys = _parse_polyline(polyline)
        for p in polys:
            all_polys.append(p)
        if polys:
            district_geoms.append({"adcode": adcode, "name": name})

    if not all_polys:
        raise RuntimeError("No district polygons could be fetched")

    merged = unary_union(all_polys)
    if merged.is_empty:
        raise RuntimeError("Merged district polygon is empty")

    result = {
        "merged_wkt": merged.wkt,
        "districts": district_geoms,
    }
    save_json(path, result)
    logger.info("Saved merged district polygons to %s", path)
    return result


def ensure_district_polygons(force: bool = False) -> dict:
    """Load or fetch district polygons (alias for pipeline)."""
    return fetch_district_polygons(force=force)


def load_merged_polygon() -> Polygon | None:
    """Load the merged district polygon from cache (Shapely Polygon)."""
    path = get_data_path(DISTRICT_POLYGONS_JSON)
    data = load_json(path)
    if not data or "merged_wkt" not in data:
        return None
    from shapely import wkt as wkt_module
    return wkt_module.loads(data["merged_wkt"])
