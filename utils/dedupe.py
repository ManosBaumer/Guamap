"""
Spatial deduplication of stops using DBSCAN with Haversine distance.
eps=25m; one representative stop per cluster.
"""
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

from config import DEDUP_RADIUS_M, EARTH_RADIUS_M


def haversine_distance_matrix_rad(pts_rad: np.ndarray) -> np.ndarray:
    """
    Compute pairwise Haversine distances (radians) for (n, 2) array of (lat_rad, lon_rad).
    Returns (n, n) matrix in meters (multiply radians by EARTH_RADIUS_M).
    """
    n = pts_rad.shape[0]
    lat = pts_rad[:, 0]
    lon = pts_rad[:, 1]
    dlat = np.subtract.outer(lat, lat)
    dlon = np.subtract.outer(lon, lon)
    a = np.sin(dlat / 2) ** 2 + np.cos(lat) * np.cos(lat[:, np.newaxis]) * np.sin(dlon / 2) ** 2
    dist_rad = 2 * np.arcsin(np.minimum(np.sqrt(np.maximum(a, 0)), 1))
    return (dist_rad * EARTH_RADIUS_M).astype(np.float64)


def dedupe_stops(df: pd.DataFrame) -> pd.DataFrame:
    """
    Deduplicate stops within DEDUP_RADIUS_M using DBSCAN.
    df must have columns: lat, lon, and at least one of [stop_id, name, type].
    Returns one row per cluster (first occurrence as representative).
    """
    if df.empty:
        return df.copy()

    coords = df[["lat", "lon"]].values.astype(np.float64)
    coords_rad = np.radians(coords)

    # Distance matrix in meters
    dist_m = haversine_distance_matrix_rad(coords_rad)
    # DBSCAN with precomputed metric: eps in same units as dist_m (meters)
    clustering = DBSCAN(eps=DEDUP_RADIUS_M, min_samples=1, metric="precomputed")
    labels = clustering.fit_predict(dist_m)

    # One representative per cluster: first row in each cluster
    seen = set()
    indices = []
    for i, label in enumerate(labels):
        if label not in seen:
            seen.add(label)
            indices.append(i)

    result = df.iloc[indices].copy()
    # Ensure stop_id is unique (use cluster label or original id)
    if "stop_id" not in result.columns:
        result["stop_id"] = [str(i) for i in range(len(result))]
    return result.reset_index(drop=True)
