"""
Fetch Guangzhou metro lines from OpenStreetMap Overpass API and save as GeoJSON.
Run once (or when you want to refresh) to get accurate, detailed metro geometry.
"""
import json
import logging
from pathlib import Path

import requests

from config import get_data_path, GUANGZHOU_METRO_GEOJSON

logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Guangzhou bounding box (approx)
GUANGZHOU_BBOX = (22.9, 113.1, 23.5, 113.6)

# Line number -> hex color (Guangzhou Metro official-ish)
LINE_COLORS = {
    "1": "#F3D03E",
    "2": "#0066B3",
    "3": "#E86E22",
    "4": "#00A651",
    "5": "#C5003E",
    "6": "#80225F",
    "7": "#97D077",
    "8": "#008C49",
    "9": "#73C0D8",
    "13": "#C5003E",
    "14": "#80225F",
    "18": "#0066B3",
    "21": "#97D077",
    "APM": "#0099CC",
    "GF": "#00A651",  # Guangfo
}


def _overpass_ways_query() -> str:
    """Query for subway ways in Guangzhou bbox with geometry."""
    s, w, n, e = GUANGZHOU_BBOX
    return f"""
[out:json][timeout:60];
(
  way["railway"="subway"]({s},{w},{n},{e});
  way["railway"="light_rail"]({s},{w},{n},{e});
);
out geom;
"""


def _osm_to_geojson(elements: list) -> dict:
    """Convert Overpass way elements to GeoJSON FeatureCollection."""
    features = []
    for el in elements:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        coords = [[p["lon"], p["lat"]] for p in geom]
        tags = el.get("tags") or {}
        ref = tags.get("ref") or tags.get("line") or ""
        color = LINE_COLORS.get(ref, "#666666")
        for k, v in list(LINE_COLORS.items()):
            if k in str(tags.get("ref", "")) or k in str(tags.get("name", "")):
                color = v
                break
        name = tags.get("name") or f"Line {ref}" if ref else "Metro"
        features.append({
            "type": "Feature",
            "properties": {"name": name, "ref": ref, "color": color},
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    return {"type": "FeatureCollection", "features": features}


def fetch_guangzhou_metro_geojson(force: bool = False) -> Path:
    """
    Fetch Guangzhou metro from Overpass and save to data/guangzhou_metro_lines.geojson.
    Returns the path. Skips fetch if file exists and force is False.
    """
    path = get_data_path(GUANGZHOU_METRO_GEOJSON)
    if path.exists() and not force:
        logger.info("Metro GeoJSON already exists: %s", path)
        return path

    logger.info("Fetching Guangzhou metro from Overpass API...")
    try:
        r = requests.post(
            OVERPASS_URL,
            data={"data": _overpass_ways_query()},
            timeout=90,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning("Overpass fetch failed: %s. Use existing metro file or run again.", e)
        return path

    elements = data.get("elements") or []
    if not elements:
        logger.warning("Overpass returned no subway ways. Keeping existing file if any.")
        return path

    geojson = _osm_to_geojson(elements)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=0)
    logger.info("Saved %d metro segments to %s", len(geojson["features"]), path)
    return path
