"""
GCJ-02 to WGS84 coordinate conversion (visualization only).
Exact wandergis/coordTransform_py algorithm; pure Python, no external deps.
Pipeline stays in GCJ-02; conversion only for map display.
"""
import math

# Constants from wandergis coordTransform_py
_A = 6378245.0
_EE = 0.00669342162296594323


def _out_of_china(lon: float, lat: float) -> bool:
    return not (73.66 < lon < 135.05 and 3.86 < lat < 53.55)


def _transform_lat(lon: float, lat: float) -> float:
    ret = -100.0 + 2.0 * lon + 3.0 * lat + 0.2 * lat * lat
    ret += 0.1 * lon * lat + 0.2 * math.sqrt(math.fabs(lon))
    ret += (20.0 * math.sin(6.0 * lon * math.pi) + 20.0 * math.sin(2.0 * lon * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(lat * math.pi) + 40.0 * math.sin(lat / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(lat / 12.0 * math.pi) + 320.0 * math.sin(lat * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lon(lon: float, lat: float) -> float:
    ret = 300.0 + lon + 2.0 * lat + 0.1 * lon * lon
    ret += 0.1 * lon * lat + 0.1 * math.sqrt(math.fabs(lon))
    ret += (20.0 * math.sin(6.0 * lon * math.pi) + 20.0 * math.sin(2.0 * lon * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(lon * math.pi) + 40.0 * math.sin(lon / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (150.0 * math.sin(lon / 12.0 * math.pi) + 300.0 * math.sin(lon / 30.0 * math.pi)) * 2.0 / 3.0
    return ret


def bd09_to_gcj02(lon_bd: float, lat_bd: float) -> tuple[float, float]:
    """BD-09 (Baidu) to GCJ-02. Returns (lon_gcj, lat_gcj)."""
    x = lon_bd - 0.0065
    y = lat_bd - 0.006
    z = math.sqrt(x * x + y * y) - 0.00002 * math.sin(y * math.pi)
    theta = math.atan2(y, x) - 0.000003 * math.cos(x * math.pi)
    return (z * math.cos(theta), z * math.sin(theta))


def bd09_to_wgs84(lon_bd: float, lat_bd: float) -> tuple[float, float]:
    """BD-09 (Baidu) to WGS84. Returns (lon_wgs, lat_wgs)."""
    lon_g, lat_g = bd09_to_gcj02(lon_bd, lat_bd)
    return gcj02_to_wgs84(lon_g, lat_g)


def anjuke_raw_to_wgs84(lon: float, lat: float, coord_system: str) -> tuple[float, float]:
    """
    Convert Anjuke/scraped community coordinates to WGS-84 for OSM/Leaflet.

    coord_system (case-insensitive):
      - wgs84 / gps / none / raw — already WGS-84, use as-is
      - gcj02 / gcj / amap / gaode / mars — China Mars offset (Gaode/Amap)
      - bd09 / bd / baidu — Baidu Maps
    """
    s = (coord_system or "wgs84").strip().lower()
    if s in ("wgs84", "wgs", "gps", "none", "raw", "epsg4326"):
        return (lon, lat)
    if s in ("gcj02", "gcj", "amap", "gaode", "mars"):
        return gcj02_to_wgs84(lon, lat)
    if s in ("bd09", "bd", "baidu"):
        return bd09_to_wgs84(lon, lat)
    raise ValueError(
        f"Unknown coord_system {coord_system!r}; use wgs84, gcj02, or bd09"
    )


def gcj02_to_wgs84(lon_gcj: float, lat_gcj: float) -> tuple[float, float]:
    """
    GCJ-02 to WGS84. Returns (lon_wgs, lat_wgs).
    Exact wandergis coordTransform_py formula.
    """
    if _out_of_china(lon_gcj, lat_gcj):
        return (lon_gcj, lat_gcj)
    dlat = _transform_lat(lon_gcj - 105.0, lat_gcj - 35.0)
    dlon = _transform_lon(lon_gcj - 105.0, lat_gcj - 35.0)
    radlat = lat_gcj / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - _EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrtmagic) * math.pi)
    dlon = (dlon * 180.0) / (_A / sqrtmagic * math.cos(radlat) * math.pi)
    mglat = lat_gcj + dlat
    mglng = lon_gcj + dlon
    return (lon_gcj * 2 - mglng, lat_gcj * 2 - mglat)


def gcj02_to_wgs84_array(
    lons_gcj, lats_gcj,
) -> tuple:
    """Batch convert GCJ-02 to WGS84. Returns (lons_wgs, lats_wgs)."""
    import numpy as np

    lons_gcj = np.atleast_1d(np.asarray(lons_gcj, dtype=np.float64))
    lats_gcj = np.atleast_1d(np.asarray(lats_gcj, dtype=np.float64))
    n = lons_gcj.size
    if lats_gcj.size != n:
        raise ValueError("lons_gcj and lats_gcj must have the same size")
    lons_wgs = np.empty(n, dtype=np.float64)
    lats_wgs = np.empty(n, dtype=np.float64)
    for i in range(n):
        lons_wgs[i], lats_wgs[i] = gcj02_to_wgs84(
            float(lons_gcj.flat[i]), float(lats_gcj.flat[i])
        )
    return (lons_wgs.reshape(lons_gcj.shape), lats_wgs.reshape(lats_gcj.shape))
