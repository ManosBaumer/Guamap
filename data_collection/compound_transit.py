"""
Transit routing: residential compound centroids → SCUT campus.
Extracts the fastest transit plan with a per-segment breakdown
(e.g. "5 min walk → 25 min 地铁3号线 → 3 min walk → 18 min 公交B25路").

Results are cached row-by-row so the job can be interrupted and resumed safely.
"""
import json
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
    GUANGZHOU_COMPOUNDS_GEOJSON,
    COMPOUND_TRANSIT_CACHE_CSV,
)
from data_collection.geocoding import ensure_scut_location
from utils.api_client import get_with_retry
from utils.io import load_csv, append_csv, load_json

logger = logging.getLogger(__name__)

TRANSIT_URL = "https://restapi.amap.com/v3/direction/transit/integrated"


def _int_val(value) -> int:
    if value is None:
        return 0
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _parse_segment_breakdown(segments: list) -> str:
    """
    Parse the segments array from a single transit plan into a human-readable
    breakdown string like:
      "5 min walk → 25 min 地铁3号线(天河客运站→番禺广场) → 3 min walk"
    """
    parts = []
    for seg in segments:
        walking = seg.get("walking")
        if walking:
            dur = _int_val(walking.get("duration"))
            if dur >= 60:
                parts.append(f"{round(dur / 60)} min walk")

        bus_info = seg.get("bus")
        if bus_info:
            buslines = bus_info.get("buslines") or []
            if buslines:
                bl = min(buslines, key=lambda b: _int_val(b.get("duration")) or float("inf"))
                dur = _int_val(bl.get("duration"))
                name = bl.get("name", "").split("(")[0].strip()
                dep_name = ""
                arr_name = ""
                dep = bl.get("departure_stop")
                arr = bl.get("arrival_stop")
                if dep and dep.get("name"):
                    dep_name = dep["name"]
                if arr and arr.get("name"):
                    arr_name = arr["name"]
                via = _int_val(bl.get("via_num"))
                label = f"{round(dur / 60)} min {name}"
                if dep_name and arr_name:
                    label += f"({dep_name}→{arr_name})"
                if via:
                    label += f" {via} stops"
                parts.append(label)

        railway = seg.get("railway")
        if railway:
            dur = _int_val(railway.get("time"))
            if dur >= 60:
                name = railway.get("name", "train")
                parts.append(f"{round(dur / 60)} min {name}")

    return " → ".join(parts) if parts else ""


def _query_transit(
    origin_lon: float, origin_lat: float,
    dest_lon: float, dest_lat: float,
) -> dict:
    """
    Single transit API call. Returns a dict with:
      transit_time_minutes, distance_m, cost, walking_distance_m,
      num_transfers, breakdown
    or sentinel values on failure / no-route.
    """
    today = date.today()
    date_str = f"{today.year}-{today.month:02d}-{today.day:02d}"
    params = {
        "key": AMAP_WEB_SERVICE_KEY,
        "origin": f"{origin_lon},{origin_lat}",
        "destination": f"{dest_lon},{dest_lat}",
        "city": GUANGZHOU_CITYCODE,
        "date": date_str,
        "time": TRANSIT_DEPARTURE_TIME,
        "output": "json",
        "strategy": "0",  # fastest
    }
    no_route = {
        "transit_time_minutes": TRANSIT_NO_ROUTE_SENTINEL,
        "distance_m": "",
        "cost": "",
        "walking_distance_m": "",
        "num_transfers": "",
        "breakdown": "",
    }
    try:
        resp = get_with_retry(TRANSIT_URL, params=params)
        body = resp.json()
    except Exception as e:
        logger.error("Transit request failed for (%.6f,%.6f): %s", origin_lon, origin_lat, e)
        return no_route

    status = body.get("status")
    info = body.get("info", "")
    infocode = body.get("infocode", "")
    if status != "1":
        logger.error("Amap transit error: status=%s info=%s infocode=%s", status, info, infocode)
        if infocode in ("10003", "10004", "10009", "10044"):
            raise RuntimeError(f"Amap quota/auth error: {info} ({infocode}) — aborting to avoid wasting calls")
        return no_route

    route = body.get("route") or {}
    transits = route.get("transits") or []
    if not transits:
        return no_route

    best = min(transits, key=lambda t: _int_val(t.get("duration")) or float("inf"))
    dur_sec = _int_val(best.get("duration"))
    if dur_sec <= 0:
        return no_route

    segments = best.get("segments") or []
    breakdown = _parse_segment_breakdown(segments)

    # Count transfers: number of bus/metro segments minus 1 (first boarding isn't a transfer)
    bus_count = sum(1 for s in segments if s.get("bus") and (s["bus"].get("buslines") or []))
    num_transfers = max(0, bus_count - 1)

    return {
        "transit_time_minutes": round(dur_sec / 60.0, 2),
        "distance_m": _int_val(best.get("distance")),
        "cost": best.get("cost", ""),
        "walking_distance_m": _int_val(best.get("walking_distance")),
        "num_transfers": num_transfers,
        "breakdown": breakdown,
    }


def route_compounds(force: bool = False, limit: int | None = None) -> pd.DataFrame:
    """
    For each compound in guangzhou_compounds.geojson, compute transit time to SCUT.
    Results are cached in compound_transit_cache.csv (append-safe for resume).

    Args:
        force: if True, delete existing cache and re-fetch everything
        limit: if set, only process this many compounds (for testing)

    Returns:
        Full cache DataFrame.
    """
    scut = ensure_scut_location(force=False)
    dest_lon, dest_lat = scut["lon"], scut["lat"]
    logger.info("Destination: SCUT (%.6f, %.6f)", dest_lon, dest_lat)

    path_compounds = get_data_path(GUANGZHOU_COMPOUNDS_GEOJSON)
    path_cache = get_data_path(COMPOUND_TRANSIT_CACHE_CSV)

    if not path_compounds.exists():
        raise FileNotFoundError(f"Compounds GeoJSON not found: {path_compounds}")

    if not AMAP_WEB_SERVICE_KEY:
        raise ValueError("AMAP_KEY env var required for transit routing")

    compounds = load_json(path_compounds)
    if not compounds or not compounds.get("features"):
        raise ValueError("No features in compounds GeoJSON")

    features = compounds["features"]
    if limit:
        features = features[:limit]

    if force and path_cache.exists():
        path_cache.unlink()
        logger.info("Cleared compound transit cache (force mode)")

    cached = load_csv(path_cache)
    cached_ids = set()
    if not cached.empty and "poi_id" in cached.columns:
        cached_ids = set(cached["poi_id"].astype(str))
    logger.info("Loaded %d cached results; %d compounds total", len(cached_ids), len(features))

    to_fetch = []
    for feat in features:
        props = feat.get("properties") or {}
        poi_id = str(props.get("poi_id", ""))
        if poi_id and poi_id not in cached_ids:
            to_fetch.append(feat)

    if not to_fetch:
        logger.info("All %d compounds already cached", len(features))
        return load_csv(path_cache) if path_cache.exists() else pd.DataFrame()

    logger.info("Need to fetch transit times for %d compounds", len(to_fetch))
    new_rows = []
    total = len(to_fetch)

    for idx, feat in enumerate(to_fetch):
        props = feat.get("properties") or {}
        poi_id = str(props.get("poi_id", ""))
        name = props.get("name", "")
        clon = float(props.get("centroid_lon", 0))
        clat = float(props.get("centroid_lat", 0))

        if clon == 0 or clat == 0:
            logger.warning("Skipping compound %s: no centroid", poi_id)
            continue

        result = _query_transit(clon, clat, dest_lon, dest_lat)

        new_rows.append({
            "poi_id": poi_id,
            "name": name,
            "centroid_lon": clon,
            "centroid_lat": clat,
            **result,
        })

        if len(new_rows) >= TRANSIT_PROGRESS_LOG_EVERY_N:
            append_csv(path_cache, pd.DataFrame(new_rows))
            logger.info("Progress: %d / %d (wrote %d rows to cache)", idx + 1, total, len(new_rows))
            new_rows = []
        elif (idx + 1) % 50 == 0:
            logger.info("Progress: %d / %d", idx + 1, total)

    if new_rows:
        append_csv(path_cache, pd.DataFrame(new_rows))
        logger.info("Wrote final %d rows to cache", len(new_rows))

    result_df = load_csv(path_cache)
    ok = result_df[result_df["transit_time_minutes"] < TRANSIT_NO_ROUTE_SENTINEL] if not result_df.empty else result_df
    logger.info(
        "Done. Cache has %d compounds: %d with routes, %d no-route",
        len(result_df), len(ok), len(result_df) - len(ok),
    )
    return result_df
