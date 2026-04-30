"""Configuration and constants for Guangzhou SCUT commute isochrone pipeline."""
import os
from pathlib import Path

# Load .env from project root if present (optional)
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent
    load_dotenv(_root / ".env")
except ImportError:
    pass

# API key: from environment or .env (AMAP_KEY)
AMAP_WEB_SERVICE_KEY = os.environ.get("AMAP_KEY", "")

# Anjuke community lat/lng are typically BD-09 (Baidu). Plotting them as WGS on OSM puts pins in the river.
# Options: "bd09" (default), "gcj02" (Gaode/Amap), "wgs84" (already GPS). Override via GUAMAP_ANJUKE_COORD_SYSTEM
# or JSON top-level "_guamap_coord_system".
ANJUKE_COORD_SYSTEM = os.environ.get("GUAMAP_ANJUKE_COORD_SYSTEM", "bd09").strip().lower()

# Destination (Campus Town 大学城, not Wushan 五山)
SCUT_ADDRESS = "华南理工大学(大学城校区)"
SCUT_POI_KEYWORDS = "华南理工大学大学城校区"
SCUT_FALLBACK_ADDRESS = "广州市番禺区广州大学城外环西路100号"
GEOCODE_CITY = "广州"
# Panyu adcode where 大学城 is located (optional for POI search)
PANYU_ADCODE = "440113"

# Districts (adcode for Amap)
DISTRICTS = [
    ("440103", "荔湾区"),   # Liwan
    ("440104", "越秀区"),   # Yuexiu
    ("440105", "海珠区"),   # Haizhu
    ("440106", "天河区"),   # Tianhe
]

# Guangzhou citycode for transit API
GUANGZHOU_CITYCODE = "020"

# POI search keywords for transit stops (bus + metro variants to overcome 200-result cap per query)
POI_KEYWORDS = [
    "公交站", "公交车站", "公交站点", "公交站台",  # bus
    "巴士站", "公交枢纽",  # extra bus coverage for sparse areas
    "地铁站",  # metro
]

# Walking and spatial
WALKING_SPEED_MPS = 1.3  # m/s ≈ 4.7 km/h
DEDUP_RADIUS_M = 25
EARTH_RADIUS_M = 6_371_000

# Grid (~60k points, ~70-80 m spacing)
GRID_SPACING_M = 75
NEAREST_STOPS_K = 8

# Transit
TRANSIT_DEPARTURE_TIME = "10:00"  # 10:00 AM
TRANSIT_NO_ROUTE_SENTINEL = 999.0  # minutes

# API resilience
RATE_LIMIT_DELAY_MS = 75  # 50-100 ms between requests
RETRY_BACKOFF_BASE_S = 1
RETRY_MAX_ATTEMPTS = 5
TRANSIT_PROGRESS_LOG_EVERY_N = 200

# Paths (data dir relative to project root)
PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"

def get_data_path(name: str) -> Path:
    """Return path for a data file under data/."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR / name

# Data file names
SCUT_LOCATION_JSON = "scut_location.json"
SCUT_VERIFICATION_HTML = "scut_verification.html"
DISTRICT_POLYGONS_JSON = "district_polygons.json"
STOPS_RAW_CSV = "stops_raw.csv"
STOPS_DEDUPED_CSV = "stops_deduped.csv"
STOPS_WITH_TRANSIT_CSV = "stops_with_transit_times.csv"
GRID_TRAVEL_TIMES_CSV = "grid_travel_times.csv"
GUANGZHOU_METRO_GEOJSON = "guangzhou_metro_lines.geojson"
GUANGZHOU_COMPOUNDS_GEOJSON = "guangzhou_compounds.geojson"
COMPOUND_TRANSIT_CACHE_CSV = "compound_transit_cache.csv"
COMMUTE_HEATMAP_HTML = "commute_heatmap.html"
