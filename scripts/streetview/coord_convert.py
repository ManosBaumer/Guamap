"""
Coordinate conversion between WGS-84 (GPS), GCJ-02 (China standard), and BD-09 (Baidu).

Also includes point-in-polygon test and district polygon loading for grid filtering.
"""

import json
import math
from pathlib import Path

# Krasovsky 1940 ellipsoid
_A = 6378245.0
_EE = 0.00669342162296594
_X_PI = math.pi * 3000.0 / 180.0

DISTRICTS_GEOJSON = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data" / "districts.geojson"


def _out_of_china(lat: float, lng: float) -> bool:
    return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _transform_lat(x: float, y: float) -> float:
    r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    r += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    r += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    r += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return r


def _transform_lng(x: float, y: float) -> float:
    r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    r += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    r += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    r += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return r


def wgs84_to_gcj02(lat: float, lng: float) -> tuple[float, float]:
    if _out_of_china(lat, lng):
        return lat, lng
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lng(lng - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * math.pi
    magic = math.sin(rad_lat)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrt_magic) * math.pi)
    dlng = (dlng * 180.0) / (_A / sqrt_magic * math.cos(rad_lat) * math.pi)
    return lat + dlat, lng + dlng


def gcj02_to_wgs84(lat: float, lng: float) -> tuple[float, float]:
    g_lat, g_lng = wgs84_to_gcj02(lat, lng)
    return lat - (g_lat - lat), lng - (g_lng - lng)


def gcj02_to_bd09(lat: float, lng: float) -> tuple[float, float]:
    z = math.sqrt(lng * lng + lat * lat) + 0.00002 * math.sin(lat * _X_PI)
    theta = math.atan2(lat, lng) + 0.000003 * math.cos(lng * _X_PI)
    return z * math.sin(theta) + 0.006, z * math.cos(theta) + 0.0065


def bd09_to_gcj02(lat: float, lng: float) -> tuple[float, float]:
    x = lng - 0.0065
    y = lat - 0.006
    z = math.sqrt(x * x + y * y) - 0.00002 * math.sin(y * _X_PI)
    theta = math.atan2(y, x) - 0.000003 * math.cos(x * _X_PI)
    return z * math.sin(theta), z * math.cos(theta)


def wgs84_to_bd09(lat: float, lng: float) -> tuple[float, float]:
    gcj = wgs84_to_gcj02(lat, lng)
    return gcj02_to_bd09(*gcj)


def bd09_to_wgs84(lat: float, lng: float) -> tuple[float, float]:
    gcj = bd09_to_gcj02(lat, lng)
    return gcj02_to_wgs84(*gcj)


# --- Baidu BD-09 Mercator (BD09MC), used by mapsv0.bdimg.com ?qt=qsdata ---
# Algorithm from bd09convertor (MIT); x/y are plane coordinates in meters.

_MCBAND = (12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0)
_MC2LL = (
    (
        1.410526172116255e-8,
        0.00000898305509648872,
        -1.9939833816331,
        200.9824383106796,
        -187.2403703815547,
        91.6087516669843,
        -23.38765649603339,
        2.57121317296198,
        -0.03801003308653,
        17337981.2,
    ),
    (
        -7.435856389565537e-9,
        0.000008983055097726239,
        -0.78625201886289,
        96.32687599759846,
        -1.85204757529826,
        -59.36935905485877,
        47.40033549296737,
        -16.50741931063887,
        2.28786674699375,
        10260144.86,
    ),
    (
        -3.030883460898826e-8,
        0.00000898305509983578,
        0.30071316287616,
        59.74293618442277,
        7.357984074871,
        -25.38371002664745,
        13.45380521110908,
        -3.29883767235584,
        0.32710905363475,
        6856817.37,
    ),
    (
        -1.981981304930552e-8,
        0.000008983055099779535,
        0.03278182852591,
        40.31678527705744,
        0.65659298677277,
        -4.44255534477492,
        0.85341911805263,
        0.12923347998204,
        -0.04625736007561,
        4482777.06,
    ),
    (
        3.09191371068437e-9,
        0.000008983055096812155,
        0.00006995724062,
        23.10934304144901,
        -0.00023663490511,
        -0.6321817810242,
        -0.00663494467273,
        0.03430082397953,
        -0.00466043876332,
        2555164.4,
    ),
    (
        2.890871144776878e-9,
        0.000008983055095805407,
        -3.068298e-8,
        7.47137025468032,
        -0.00000353937994,
        -0.02145144861037,
        -0.00001234426596,
        0.00010322952773,
        -0.00000323890364,
        826088.5,
    ),
)
_LLBAND = [75, 60, 45, 30, 15, 0]
_LL2MC = (
    [
        -0.0015702102444,
        111320.7020616939,
        1704480524535203,
        -10338987376042340,
        26112667856603880,
        -35149669176653700,
        26595700718403920,
        -10725012454188240,
        1800819912950474,
        82.5,
    ],
    [
        0.0008277824516172526,
        111320.7020463578,
        647795574.6671607,
        -4082003173.641316,
        10774905663.51142,
        -15171875531.51559,
        12053065338.62167,
        -5124939663.577472,
        913311935.9512032,
        67.5,
    ],
    [
        0.00337398766765,
        111320.7020202162,
        4481351.045890365,
        -23393751.19931662,
        79682215.47186455,
        -115964993.2797253,
        97236711.15602145,
        -43661946.33752821,
        8477230.501135234,
        52.5,
    ],
    [
        0.00220636496208,
        111320.7020209128,
        51751.86112841131,
        3796837.749470245,
        992013.7397791013,
        -1221952.21711287,
        1340652.697009075,
        -620943.6990984312,
        144416.9293806241,
        37.5,
    ],
    [
        -0.0003441963504368392,
        111320.7020576856,
        278.2353980772752,
        2485758.690035394,
        6070.750963243378,
        54821.18345352118,
        9540.606633304236,
        -2710.55326746645,
        1405.483844121726,
        22.5,
    ],
    [
        -0.0003218135878613132,
        111320.7020701615,
        0.00369383431289,
        823725.6402795718,
        0.46104986909093,
        2351.343141331292,
        1.58060784298199,
        8.77738589078284,
        0.37238884252424,
        7.45,
    ],
)


def _mc_get_range(v: float, lo: float, hi: float) -> float:
    return min(v, hi)


def _mc_get_loop(v: float, lo: float, hi: float) -> float:
    while v > hi:
        v -= hi - lo
    while v < lo:
        v += hi - lo
    return v


def _mc_convertor(lng: float, lat: float, coeffs: list[float]) -> tuple[float, float]:
    t = coeffs[0] + coeffs[1] * abs(lng)
    c = abs(lat) / coeffs[9]
    f = (
        coeffs[2]
        + coeffs[3] * c
        + coeffs[4] * c * c
        + coeffs[5] * c * c * c
        + coeffs[6] * c * c * c * c
        + coeffs[7] * c * c * c * c * c
        + coeffs[8] * c * c * c * c * c * c
    )
    t *= -1 if lng < 0 else 1
    f *= -1 if lat < 0 else 1
    return t, f


def bd09mc_to_bd09_ll(mc_x: float, mc_y: float) -> tuple[float, float]:
    """BD09 Mercator meters → BD-09 (lng, lat) degrees."""
    ay = abs(mc_y)
    coeffs = None
    for i, band in enumerate(_MCBAND):
        if ay >= band:
            coeffs = _MC2LL[i]
            break
    if coeffs is None:
        coeffs = _MC2LL[-1]
    lng, lat = _mc_convertor(mc_x, mc_y, list(coeffs))
    return lng, lat


def bd09_ll_to_mc(bd_lng: float, bd_lat: float) -> tuple[float, float]:
    """BD-09 (lng, lat) degrees → BD09 Mercator meters."""
    lng = _mc_get_loop(bd_lng, -180, 180)
    lat = _mc_get_range(bd_lat, -74, 74)
    coeffs = None
    for i, band in enumerate(_LLBAND):
        if lat >= band:
            coeffs = _LL2MC[i]
            break
    if coeffs is None:
        coeffs = _LL2MC[-1]
    return _mc_convertor(lng, lat, list(coeffs))


def gcj02_to_bd09_mc(lat_gcj: float, lng_gcj: float) -> tuple[float, float]:
    """GCJ-02 → Baidu Mercator (for ?qt=qsdata)."""
    bd_lat, bd_lng = gcj02_to_bd09(lat_gcj, lng_gcj)
    return bd09_ll_to_mc(bd_lng, bd_lat)


def bd09mc_meters_to_gcj02(mc_x: float, mc_y: float) -> tuple[float, float]:
    """Mercator meters as in API X/100, Y/100 → GCJ-02 (lat, lng)."""
    bd_lng, bd_lat = bd09mc_to_bd09_ll(mc_x, mc_y)
    return bd09_to_gcj02(bd_lat, bd_lng)


# --- Tencent Maps street view plane coordinates (sv.map.qq.com) → GCJ-02 ---
# Same convention as documented for QQ/Soso SV (x/y are not lng/lat degrees).

_TENCENT_SV_A = 114.59155902616465
_TENCENT_SV_SCALE = 111319.49077777778


def tencent_plane_xy_to_gcj02(x: float, y: float) -> tuple[float, float]:
    """Tencent SV (x, y) → GCJ-02 (lat, lng)."""
    lng = x / _TENCENT_SV_SCALE
    lat = _TENCENT_SV_A * math.atan(math.exp(math.radians(y / _TENCENT_SV_SCALE))) - 90.0
    return lat, lng


def point_in_ring(lat: float, lng: float, ring: list[list[float]]) -> bool:
    """Ray-casting point-in-polygon. Ring coords are [lng, lat] (GeoJSON order)."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][1], ring[i][0]  # lat, lng
        xj, yj = ring[j][1], ring[j][0]
        if ((yi > lng) != (yj > lng)) and (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def load_district_rings() -> list[list[list[float]]]:
    """Load the 4 district polygon rings from districts.geojson.
    Returns list of rings, each ring is [[lng, lat], ...] in GeoJSON order."""
    with open(DISTRICTS_GEOJSON, "r", encoding="utf-8") as f:
        fc = json.load(f)
    rings = []
    for feat in fc["features"]:
        geom = feat["geometry"]
        if geom["type"] == "Polygon":
            rings.append(geom["coordinates"][0])
    return rings


def point_in_any_district(lat: float, lng: float, rings: list[list[list[float]]]) -> bool:
    return any(point_in_ring(lat, lng, r) for r in rings)


def district_bbox(rings: list[list[list[float]]], pad: float = 0.003) -> tuple[float, float, float, float]:
    """Return (min_lat, max_lat, min_lng, max_lng) with optional padding."""
    all_lats = [c[1] for r in rings for c in r]
    all_lngs = [c[0] for r in rings for c in r]
    return (
        min(all_lats) - pad,
        max(all_lats) + pad,
        min(all_lngs) - pad,
        max(all_lngs) + pad,
    )


def generate_grid(rings: list[list[list[float]]], spacing: float = 0.002) -> list[tuple[float, float]]:
    """Generate grid points (lat, lng) inside the district polygons.
    Coordinates are in the same system as districts.geojson (GCJ-02)."""
    min_lat, max_lat, min_lng, max_lng = district_bbox(rings, pad=0.0)
    points = []
    lat = min_lat
    while lat <= max_lat:
        lng = min_lng
        while lng <= max_lng:
            if point_in_any_district(lat, lng, rings):
                points.append((lat, lng))
            lng += spacing
        lat += spacing
    return points
