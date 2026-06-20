"""
BallTree with Haversine metric for nearest-stop queries.
Coordinates in radians; distances from sklearn are in radians (convert to meters for walk time).
"""
import numpy as np
from sklearn.neighbors import BallTree

from routing.cache import get_valid_stops_for_analysis
from config import EARTH_RADIUS_M


def build_balltree_stops() -> tuple[BallTree, np.ndarray, np.ndarray]:
    """
    Build BallTree on stop coordinates (radians) and return transit_time in seconds per index.
    Returns (tree, transit_seconds_array, coords_rad) where coords_rad is (n, 2) lat_rad, lon_rad.
    """
    df = get_valid_stops_for_analysis()
    if df.empty:
        raise ValueError("No valid stops in transit cache")

    coords = df[["lat", "lon"]].values.astype(np.float64)
    coords_rad = np.radians(coords)
    transit_minutes = df["transit_time_minutes"].values.astype(np.float64)
    transit_seconds = transit_minutes * 60.0

    tree = BallTree(coords_rad, metric="haversine")
    return tree, transit_seconds, coords_rad
