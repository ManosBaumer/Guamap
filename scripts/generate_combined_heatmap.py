"""
Build combined transit heatmap rasters (grid + Anjuke + compound centroids + stops)
and Anjuke-only community rasters. Writes to frontend/public/data and data/heatmap_rasters.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from heatmap_point_sources import (
    load_community_points,
    load_compound_centroid_points,
    load_grid_points,
    load_stop_points,
)
from heatmap_raster_gen import generate_heatmap_rasters, write_bounds_json

DATA = ROOT / "data"
FRONT_DATA = ROOT / "frontend" / "public" / "data"


def main() -> None:
    grid = load_grid_points()
    comm = load_community_points()
    compounds = load_compound_centroid_points()
    stops = load_stop_points()

    combined: list[tuple[float, float, float]] = []
    combined.extend(grid)
    combined.extend(comm)
    combined.extend(compounds)
    combined.extend(stops)

    print(
        f"  Heatmap points: grid={len(grid)}, anjuke={len(comm)}, "
        f"compounds={len(compounds)}, stops={len(stops)} -> total={len(combined)}"
    )

    if not combined:
        print("  Skipping heatmap rasters: no points")
        return

    lats = np.array([p[0] for p in combined], dtype=np.float64)
    lons = np.array([p[1] for p in combined], dtype=np.float64)
    times = np.array([p[2] for p in combined], dtype=np.float64)

    for label, dest in (
        ("frontend", FRONT_DATA / "heatmap_rasters"),
        ("data/", DATA / "heatmap_rasters"),
    ):
        print(f"  Generating combined rasters ({label})...")
        bounds = generate_heatmap_rasters(
            lats,
            lons,
            times,
            dest,
            grid_method="linear",
            max_neighbor_distance_deg=None,
        )
        print(f"    bounds: {bounds}")

    write_bounds_json(bounds, FRONT_DATA / "heatmap_bounds.json")

    # Anjuke-only heatmap (same interpolation pipeline)
    if not comm:
        print("  Skipping community-only heatmap: no Anjuke points")
        return

    clats = np.array([p[0] for p in comm], dtype=np.float64)
    clons = np.array([p[1] for p in comm], dtype=np.float64)
    ctimes = np.array([p[2] for p in comm], dtype=np.float64)
    print(f"  Generating Anjuke-only rasters ({len(comm)} points)...")
    cb = generate_heatmap_rasters(
        clats,
        clons,
        ctimes,
        FRONT_DATA / "community_heatmap_rasters",
        grid_method="linear",
        max_neighbor_distance_deg=0.012,
    )
    write_bounds_json(cb, FRONT_DATA / "community_heatmap_bounds.json")
    print(f"    community bounds: {cb}")


if __name__ == "__main__":
    main()
