"""
Load transit-time sample points in WGS-84 for heatmaps and grid hover.
Used by generate_combined_heatmap.py and prepare_frontend_data.prepare_grid_hover.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def _anjuke_coord_system_from_raw(raw: dict) -> str:
    v = raw.get("_guamap_coord_system")
    if isinstance(v, str) and v.strip():
        return v.strip().lower()
    from config import ANJUKE_COORD_SYSTEM

    return ANJUKE_COORD_SYSTEM


def load_grid_points() -> list[tuple[float, float, float]]:
    """Grid travel times (GCJ-02 in CSV) -> WGS84."""
    from utils.coord_transform import gcj02_to_wgs84

    path = DATA / "grid_travel_times.csv"
    if not path.exists():
        return []
    out: list[tuple[float, float, float]] = []
    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            try:
                lat = float(row.get("lat", 0))
                lon = float(row.get("lon", 0))
                t = float(row.get("travel_time_minutes", -1))
            except (TypeError, ValueError):
                continue
            if t < 0:
                continue
            lon_w, lat_w = gcj02_to_wgs84(lon, lat)
            out.append((lat_w, lon_w, t))
    return out


def load_community_points() -> list[tuple[float, float, float]]:
    """Anjuke communities: BD-09/GCJ/WGS per config -> WGS84."""
    from utils.coord_transform import anjuke_raw_to_wgs84

    path = DATA / "anjuke_communities.json"
    if not path.exists():
        return []
    raw = json.loads(path.read_text("utf-8"))
    coord_sys = _anjuke_coord_system_from_raw(raw)
    out: list[tuple[float, float, float]] = []
    for ckey, cobj in raw.items():
        if str(ckey).startswith("_") or not isinstance(cobj, dict):
            continue
        try:
            lat_raw = float(cobj.get("lat", 0))
            lng_raw = float(cobj.get("lng", 0))
            t = cobj.get("transit_duration_min")
        except (TypeError, ValueError):
            continue
        if not lat_raw or not lng_raw or t is None or float(t) <= 0:
            continue
        lon_w, lat_w = anjuke_raw_to_wgs84(lng_raw, lat_raw, coord_sys)
        out.append((lat_w, lon_w, float(t)))
    return out


def load_compound_centroid_points() -> list[tuple[float, float, float]]:
    """Residential compound centroids + transit (GCJ in CSV) -> WGS84."""
    from utils.coord_transform import gcj02_to_wgs84

    path = DATA / "compound_transit_cache.csv"
    if not path.exists():
        return []
    out: list[tuple[float, float, float]] = []
    with open(path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                lon = float(row.get("centroid_lon") or 0)
                lat = float(row.get("centroid_lat") or 0)
                t = float(
                    row.get("transit_time_minutes")
                    or row.get("transit_time")
                    or -1
                )
            except (TypeError, ValueError):
                continue
            if not lat or not lon or t < 0 or t >= 900:
                continue
            lon_w, lat_w = gcj02_to_wgs84(lon, lat)
            out.append((lat_w, lon_w, t))
    return out


def load_stop_points() -> list[tuple[float, float, float]]:
    """Transit stops (GCJ in CSV) -> WGS84."""
    from utils.coord_transform import gcj02_to_wgs84

    path = DATA / "stops_with_transit_times.csv"
    if not path.exists():
        return []
    out: list[tuple[float, float, float]] = []
    with open(path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                lat_gcj = float(row.get("lat", 0))
                lon_gcj = float(row.get("lon", 0))
                t = float(row.get("transit_time_minutes", -1))
            except (TypeError, ValueError):
                continue
            if not lat_gcj or not lon_gcj or t < 0:
                continue
            lon_w, lat_w = gcj02_to_wgs84(lon_gcj, lat_gcj)
            out.append((lat_w, lon_w, t))
    return out
