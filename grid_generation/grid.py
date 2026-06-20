"""
Generate a regular grid over the merged district bbox; keep only points inside the polygon.
Spacing ~150 m. Returns array of (lat, lon) in GCJ-02.
"""
import math

import numpy as np
from shapely.geometry import Point

from config import GRID_SPACING_M, EARTH_RADIUS_M
from data_collection.district_api import load_merged_polygon


def _meters_to_lat_lon(dy_m: float, dx_m: float, center_lat: float) -> tuple[float, float]:
    """Convert meter deltas to approximate lat/lon deltas at given latitude."""
    lat_rad = math.radians(center_lat)
    dlat = dy_m / EARTH_RADIUS_M
    dlon = dx_m / (EARTH_RADIUS_M * math.cos(lat_rad))
    return math.degrees(dlat), math.degrees(dlon)


def build_grid_inside_districts() -> np.ndarray:
    """
    Build grid of (lat, lon) points inside the merged district polygon.
    Returns (N, 2) array with columns [lat, lon].
    """
    poly = load_merged_polygon()
    if poly is None:
        raise FileNotFoundError("District polygons not found. Run Stage 1 district fetch.")

    minx, miny, maxx, maxy = poly.bounds
    center_lat = (miny + maxy) / 2
    dlat, dlon = _meters_to_lat_lon(GRID_SPACING_M, GRID_SPACING_M, center_lat)

    lats = np.arange(miny, maxy + dlat / 2, dlat)
    lons = np.arange(minx, maxx + dlon / 2, dlon)
    points = []
    for lat in lats:
        for lon in lons:
            pt = Point(lon, lat)
            if poly.contains(pt) or poly.intersects(pt):
                points.append([lat, lon])
    if not points:
        raise RuntimeError("No grid points inside district polygon")
    return np.array(points, dtype=np.float64)
