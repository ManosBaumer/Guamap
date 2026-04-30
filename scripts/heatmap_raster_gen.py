"""
Shared heatmap raster generation (same logic as visualization/map_builder.py).
Writes PNG rasters + returns bounds dict for Leaflet ImageOverlay.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from matplotlib import use as mpl_use

mpl_use("Agg")
from matplotlib.colors import LinearSegmentedColormap
from PIL import Image
from scipy.interpolate import griddata
from scipy.spatial import cKDTree

TIME_ANCHORS = [0, 45, 58, 70, 80]
NORM_ANCHORS = [0, 45 / 80, 58 / 80, 70 / 80, 1.0]
COLOR_ANCHORS = ["#00cc00", "#00cc00", "#ffff00", "#ff8800", "#ff0000"]

RASTER_SIZE = 500
THRESHOLD_STEP = 10
THRESHOLD_MAX = 120


def _time_to_normalized(t: float) -> float:
    return float(np.clip(np.interp(t, TIME_ANCHORS, NORM_ANCHORS), 0.0, 1.0))


def _build_colormap():
    return LinearSegmentedColormap.from_list(
        "travel_time",
        list(zip(NORM_ANCHORS, COLOR_ANCHORS)),
        N=256,
    )


def generate_heatmap_rasters(
    lats: np.ndarray,
    lons: np.ndarray,
    times: np.ndarray,
    out_dir: Path,
    *,
    grid_method: str = "linear",
    max_neighbor_distance_deg: float | None = None,
) -> dict[str, float]:
    """
    Interpolate travel time onto a grid (WGS84), write heatmap_t{10..120}.png.
    Returns bounds dict: south, west, north, east.

    grid_method: "linear" avoids cubic overshoot (fake green pockets between sparse samples).
    max_neighbor_distance_deg: if set, hide pixels farther than this (deg) from any sample
    (~0.012 deg ~ 1.3 km latitude) — use for sparse Anjuke-only heatmaps.
    """
    if len(lats) == 0:
        raise ValueError("No points for heatmap")

    lon_min, lon_max = float(lons.min()), float(lons.max())
    lat_min, lat_max = float(lats.min()), float(lats.max())
    margin = 0.002
    lon_min -= margin
    lon_max += margin
    lat_min -= margin
    lat_max += margin

    xi = np.linspace(lon_min, lon_max, RASTER_SIZE)
    yi = np.linspace(lat_min, lat_max, RASTER_SIZE)
    XI, YI = np.meshgrid(xi, yi)

    Z = griddata((lons, lats), times, (XI, YI), method=grid_method, fill_value=np.nan)

    if max_neighbor_distance_deg is not None and max_neighbor_distance_deg > 0:
        tree = cKDTree(np.column_stack([lons, lats]))
        grid_pts = np.column_stack([XI.ravel(), YI.ravel()])
        dist, _ = tree.query(grid_pts, k=1)
        dist = dist.reshape(XI.shape)
        Z = np.where(dist <= max_neighbor_distance_deg, Z, np.nan)

    Z = np.clip(Z, 0, 150)
    finite_z = np.isfinite(Z)
    norm = np.zeros_like(Z, dtype=np.float64)
    norm[finite_z] = np.vectorize(_time_to_normalized)(Z[finite_z])

    cmap = _build_colormap()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for thresh in range(THRESHOLD_STEP, THRESHOLD_MAX + 1, THRESHOLD_STEP):
        mask = finite_z & (Z <= thresh)
        rgba = cmap(norm)
        rgba[..., 3] = np.where(mask, 0.55, 0.0)
        rgba = (np.clip(rgba, 0, 1) * 255).astype(np.uint8)
        rgba = np.flipud(rgba)
        Image.fromarray(rgba).save(out_dir / f"heatmap_t{thresh}.png")

    return {
        "south": round(lat_min, 6),
        "north": round(lat_max, 6),
        "west": round(lon_min, 6),
        "east": round(lon_max, 6),
    }


def write_bounds_json(bounds: dict[str, float], path: Path) -> None:
    path.write_text(json.dumps(bounds), encoding="utf-8")
