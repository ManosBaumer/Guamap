"""
Convert a street view coverage GeoJSON (MultiLineString) into a PMTiles file
using pure Python (mapbox_vector_tile + pmtiles).

Usage:
    python scripts/streetview/geojson_to_pmtiles.py --provider baidu
    python scripts/streetview/geojson_to_pmtiles.py --provider tencent

Reads:
    frontend/public/data/streetview_{provider}.geojson

Writes:
    frontend/public/data/lines_{provider}.pmtiles
"""

import argparse
import gzip
import json
import logging
import math
from pathlib import Path

import mapbox_vector_tile
from pmtiles.writer import Writer
from pmtiles.tile import TileType, Compression

LOG = logging.getLogger("geojson_to_pmtiles")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "frontend" / "public" / "data"

MIN_ZOOM = 5
MAX_ZOOM = 14
EXTENT = 4096


# ---------------------------------------------------------------------------
# Coordinate / tile helpers
# ---------------------------------------------------------------------------

def lon_to_tx(lon: float, zoom: int) -> float:
    return (lon + 180.0) / 360.0 * (2 ** zoom)


def lat_to_ty(lat: float, zoom: int) -> float:
    lat_r = math.radians(lat)
    return (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * (2 ** zoom)


def lon_lat_to_tile(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    n = 2 ** zoom
    x = int(lon_to_tx(lon, zoom))
    y = int(lat_to_ty(lat, zoom))
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tile_to_bbox(x: int, y: int, zoom: int) -> tuple[float, float, float, float]:
    n = 2 ** zoom

    def x_to_lon(tx): return tx / n * 360.0 - 180.0

    def y_to_lat(ty): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))

    return x_to_lon(x), y_to_lat(y + 1), x_to_lon(x + 1), y_to_lat(y)


# ---------------------------------------------------------------------------
# Line-tile intersection: collect every tile that each line segment touches
# ---------------------------------------------------------------------------

def tiles_for_line(coords: list, zoom: int) -> set[tuple[int, int]]:
    """
    Return the set of (tx, ty) tiles that a polyline *intersects* at `zoom`.

    Uses DDA rasterization on each segment in tile-space, so lines that cross
    a tile boundary are recorded in *both* tiles — no gaps.
    """
    touched: set[tuple[int, int]] = set()
    n = 2 ** zoom

    for i in range(len(coords) - 1):
        lon0, lat0 = coords[i]
        lon1, lat1 = coords[i + 1]

        tx0 = lon_to_tx(lon0, zoom)
        ty0 = lat_to_ty(lat0, zoom)
        tx1 = lon_to_tx(lon1, zoom)
        ty1 = lat_to_ty(lat1, zoom)

        # Number of steps = max tile-span in either axis + 1
        steps = max(1, int(max(abs(tx1 - tx0), abs(ty1 - ty0))) + 1)

        for s in range(steps + 1):
            t = s / steps
            tx = tx0 + t * (tx1 - tx0)
            ty = ty0 + t * (ty1 - ty0)
            ix = int(tx)
            iy = int(ty)
            if 0 <= ix < n and 0 <= iy < n:
                touched.add((ix, iy))

    return touched


# ---------------------------------------------------------------------------
# Cohen–Sutherland line clipping to a bbox
# ---------------------------------------------------------------------------

INSIDE, LEFT, RIGHT, BOTTOM, TOP = 0, 1, 2, 4, 8


def _cs_code(x, y, xmin, ymin, xmax, ymax):
    code = INSIDE
    if x < xmin:   code |= LEFT
    elif x > xmax: code |= RIGHT
    if y < ymin:   code |= BOTTOM
    elif y > ymax: code |= TOP
    return code


def clip_segment(x0, y0, x1, y1, xmin, ymin, xmax, ymax):
    """Cohen–Sutherland. Returns clipped (x0,y0,x1,y1) or None if outside."""
    c0 = _cs_code(x0, y0, xmin, ymin, xmax, ymax)
    c1 = _cs_code(x1, y1, xmin, ymin, xmax, ymax)
    while True:
        if not (c0 | c1):   # both inside
            return x0, y0, x1, y1
        if c0 & c1:         # both outside same half-plane
            return None
        c_out = c0 if c0 else c1
        if c_out & TOP:
            x = x0 + (x1 - x0) * (ymax - y0) / (y1 - y0)
            y = ymax
        elif c_out & BOTTOM:
            x = x0 + (x1 - x0) * (ymin - y0) / (y1 - y0)
            y = ymin
        elif c_out & RIGHT:
            y = y0 + (y1 - y0) * (xmax - x0) / (x1 - x0)
            x = xmax
        else:
            y = y0 + (y1 - y0) * (xmin - x0) / (x1 - x0)
            x = xmin
        if c_out == c0:
            x0, y0, c0 = x, y, _cs_code(x, y, xmin, ymin, xmax, ymax)
        else:
            x1, y1, c1 = x, y, _cs_code(x, y, xmin, ymin, xmax, ymax)


def clip_polyline_to_bbox(coords, xmin, ymin, xmax, ymax):
    """Clip a polyline to bbox. Returns list of sub-polylines (each ≥ 2 pts)."""
    result = []
    seg = []
    for i in range(len(coords) - 1):
        x0, y0 = coords[i]
        x1, y1 = coords[i + 1]
        clipped = clip_segment(x0, y0, x1, y1, xmin, ymin, xmax, ymax)
        if clipped is None:
            if seg:
                result.append(seg)
                seg = []
            continue
        cx0, cy0, cx1, cy1 = clipped
        if not seg:
            seg = [[cx0, cy0]]
        elif seg[-1] != [cx0, cy0]:
            # Gap — start a new sub-line
            result.append(seg)
            seg = [[cx0, cy0]]
        seg.append([cx1, cy1])
    if seg:
        result.append(seg)
    return result


# ---------------------------------------------------------------------------
# Build a single MVT tile
# ---------------------------------------------------------------------------

def build_tile_mvt(x: int, y: int, zoom: int, multiline_coords: list) -> bytes | None:
    min_lon, min_lat, max_lon, max_lat = tile_to_bbox(x, y, zoom)

    features = []
    for line in multiline_coords:
        sub_lines = clip_polyline_to_bbox(line, min_lon, min_lat, max_lon, max_lat)
        for seg in sub_lines:
            if len(seg) < 2:
                continue
            wkt = "LINESTRING (" + ", ".join(f"{c[0]} {c[1]}" for c in seg) + ")"
            features.append({"geometry": wkt, "properties": {}})

    if not features:
        return None

    layer = {"name": "sv", "features": features}
    tile_data = mapbox_vector_tile.encode(
        [layer],
        default_options={
            "quantize_bounds": (min_lon, min_lat, max_lon, max_lat),
            "extents": EXTENT,
        },
    )
    return gzip.compress(tile_data)


# ---------------------------------------------------------------------------
# Hilbert-curve tile ID (PMTiles v3 spec)
# ---------------------------------------------------------------------------

def zxy_to_tileid(z: int, x: int, y: int) -> int:
    if z == 0:
        return 0
    base = sum(4 ** i for i in range(z))
    n = 2 ** z
    d = 0
    s = n >> 1
    rx, ry = x, y
    while s > 0:
        rx_bit = 1 if (rx & s) > 0 else 0
        ry_bit = 1 if (ry & s) > 0 else 0
        d += s * s * ((3 * rx_bit) ^ ry_bit)
        if ry_bit == 0:
            if rx_bit == 1:
                rx = s - 1 - rx
                ry = s - 1 - ry
            rx, ry = ry, rx
        s >>= 1
    return base + d


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Convert street view GeoJSON to PMTiles")
    parser.add_argument("--provider", choices=["baidu", "tencent"], required=True)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    geojson_path = DATA_DIR / f"streetview_{args.provider}.geojson"
    out_path = DATA_DIR / f"lines_{args.provider}.pmtiles"

    LOG.info("Loading %s...", geojson_path)
    with open(geojson_path, "r", encoding="utf-8") as f:
        geojson = json.load(f)

    multiline_coords: list[list] = []
    for feature in geojson.get("features", []):
        geom = feature.get("geometry", {})
        if geom.get("type") == "MultiLineString":
            multiline_coords.extend(geom.get("coordinates", []))
        elif geom.get("type") == "LineString":
            multiline_coords.append(geom.get("coordinates", []))

    LOG.info("Loaded %d line segments", len(multiline_coords))

    # Collect tiles using proper DDA line rasterization
    LOG.info("Indexing tiles from z%d to z%d (DDA line rasterization)...", MIN_ZOOM, MAX_ZOOM)
    tile_set: dict[int, set[tuple[int, int]]] = {z: set() for z in range(MIN_ZOOM, MAX_ZOOM + 1)}
    for line in multiline_coords:
        for z in range(MIN_ZOOM, MAX_ZOOM + 1):
            for tile in tiles_for_line(line, z):
                tile_set[z].add(tile)

    total_tiles = sum(len(v) for v in tile_set.values())
    LOG.info("Total tiles to encode: %d", total_tiles)

    tiles: dict[int, bytes] = {}
    done = 0
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        for tx, ty in tile_set[z]:
            mvt = build_tile_mvt(tx, ty, z, multiline_coords)
            if mvt:
                tile_id = zxy_to_tileid(z, tx, ty)
                tiles[tile_id] = mvt
            done += 1
            if done % 500 == 0:
                LOG.info("  encoded %d/%d tiles...", done, total_tiles)

    LOG.info("Encoded %d non-empty tiles", len(tiles))

    LOG.info("Writing %s...", out_path)
    with open(out_path, "wb") as f:
        writer = Writer(f)
        for tile_id in sorted(tiles.keys()):
            writer.write_tile(tile_id, tiles[tile_id])
        writer.finalize(
            {
                "tile_compression": Compression.GZIP,
                "tile_type": TileType.MVT,
                "min_zoom": MIN_ZOOM,
                "max_zoom": MAX_ZOOM,
                "min_lon_e7": int(-180 * 10_000_000),
                "max_lon_e7": int(180 * 10_000_000),
                "min_lat_e7": int(-85 * 10_000_000),
                "max_lat_e7": int(85 * 10_000_000),
                "center_zoom": 10,
                "center_lon_e7": int(113.3 * 10_000_000),
                "center_lat_e7": int(23.1 * 10_000_000),
            },
            {},
        )

    size_mb = out_path.stat().st_size / (1024 * 1024)
    LOG.info("Done! Written %.1f MB → %s", size_mb, out_path)


if __name__ == "__main__":
    main()
