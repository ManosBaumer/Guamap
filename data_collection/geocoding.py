"""Resolve SCUT to GCJ-02: POI search (大学城) first, then geocode fallback."""
import logging
from pathlib import Path

import folium

from config import (
    AMAP_WEB_SERVICE_KEY,
    GEOCODE_CITY,
    SCUT_POI_KEYWORDS,
    SCUT_FALLBACK_ADDRESS,
    SCUT_ADDRESS,
    get_data_path,
    SCUT_LOCATION_JSON,
    SCUT_VERIFICATION_HTML,
)
from utils.api_client import get_with_retry
from utils.io import load_json, save_json

logger = logging.getLogger(__name__)

GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo"
POI_TEXT_URL = "https://restapi.amap.com/v3/place/text"


def _poi_search_scut() -> dict | None:
    """Search POI for SCUT 大学城 campus. Returns candidate dict or None."""
    params = {
        "key": AMAP_WEB_SERVICE_KEY,
        "keywords": SCUT_POI_KEYWORDS,
        "city": GEOCODE_CITY,
        "citylimit": "true",
        "offset": 20,
        "page": 1,
        "output": "json",
    }
    resp = get_with_retry(POI_TEXT_URL, params=params)
    body = resp.json()
    if body.get("status") != "1":
        logger.warning("POI search for SCUT returned status %s: %s", body.get("status"), body.get("info"))
        return None
    pois = body.get("pois") or []
    for poi in pois:
        name = (poi.get("name") or "")
        address = (poi.get("address") or "")
        if "大学城" in name or "大学城" in address:
            loc = poi.get("location", "")
            if loc and "," in loc:
                lng_s, lat_s = loc.split(",", 1)
                return {
                    "lon": float(lng_s.strip()),
                    "lat": float(lat_s.strip()),
                    "address": name or address or SCUT_ADDRESS,
                    "source": "poi",
                }
    if pois:
        # First result even without 大学城 in name (e.g. only one campus in list)
        loc = pois[0].get("location", "")
        if loc and "," in loc:
            lng_s, lat_s = loc.split(",", 1)
            return {
                "lon": float(lng_s.strip()),
                "lat": float(lat_s.strip()),
                "address": (pois[0].get("name") or pois[0].get("address") or SCUT_ADDRESS),
                "source": "poi_first",
            }
    return None


def _geocode_fallback() -> dict:
    """Geocode SCUT fallback address. Returns candidate dict."""
    params = {
        "key": AMAP_WEB_SERVICE_KEY,
        "address": SCUT_FALLBACK_ADDRESS,
        "city": GEOCODE_CITY,
        "output": "json",
    }
    resp = get_with_retry(GEOCODE_URL, params=params)
    body = resp.json()
    if body.get("status") != "1" or not body.get("geocodes"):
        raise RuntimeError(f"Geocoding fallback failed: {body.get('info', 'unknown')}")
    loc = body["geocodes"][0]["location"]
    lon_s, lat_s = loc.split(",", 1)
    return {
        "lon": float(lon_s),
        "lat": float(lat_s),
        "address": SCUT_FALLBACK_ADDRESS,
        "source": "geocode",
    }


def ensure_scut_location(force: bool = False) -> dict:
    """
    Load SCUT location from cache, or fetch via POI (大学城) then geocode fallback and save.
    Used by transit and rest of pipeline. No manual prompt; saves directly to scut_location.json.
    """
    path = get_data_path(SCUT_LOCATION_JSON)
    if not force and path.exists():
        data = load_json(path)
        if data and "lon" in data and "lat" in data:
            logger.info("Using cached SCUT location: %s", path)
            return data

    if not AMAP_WEB_SERVICE_KEY:
        raise ValueError("AMAP_KEY environment variable is required for geocoding")

    candidate = _poi_search_scut()
    if candidate is None:
        logger.info("POI search had no suitable result; using geocode fallback")
        candidate = _geocode_fallback()
    else:
        logger.info("Resolved SCUT via POI: %s at (%.6f, %.6f)", candidate.get("address"), candidate["lon"], candidate["lat"])

    save_json(path, candidate)
    logger.info("Saved SCUT location: %s", path)
    write_verification_html(candidate)
    return candidate


def write_verification_html(candidate: dict) -> Path | None:
    """Write a minimal Folium map with one marker (WGS84) for SCUT verification. Returns path or None."""
    try:
        from utils.coord_transform import gcj02_to_wgs84
    except ImportError:
        logger.debug("coord_transform not available; skipping verification map or using GCJ-02")
        lon, lat = candidate["lon"], candidate["lat"]
    else:
        lon, lat = gcj02_to_wgs84(candidate["lon"], candidate["lat"])
    out = get_data_path(SCUT_VERIFICATION_HTML)
    m = folium.Map(location=[lat, lon], zoom_start=16, tiles="OpenStreetMap")
    folium.Marker(
        [lat, lon],
        popup=candidate.get("address", "SCUT"),
        tooltip="SCUT (大学城?)",
        icon=folium.Icon(color="red", icon="info-sign"),
    ).add_to(m)
    out.parent.mkdir(parents=True, exist_ok=True)
    m.save(str(out))
    logger.info("Verification map written: %s", out)
    return out


