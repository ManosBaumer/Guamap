"""Refresh stop data: fetch POIs, dedupe, export frontend stops.json.

Stop line names (Amap /v3/bus/stopname) are NOT fetched by default — that API has a
strict daily quota. Pass --force-lines only if you deliberately want to refresh line
data and have quota available.
"""
import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

logger = logging.getLogger("refresh_stops")


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh transit stops for the map")
    parser.add_argument("--force-poi", action="store_true", help="Re-fetch stops from Amap POI APIs")
    parser.add_argument(
        "--force-lines",
        action="store_true",
        help="Re-fetch line names via Amap stopname API (strict quota — opt-in only)",
    )
    args = parser.parse_args()

    from config import get_data_path, STOPS_DEDUPED_CSV
    from data_collection.poi_search import fetch_all_stops
    from utils.dedupe import dedupe_stops
    from utils.io import save_csv

    raw = fetch_all_stops(force=args.force_poi)
    if raw.empty:
        logger.error("No raw stops fetched")
        return 1

    deduped = dedupe_stops(raw)
    save_csv(get_data_path(STOPS_DEDUPED_CSV), deduped)
    logger.info("Deduped stops: %d -> %d", len(raw), len(deduped))

    if args.force_lines:
        from data_collection.station_lines import ensure_stop_lines

        logger.warning(
            "Fetching stop lines uses Amap /v3/bus/stopname (strict daily quota)."
        )
        ensure_stop_lines(force=True)

    scripts_dir = ROOT / "scripts"
    sys.path.insert(0, str(scripts_dir))
    from prepare_frontend_data import OUT, prepare_stops

    OUT.mkdir(parents=True, exist_ok=True)
    logger.info("Exporting frontend/public/data/stops.json …")
    prepare_stops()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
