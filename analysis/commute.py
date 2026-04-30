"""
For each grid point: k nearest stops via BallTree, walk_seconds + transit_seconds, min → travel_time_minutes.
"""
import numpy as np
import pandas as pd

from config import WALKING_SPEED_MPS, NEAREST_STOPS_K, EARTH_RADIUS_M
from grid_generation.grid import build_grid_inside_districts
from analysis.spatial import build_balltree_stops


def compute_grid_travel_times() -> pd.DataFrame:
    """
    Build grid (inside districts), BallTree on valid stops; for each point compute
    travel_time_minutes = min over k nearest of (walk_seconds + transit_seconds) / 60.
    Returns DataFrame: lat, lon, travel_time_minutes.
    """
    tree, transit_seconds, coords_rad = build_balltree_stops()
    grid = build_grid_inside_districts()  # (N, 2) lat, lon

    k = min(NEAREST_STOPS_K, len(transit_seconds))
    grid_rad = np.radians(grid)
    # BallTree returns distances in radians (for haversine)
    dist_rad, indices = tree.query(grid_rad, k=k)
    dist_m = dist_rad * EARTH_RADIUS_M
    walk_seconds = dist_m / WALKING_SPEED_MPS  # (n_grid, k)
    transit_sec = transit_seconds[indices]     # (n_grid, k)
    total_seconds = walk_seconds + transit_sec
    travel_minutes = np.min(total_seconds, axis=1) / 60.0

    return pd.DataFrame({
        "lat": grid[:, 0],
        "lon": grid[:, 1],
        "travel_time_minutes": travel_minutes,
    })
