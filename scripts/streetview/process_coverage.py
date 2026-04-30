"""
Convert raw scraped panorama data into frontend-ready files:
  1. GeoJSON coverage lines (for map overlay)
  2. Spatial index (for nearest-pano lookup when the user drops the pegman)

Usage:
    python scripts/streetview/process_coverage.py [--provider baidu|tencent|both]

Reads:
    data/streetview/baidu_panos.json
    data/streetview/tencent_panos.json

Writes:
    frontend/public/data/streetview_baidu.geojson
    frontend/public/data/streetview_tencent.geojson
    frontend/public/data/streetview_baidu_index.json
    frontend/public/data/streetview_tencent_index.json
"""

import argparse
import json
import logging
import math
from pathlib import Path

from coord_convert import gcj02_to_wgs84

LOG = logging.getLogger("process_sv")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "streetview"
OUT_DIR = PROJECT_ROOT / "frontend" / "public" / "data"


def load_panos(provider: str) -> dict:
    path = RAW_DIR / f"{provider}_panos.json"
    if not path.exists():
        LOG.warning("No data file found: %s", path)
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _approx_dist_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Approximate distance in meters for small offsets.

    Panos are close to each other; this keeps build_edges fast.
    """
    R = 111_320.0
    lat_mid = math.radians((lat1 + lat2) / 2.0)
    cos_lat = math.cos(lat_mid) if lat_mid else 1.0
    dlat = (lat2 - lat1) * R
    dlng = (lng2 - lng1) * R * cos_lat
    return math.hypot(dlat, dlng)


def _angle_diff_deg(a: float, b: float) -> float:
    """Smallest absolute angular difference in degrees."""
    d = (a - b) % 360.0
    if d > 180.0:
        d = 360.0 - d
    return d


def _bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Initial bearing from (lat1,lng1) to (lat2,lng2) in degrees [0,360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_lng = math.radians(lng2 - lng1)

    y = math.sin(d_lng) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lng)
    brng = math.degrees(math.atan2(y, x))
    return (brng + 360.0) % 360.0


def build_edges(panos: dict, provider: str) -> set[tuple[str, str]]:
    """Build deduplicated undirected edges from panorama link data.

    Both Tencent and Baidu use heading-based filtering: each pano connects only
    to its best "front" and "back" road-following neighbor. This creates long
    degree-2 chains along roads rather than a dense clique of short dashes.
    """
    edges = set()
    max_neighbors = 3   # fallback if heading selection finds nothing
    heading_tol_deg = 40.0
    for pid, p in panos.items():
        lat_a = p["lat"]
        lng_a = p["lng"]

        candidates: list[tuple[str, float]] = []
        for lid in p.get("links", []):
            if lid not in panos:
                continue
            if provider == "tencent":
                ra = str(p.get("road", "") or "").strip()
                rb = str(panos[lid].get("road", "") or "").strip()
                if ra and rb and ra != rb:
                    continue
            lat_b = panos[lid]["lat"]
            lng_b = panos[lid]["lng"]
            d_m = _approx_dist_m(lat_a, lng_a, lat_b, lng_b)
            candidates.append((lid, d_m))

        try:
            heading = float(p.get("heading", 0) or 0)
        except (TypeError, ValueError):
            heading = 0.0

        # Pick at most one "front" and one "back" continuation neighbor
        # based on heading alignment. This prevents connecting across
        # intersections and reduces parallel/duplicate chains.
        best_front: tuple[float, str] | None = None  # (diff_deg, lid)
        best_back: tuple[float, str] | None = None

        for lid, _d in candidates:
            lat_b = panos[lid]["lat"]
            lng_b = panos[lid]["lng"]
            bearing = _bearing_deg(lat_a, lng_a, lat_b, lng_b)
            diff_front = _angle_diff_deg(bearing, heading)
            diff_back = _angle_diff_deg(bearing, (heading + 180.0) % 360.0)

            if diff_front <= diff_back:
                if diff_front <= heading_tol_deg:
                    if best_front is None or diff_front < best_front[0]:
                        best_front = (diff_front, lid)
            else:
                if diff_back <= heading_tol_deg:
                    if best_back is None or diff_back < best_back[0]:
                        best_back = (diff_back, lid)

        added = 0
        for best in (best_front, best_back):
            if not best:
                continue
            _diff, lid = best
            a, b = (pid, lid) if pid < lid else (lid, pid)
            if (a, b) not in edges:
                edges.add((a, b))
                added += 1

        # Fallback: if heading-based selection found nothing, use nearest neighbors.
        if added == 0:
            candidates.sort(key=lambda x: x[1])
            for lid, _d in candidates[:max_neighbors]:
                a, b = (pid, lid) if pid < lid else (lid, pid)
                edges.add((a, b))
    return edges


def extract_road_chains(panos: dict, edges: set[tuple[str, str]]) -> list[list[str]]:
    """Extract chains of connected panos for clean polyline rendering.

    Degree-2 nodes are interior to a road segment; degree != 2 nodes are
    intersections or dead ends that form chain boundaries.
    """
    adj: dict[str, list[str]] = {pid: [] for pid in panos}
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)

    visited_edges: set[tuple[str, str]] = set()
    chains: list[list[str]] = []

    start_nodes = [pid for pid, nbrs in adj.items() if len(nbrs) != 2]
    if not start_nodes:
        start_nodes = list(adj.keys())[:1]

    for start in start_nodes:
        for nbr in adj[start]:
            edge_key = (start, nbr) if start < nbr else (nbr, start)
            if edge_key in visited_edges:
                continue
            chain = [start]
            prev, cur = start, nbr
            while True:
                ek = (prev, cur) if prev < cur else (cur, prev)
                visited_edges.add(ek)
                chain.append(cur)
                nbrs = adj[cur]
                if len(nbrs) != 2:
                    break
                nxt = nbrs[0] if nbrs[1] == prev else nbrs[1]
                prev, cur = cur, nxt
            if len(chain) >= 2:
                chains.append(chain)

    # Catch any edges missed (isolated loops of degree-2 nodes)
    for a, b in edges:
        ek = (a, b) if a < b else (b, a)
        if ek not in visited_edges:
            chains.append([a, b])
            visited_edges.add(ek)

    return chains


def simplify_chain(coords: list[list[float]], tolerance: float = 0.00006) -> list[list[float]]:
    """Douglas-Peucker line simplification. coords are [lng, lat]."""
    if len(coords) <= 2:
        return coords

    def perp_dist(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx == 0 and dy == 0:
            return math.hypot(p[0] - a[0], p[1] - a[1])
        t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        proj = [a[0] + t * dx, a[1] + t * dy]
        return math.hypot(p[0] - proj[0], p[1] - proj[1])

    max_dist = 0
    max_idx = 0
    for i in range(1, len(coords) - 1):
        d = perp_dist(coords[i], coords[0], coords[-1])
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > tolerance:
        left = simplify_chain(coords[: max_idx + 1], tolerance)
        right = simplify_chain(coords[max_idx:], tolerance)
        return left[:-1] + right
    return [coords[0], coords[-1]]


def panos_to_geojson(panos: dict, provider: str) -> dict:
    """Convert panorama data to GeoJSON FeatureCollection of coverage lines."""
    edges = build_edges(panos, provider)
    LOG.info("  %d edges from %d panos", len(edges), len(panos))

    chains = extract_road_chains(panos, edges)
    LOG.info("  %d road chains extracted", len(chains))

    # We previously dropped short chains to simplify the visual lines, but this
    # resulted in "hidden" panoramas that existed in the spatial index (could be
    # clicked) but had no visible blue line on the map. We now keep all chains.
    MIN_CHAIN_METERS = 0.0

    def approx_chain_length_m(line: list[list[float]]) -> float:
        """Approx polyline length in meters.

        coords are [lng, lat] in degrees.
        """
        if len(line) < 2:
            return 0.0
        # 1 deg ~= 111.32 km in lat; lon scales by cos(lat).
        R = 111_320.0
        lat_mid = math.radians((line[0][1] + line[-1][1]) / 2.0)
        cos_lat = math.cos(lat_mid) if lat_mid else 1.0
        length = 0.0
        for i in range(1, len(line)):
            lng0, lat0 = line[i - 1]
            lng1, lat1 = line[i]
            dlat = (lat1 - lat0) * R
            dlng = (lng1 - lng0) * R * cos_lat
            length += math.hypot(dlat, dlng)
        return length

    multilines: list[list[list[float]]] = []
    for chain in chains:
        coords = []
        for pid in chain:
            p = panos[pid]
            # Export in GCJ-02. The frontend pane offset (TencentCoveragePaneOffset)
            # applies a GCJ→screen pixel shift so lines align with the basemap.
            coords.append([round(p["lng"], 6), round(p["lat"], 6)])
        # Provider-specific tolerance to smooth out noisy pano-to-pano hops.
        tol = 0.00008 if provider == "tencent" else 0.00006
        coords = simplify_chain(coords, tolerance=tol)
        if len(coords) >= 2 and approx_chain_length_m(coords) >= MIN_CHAIN_METERS:
            multilines.append(coords)

    if not multilines:
        return {"type": "FeatureCollection", "features": []}

    # Huge feature counts make Leaflet unusable. A single MultiLineString
    # keeps the renderer work similar but drastically cuts layer overhead.
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "MultiLineString", "coordinates": multilines},
                "properties": {},
            }
        ],
    }


def panos_to_spatial_index(panos: dict, cell_size: float = 0.001) -> dict:
    """Build a grid-based spatial index for fast nearest-pano lookup in the browser.

    Output format:
    {
        "cellSize": 0.001,
        "cells": {
            "23137_113328": [{"id": "...", "lat": ..., "lng": ..., "h": ..., "d": "..."}],
            ...
        }
    }
    """
    cells: dict[str, list[dict]] = {}
    for p in panos.values():
        lat, lng = gcj02_to_wgs84(p["lat"], p["lng"])
        row = int(lat / cell_size)
        col = int(lng / cell_size)
        key = f"{row}_{col}"
        entry = {
            "id": p["id"],
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "h": round(p.get("heading", 0), 1),
        }
        date = p.get("date", "")
        if date:
            entry["d"] = date
        cells.setdefault(key, []).append(entry)

    return {"cellSize": cell_size, "cells": cells}


def process_provider(provider: str):
    LOG.info("Processing %s...", provider)
    panos = load_panos(provider)
    if not panos:
        LOG.warning("No panorama data for %s — skipping", provider)
        return

    LOG.info("  loaded %d panoramas", len(panos))

    geojson = panos_to_geojson(panos, provider)
    geojson_path = OUT_DIR / f"streetview_{provider}.geojson"
    with open(geojson_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)
    size_mb = geojson_path.stat().st_size / (1024 * 1024)
    LOG.info("  coverage GeoJSON: %d features, %.1f MB → %s",
             len(geojson["features"]), size_mb, geojson_path)

    index = panos_to_spatial_index(panos)
    index_path = OUT_DIR / f"streetview_{provider}_index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)
    size_mb = index_path.stat().st_size / (1024 * 1024)
    LOG.info("  spatial index: %d cells, %.1f MB → %s",
             len(index["cells"]), size_mb, index_path)


def main():
    parser = argparse.ArgumentParser(description="Process scraped panorama data for frontend")
    parser.add_argument(
        "--provider",
        choices=["baidu", "tencent", "both"],
        default="both",
        help="Which provider to process (default: both)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    providers = ["baidu", "tencent"] if args.provider == "both" else [args.provider]
    for p in providers:
        process_provider(p)

    LOG.info("Done.")


if __name__ == "__main__":
    main()
