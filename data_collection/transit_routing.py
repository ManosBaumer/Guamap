"""
Transit routing: stop → SCUT, 10:00 AM. Fastest plan duration only.
"""
import logging
from datetime import date

import pandas as pd

from config import (
    AMAP_WEB_SERVICE_KEY,
    GUANGZHOU_CITYCODE,
    TRANSIT_DEPARTURE_TIME,
    TRANSIT_NO_ROUTE_SENTINEL,
    TRANSIT_PROGRESS_LOG_EVERY_N,
    get_data_path,
    STOPS_DEDUPED_CSV,
    STOPS_WITH_TRANSIT_CSV,
)
from data_collection.geocoding import ensure_scut_location
from utils.api_client import get_with_retry
from utils.io import load_csv, append_csv

logger = logging.getLogger(__name__)

TRANSIT_URL = "https://restapi.amap.com/v3/direction/transit/integrated"


def _int_sec(value) -> int:
    """Parse duration from API (string or int) to seconds."""
    if value is None:
        return 0
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _transit_duration_seconds(
    origin_lon: float, origin_lat: float, dest_lon: float, dest_lat: float
) -> int | None:
    """One transit request. Returns duration in seconds of the fastest plan, or None if no route."""
    today = date.today()
    date_str = f"{today.year}-{today.month}-{today.day}"
    params = {
        "key": AMAP_WEB_SERVICE_KEY,
        "origin": f"{origin_lon},{origin_lat}",
        "destination": f"{dest_lon},{dest_lat}",
        "city": GUANGZHOU_CITYCODE,
        "date": date_str,
        "time": TRANSIT_DEPARTURE_TIME,
        "output": "json",
    }
    resp = get_with_retry(TRANSIT_URL, params=params)
    body = resp.json()
    if body.get("status") != "1":
        return None
    route = body.get("route") or {}
    transits = route.get("transits") or []
    if not transits:
        return None
    best = min(transits, key=lambda t: _int_sec(t.get("duration")) or float("inf"))
    dur = _int_sec(best.get("duration"))
    return dur if dur > 0 else None


def ensure_transit_times(force: bool = False) -> pd.DataFrame:
    """
    For each deduplicated stop, ensure transit time to SCUT is in cache.
    Returns DataFrame with stop_id, lat, lon, transit_time_minutes.
    """
    scut = ensure_scut_location(force=False)
    dest_lon, dest_lat = scut["lon"], scut["lat"]

    path_deduped = get_data_path(STOPS_DEDUPED_CSV)
    path_cache = get_data_path(STOPS_WITH_TRANSIT_CSV)
    if not path_deduped.exists():
        raise FileNotFoundError(f"Run POI fetch + dedupe first: {path_deduped}")

    stops = load_csv(path_deduped)
    if stops.empty:
        logger.warning("No deduplicated stops")
        return pd.DataFrame()

    if not AMAP_WEB_SERVICE_KEY:
        raise ValueError("AMAP_KEY required for transit routing")

    if force and path_cache.exists():
        path_cache.unlink()
        logger.info("Cleared transit cache for full re-fetch (--force-transit)")

    cached = load_csv(path_cache) if path_cache.exists() else pd.DataFrame()
    cached_ids = set(cached["stop_id"].astype(str)) if not cached.empty and "stop_id" in cached.columns else set()

    to_fetch = stops[~stops["stop_id"].astype(str).isin(cached_ids)]
    if to_fetch.empty:
        logger.info("All %d stops already in transit cache", len(stops))
        return load_csv(path_cache) if path_cache.exists() else pd.DataFrame()

    new_rows = []
    total = len(to_fetch)
    for idx, (_, row) in enumerate(to_fetch.iterrows()):
        duration_sec = _transit_duration_seconds(
            float(row["lon"]), float(row["lat"]),
            dest_lon, dest_lat,
        )
        if duration_sec is not None:
            transit_min = duration_sec / 60.0
        else:
            transit_min = TRANSIT_NO_ROUTE_SENTINEL
        new_rows.append({
            "stop_id": row["stop_id"],
            "lat": row["lat"],
            "lon": row["lon"],
            "transit_time_minutes": transit_min,
        })
        if len(new_rows) >= TRANSIT_PROGRESS_LOG_EVERY_N:
            append_csv(path_cache, pd.DataFrame(new_rows))
            new_rows = []
        if (idx + 1) % TRANSIT_PROGRESS_LOG_EVERY_N == 0:
            logger.info("Transit cache: %d / %d", idx + 1, total)

    if new_rows:
        append_csv(path_cache, pd.DataFrame(new_rows))

    result = load_csv(path_cache)
    logger.info("Transit cache has %d stops", len(result))
    return result
