"""
Guangzhou SCUT Commute Isochrone Heatmap — full pipeline.

Stage 1: Geocode SCUT, fetch district polygons, POI stops (5 keywords × 4 districts),
         deduplicate stops, transit routing to SCUT (10:00 AM).
Stage 2: Grid inside districts, BallTree nearest stops, walk + transit time per point.
Visualization: Folium map (heatmap or isochrone bands), SCUT marker, optional stops.

Usage:
  python main.py                    # run full pipeline
  python main.py --skip-stage1      # skip API stage (use caches)
  python main.py --skip-stage2     # skip grid + commute
  python main.py --skip-viz        # skip map generation
  python main.py --force-geocode   # re-fetch SCUT location
  python main.py --force-poi       # re-fetch POI stops
  python main.py --force-transit   # re-fetch all transit times
  python main.py --force-districts # re-fetch district polygons
"""
import argparse
import logging
import sys

from config import get_data_path, STOPS_RAW_CSV, STOPS_DEDUPED_CSV, GRID_TRAVEL_TIMES_CSV

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")


def run_stage1(args: argparse.Namespace) -> None:
    """Geocode SCUT, districts, POI, dedupe, transit cache."""
    from data_collection.geocoding import ensure_scut_location
    from data_collection.district_api import ensure_district_polygons
    from data_collection.poi_search import fetch_all_stops
    from data_collection.station_lines import ensure_stop_lines
    from data_collection.transit_routing import ensure_transit_times
    from config import get_data_path
    from utils.dedupe import dedupe_stops
    from utils.io import save_csv

    ensure_scut_location(force=args.force_geocode)
    ensure_district_polygons(force=args.force_districts)
    raw = fetch_all_stops(force=args.force_poi)
    if raw.empty:
        logger.warning("No raw stops; check API key and network")
        return
    deduped = dedupe_stops(raw)
    save_csv(get_data_path(STOPS_DEDUPED_CSV), deduped)
    logger.info("Deduplicated stops: %d -> %d", len(raw), len(deduped))
    ensure_stop_lines(force=args.force_lines)
    ensure_transit_times(force=args.force_transit)


def run_stage2(args: argparse.Namespace) -> None:
    """Grid inside districts, BallTree, commute times."""
    from analysis.commute import compute_grid_travel_times
    from utils.io import save_csv

    df = compute_grid_travel_times()
    save_csv(get_data_path(GRID_TRAVEL_TIMES_CSV), df)
    logger.info("Grid travel times: %d points -> %s", len(df), get_data_path(GRID_TRAVEL_TIMES_CSV))


def run_viz(args: argparse.Namespace) -> None:
    """Build Folium map (default: isochrone contours + all stops)."""
    from visualization.map_builder import build_commute_map

    path = build_commute_map(use_contours=args.contours, add_stops_layer=not args.no_stops)
    logger.info("Open in browser: file://%s", path.resolve())


def main() -> int:
    parser = argparse.ArgumentParser(description="Guangzhou SCUT commute isochrone heatmap")
    parser.add_argument("--skip-stage1", action="store_true", help="Skip Stage 1 (use cached API data)")
    parser.add_argument("--skip-stage2", action="store_true", help="Skip Stage 2 (grid + commute)")
    parser.add_argument("--skip-viz", action="store_true", help="Skip map generation")
    parser.add_argument("--force-geocode", action="store_true", help="Re-fetch SCUT geocode")
    parser.add_argument("--force-poi", action="store_true", help="Re-fetch POI stops")
    parser.add_argument("--force-transit", action="store_true", help="Re-fetch transit times")
    parser.add_argument("--force-districts", action="store_true", help="Re-fetch district polygons")
    parser.add_argument("--force-lines", action="store_true", help="Re-fetch bus/metro lines per stop")
    parser.add_argument("--contours", action="store_true", default=True, help="Use isochrone contour bands (default)")
    parser.add_argument("--no-contours", action="store_false", dest="contours", help="Use heatmap instead of isochrones")
    parser.add_argument("--no-stops", action="store_true", help="Do not add transit stops layer to map")
    args = parser.parse_args()

    try:
        if not args.skip_stage1:
            run_stage1(args)
        else:
            logger.info("Skipping Stage 1")
            if args.force_lines:
                from data_collection.station_lines import ensure_stop_lines
                ensure_stop_lines(force=True)

        if not args.skip_stage2:
            run_stage2(args)
        else:
            logger.info("Skipping Stage 2")

        if not args.skip_viz:
            run_viz(args)
        else:
            logger.info("Skipping visualization")

        return 0
    except Exception as e:
        logger.exception("%s", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
