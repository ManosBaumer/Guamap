"""
Preprocess raw data files into optimized JSON for the React frontend.
Outputs go into frontend/public/data/.
"""
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import ANJUKE_COORD_SYSTEM
from utils.coord_transform import gcj02_to_wgs84, anjuke_raw_to_wgs84

try:
    from anjuke_off_market import tag_off_market_title
except ImportError:
    OFF_MARKET_TAG = "【已下架】"

    def tag_off_market_title(title: str) -> str:
        title = (title or "").strip()
        if OFF_MARKET_TAG in title:
            return title
        return f"{OFF_MARKET_TAG}{title}" if title else OFF_MARKET_TAG

try:
    from pypinyin import pinyin, Style as PinyinStyle
    _HAS_PYPINYIN = True
except ImportError:
    _HAS_PYPINYIN = False

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "frontend" / "public" / "data"

DISTRICT_EN = {
    "天河": "Tianhe", "越秀": "Yuexiu", "海珠": "Haizhu", "荔湾": "Liwan",
    "白云": "Baiyun", "黄埔": "Huangpu", "番禺": "Panyu", "花都": "Huadu",
    "南沙": "Nansha", "增城": "Zengcheng", "从化": "Conghua",
}

AJK_IMG_RE = re.compile(r"/anjuke/([0-9a-f]{20,})/")


def _anjuke_coord_system_from_raw(raw: dict) -> str:
    """JSON may set top-level \"_guamap_coord_system\": \"gcj02\" | \"wgs84\" | \"bd09\"."""
    v = raw.get("_guamap_coord_system")
    if isinstance(v, str) and v.strip():
        return v.strip().lower()
    return ANJUKE_COORD_SYSTEM


def to_pinyin(text: str) -> str:
    if not _HAS_PYPINYIN or not text:
        return ""
    return " ".join(s[0].capitalize() for s in pinyin(text, style=PinyinStyle.NORMAL))


def ajk_img_hash(url: str) -> str:
    m = AJK_IMG_RE.search(url or "")
    return m.group(1) if m else ""


def _parse_bedroom_bathroom(rhval: str, des: str, title: str) -> Tuple[int, Optional[int]]:
    """Bedrooms from 室 in rhval (e.g. 4室2厅); bathrooms from N卫 in rhval, des, or title."""
    rhval = str(rhval or "").strip()
    des = str(des or "")
    title = str(title or "")
    bedroom = 0
    m = re.search(r"(\d+)\s*室", rhval)
    if m:
        bedroom = int(m.group(1))
    else:
        m0 = re.match(r"(\d+)", rhval)
        if m0:
            bedroom = int(m0.group(1))
    bathroom: Optional[int] = None
    for src in (rhval, des, title):
        mb = re.search(r"(\d+)\s*卫", src)
        if mb:
            bathroom = int(mb.group(1))
            break
    return bedroom, bathroom


def prepare_anjuke():
    """Build community index + per-community listing files."""
    comm_path = DATA / "anjuke_communities.json"
    listings_path = DATA / "anjuke_listings_raw.jsonl"
    if not comm_path.exists() or not listings_path.exists():
        print("  Skipping Anjuke: source files not found")
        return

    raw_comm = json.loads(comm_path.read_text("utf-8"))
    coord_sys = _anjuke_coord_system_from_raw(raw_comm)
    name_to_comm: dict[str, dict] = {}

    for ckey, cobj in raw_comm.items():
        if str(ckey).startswith("_") or not isinstance(cobj, dict):
            continue
        lat_raw = float(cobj.get("lat", 0))
        lng_raw = float(cobj.get("lng", 0))
        if not lat_raw or not lng_raw:
            continue
        lng_w, lat_w = anjuke_raw_to_wgs84(lng_raw, lat_raw, coord_sys)
        cname = cobj.get("name", "")
        transit_min = cobj.get("transit_duration_min")
        transit_segs = cobj.get("transit_segments") or []
        compact_segs = []
        for seg in transit_segs:
            cs = {"type": seg.get("type", ""), "dur": seg.get("duration_s", 0)}
            if seg.get("type") == "transit":
                cs["line"] = seg.get("line", "")
                cs["from"] = seg.get("departure", "")
                cs["to"] = seg.get("arrival", "")
                cs["stops"] = seg.get("via_stops", "")
            elif seg.get("distance_m"):
                cs["dist"] = seg.get("distance_m", 0)
            compact_segs.append(cs)

        name_to_comm[cname] = {
            "id": ckey,
            "name": cname,
            "nameEn": to_pinyin(cname),
            "lat": round(lat_w, 6),
            "lng": round(lng_w, 6),
            "buildDate": cobj.get("build_date", ""),
            "district": cobj.get("_district", ""),
            "districtEn": DISTRICT_EN.get(cobj.get("_district", ""), ""),
            "block": cobj.get("_block_name", ""),
            "transitMin": round(float(transit_min), 1) if transit_min and float(transit_min) > 0 else -1,
            "transitCost": float(cobj.get("transit_cost", 0) or 0),
            "transitSegments": compact_segs if transit_min and float(transit_min) > 0 else [],
            "listings": [],
            "_ckey": ckey,  # temporary — used below to look up anjukeId
        }

    # Load Anjuke community view IDs (scraped separately via scrape_community_ids.py)
    comm_anjuke_ids_path = DATA / "community_anjuke_ids.json"
    comm_anjuke_ids: dict[str, str] = {}
    if comm_anjuke_ids_path.exists():
        try:
            comm_anjuke_ids = json.loads(comm_anjuke_ids_path.read_text("utf-8"))
        except json.JSONDecodeError:
            pass

    # Inject anjukeId into each community and clean up temp key
    for comm in name_to_comm.values():
        ck = comm.pop("_ckey", "")
        anjuke_id = comm_anjuke_ids.get(str(ck), "")
        if anjuke_id:
            comm["anjukeId"] = anjuke_id

    amenities_cache_path = DATA / "amenities_cache.json"
    amenities_cache = {}
    if amenities_cache_path.exists():
        try:
            amenities_cache = json.loads(amenities_cache_path.read_text("utf-8"))
        except json.JSONDecodeError:
            pass

    active_ids: set[str] = set()

    def append_listing_row(li: dict, *, force_off_market: bool = False) -> None:
        cname = li.get("community_name", "")
        comm = name_to_comm.get(cname)
        if not comm:
            return
        lid = str(li.get("id", ""))
        if lid and not force_off_market:
            active_ids.add(lid)
        imgs = [ajk_img_hash(u) for u in (li.get("prop_images") or [])[:8] if u]
        imgs = [h for h in imgs if h]
        des = re.sub(r"<br\s*/?>", " ", str(li.get("des", "") or "")).replace("\n", " ").strip()[:300]
        rooms = li.get("rhval", "")
        title = str(li.get("title", "") or "")
        if force_off_market:
            title = tag_off_market_title(title)
        bedroom_count, bathroom_count = _parse_bedroom_bathroom(rooms, des, title)

        comm["listings"].append({
            "id": li.get("id"),
            "title": title,
            "price": li.get("price", 0),
            "area": li.get("area", ""),
            "orient": li.get("orient", ""),
            "rentType": li.get("rent_type_name", ""),
            "rooms": rooms,
            "roomCount": bedroom_count,
            "bathroomCount": bathroom_count,
            "des": des,
            "metro": li.get("metro_info", ""),
            "floor": li.get("floor_des", ""),
            "imgHashes": imgs,
            "amenities": amenities_cache.get(str(li.get("id")), []),
        })

    with open(listings_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                li = json.loads(line)
            except json.JSONDecodeError:
                continue
            append_listing_row(li)

    off_market_path = DATA / "anjuke_off_market.jsonl"
    off_market_ids: set[str] = set()
    if off_market_path.exists():
        with open(off_market_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    li = json.loads(line)
                except json.JSONDecodeError:
                    continue
                lid = str(li.get("id", ""))
                if not lid or lid in active_ids:
                    continue
                off_market_ids.add(lid)
                append_listing_row(li, force_off_market=True)

    listings_dir = OUT / "listings"
    listings_dir.mkdir(parents=True, exist_ok=True)

    index_metadata = []
    index = []
    total_listings = 0
    for cname, comm in name_to_comm.items():
        listings = comm.pop("listings")
        if not listings:
            continue
        
        # Build compact metadata for this community's listings
        cid = comm["id"]
        for l in listings:
            # We only keep fields needed by listingMatchesFilters
            meta = {
                "id": l["id"],
                "c": cid,
                "p": l["price"],
                "a": l["area"],
                "o": l["orient"],
                "rt": l["rentType"],
                "rc": l["roomCount"],
                "bc": l["bathroomCount"],
                "m": l["metro"],
                "am": l["amenities"]
            }
            index_metadata.append(meta)

        prices = [l["price"] for l in listings if l["price"] and l["price"] > 0]
        comm["listingCount"] = len(listings)
        comm["priceMin"] = min(prices) if prices else 0
        comm["priceMax"] = max(prices) if prices else 0
        index.append(comm)
        total_listings += len(listings)

        cid = comm["id"]
        listing_file = listings_dir / f"{cid}.json"
        listing_file.write_text(json.dumps(listings, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    index_file = OUT / "communities.json"
    index_file.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    
    meta_file = OUT / "listings_metadata.json"
    meta_file.write_text(json.dumps(index_metadata, separators=(",", ":")), encoding="utf-8")

    valid_community_ids = {comm["id"] for comm in index}
    removed_files = 0
    for stale in listings_dir.glob("*.json"):
        if stale.stem not in valid_community_ids:
            stale.unlink()
            removed_files += 1

    print(f"  Anjuke: {len(index)} communities, {total_listings} listings (coords {coord_sys} -> WGS84)")
    if off_market_ids:
        print(f"  Off-market listings included: {len(off_market_ids)}")
    if removed_files:
        print(f"  Removed stale listing files: {removed_files}")
    print(f"  Index: {index_file.stat().st_size / 1024:.0f} KB")
    print(f"  Metadata: {meta_file.stat().st_size / 1024:.0f} KB")


def prepare_stops():
    """Convert deduped stops CSV to JSON with WGS84 coords and prefetched line names."""
    import csv

    deduped_path = DATA / "stops_deduped.csv"
    stops_path = deduped_path if deduped_path.exists() else DATA / "stops_raw.csv"
    if not stops_path.exists():
        print("  Skipping stops: stops_deduped.csv / stops_raw.csv not found")
        return

    stops = []
    with_lines = 0
    with open(stops_path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                lat_gcj = float(row.get("lat", 0))
                lon_gcj = float(row.get("lon", 0))
            except (TypeError, ValueError):
                continue
            if not lat_gcj or not lon_gcj:
                continue
            lon_w, lat_w = gcj02_to_wgs84(lon_gcj, lat_gcj)
            typ = (row.get("type") or "bus").strip().lower()
            if typ not in ("bus", "metro"):
                typ = "bus"
            lines_val = (row.get("lines") or "").strip()
            if lines_val:
                with_lines += 1
            entry = {
                "id": row.get("stop_id", ""),
                "lat": round(lat_w, 6),
                "lon": round(lon_w, 6),
                "name": (row.get("name") or "").strip(),
                "type": typ,
            }
            if lines_val:
                entry["lines"] = lines_val
            stops.append(entry)

    out_file = OUT / "stops.json"
    out_file.write_text(json.dumps(stops, separators=(",", ":")), encoding="utf-8")
    metro_n = sum(1 for s in stops if s.get("type") == "metro")
    print(
        f"  Stops: {len(stops)} from {stops_path.name} "
        f"({metro_n} metro, {with_lines} with lines, {out_file.stat().st_size / 1024:.0f} KB)"
    )


def prepare_geojson():
    """Copy metro and compound GeoJSON files, enriching compounds with transit/rating data."""
    metro_path = DATA / "guangzhou_metro_lines.geojson"
    if metro_path.exists():
        shutil.copy2(metro_path, OUT / "metro.geojson")
        print(f"  Metro GeoJSON: {metro_path.stat().st_size / 1024:.0f} KB")

    compounds_path = DATA / "guangzhou_compounds.geojson"
    if not compounds_path.exists():
        print("  Skipping compounds: file not found")
        return

    compounds = json.loads(compounds_path.read_text("utf-8"))
    transit_path = DATA / "compound_transit_cache.csv"
    enrich_path = DATA / "enrich_cache.json"

    transit_lookup = {}
    if transit_path.exists():
        import csv
        with open(transit_path, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                pid = row.get("poi_id", "")
                t = float(row.get("transit_time_minutes") or row.get("transit_time") or -1)
                transit_lookup[pid] = {
                    "t": t,
                    "breakdown": row.get("breakdown", ""),
                    "transfers": int(row.get("transfers", -1)),
                }

    enrich_lookup = {}
    if enrich_path.exists():
        enrich_lookup = json.loads(enrich_path.read_text("utf-8")) or {}

    for feat in compounds.get("features", []):
        geom = feat.get("geometry", {})
        if geom.get("type") == "Polygon":
            new_rings = []
            for ring in geom.get("coordinates", []):
                new_ring = []
                for coord in ring:
                    lon_w, lat_w = gcj02_to_wgs84(coord[0], coord[1])
                    new_ring.append([round(lon_w, 6), round(lat_w, 6)])
                new_rings.append(new_ring)
            geom["coordinates"] = new_rings

        props = feat.get("properties") or {}
        poi_id = str(props.get("poi_id", ""))
        ct = transit_lookup.get(poi_id)
        if ct:
            props["transitTime"] = ct["t"]
            props["breakdown"] = ct["breakdown"]
            props["transfers"] = ct["transfers"]
        else:
            props["transitTime"] = -1
            props["breakdown"] = ""
            props["transfers"] = -1

        c_lon = float(props.get("centroid_lon", 0))
        c_lat = float(props.get("centroid_lat", 0))
        if c_lon and c_lat:
            c_lon_w, c_lat_w = gcj02_to_wgs84(c_lon, c_lat)
            props["centroidLonWgs"] = round(c_lon_w, 6)
            props["centroidLatWgs"] = round(c_lat_w, 6)

        enrich = enrich_lookup.get(poi_id, {})
        enrich_reviews = ((enrich.get("reviews") or {}).get("reviews") or [])
        scored = [float(r.get("score", 0) or 0) for r in enrich_reviews if float(r.get("score", 0) or 0) >= 1]
        props["ratingCount"] = len(scored)
        props["ratingAvg"] = round(sum(scored) / len(scored), 2) if scored else 0
        props["nameEn"] = to_pinyin(props.get("name", ""))

    out_file = OUT / "compounds.geojson"
    out_file.write_text(json.dumps(compounds, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  Compounds: {len(compounds.get('features', []))} features ({out_file.stat().st_size / 1024:.0f} KB)")


def prepare_heatmap():
    """Generate combined + Anjuke-only heatmap rasters (grid, communities, compounds, stops)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    from generate_combined_heatmap import main as generate_heatmaps

    generate_heatmaps()


def prepare_grid_hover():
    """Hover sample points: grid (subsampled) + all Anjuke + compound centroids + stops (matches heatmap inputs)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    from heatmap_point_sources import (
        load_community_points,
        load_compound_centroid_points,
        load_grid_points,
        load_stop_points,
    )

    grid_full = load_grid_points()
    step = 8
    grid = [
        [round(grid_full[i][0], 5), round(grid_full[i][1], 5), round(grid_full[i][2], 1)]
        for i in range(0, len(grid_full), step)
    ]
    lats = [grid_full[i][0] for i in range(0, len(grid_full), step)]
    lons = [grid_full[i][1] for i in range(0, len(grid_full), step)]

    comm_pts = load_community_points()
    for lat_w, lon_w, t in comm_pts:
        grid.append([round(lat_w, 5), round(lon_w, 5), round(t, 1)])
        lats.append(lat_w)
        lons.append(lon_w)

    comp_pts = load_compound_centroid_points()
    for lat_w, lon_w, t in comp_pts:
        grid.append([round(lat_w, 5), round(lon_w, 5), round(t, 1)])
        lats.append(lat_w)
        lons.append(lon_w)

    stop_pts = load_stop_points()
    for lat_w, lon_w, t in stop_pts:
        grid.append([round(lat_w, 5), round(lon_w, 5), round(t, 1)])
        lats.append(lat_w)
        lons.append(lon_w)

    print(
        f"  Grid hover: grid~{len(grid_full)//step or 0}, +{len(comm_pts)} communities, "
        f"+{len(comp_pts)} compounds, +{len(stop_pts)} stops"
    )

    out_file = OUT / "grid_hover.json"
    out_file.write_text(json.dumps(grid, separators=(",", ":")), encoding="utf-8")
    print(f"  Grid hover: {len(grid)} points ({out_file.stat().st_size / 1024:.0f} KB)")


def prepare_districts():
    """Convert district polylines (GCJ-02) to WGS-84 GeoJSON."""
    dist_path = DATA / "district_polygons.json"
    if not dist_path.exists():
        print("  Skipping districts: file not found")
        return

    raw = json.loads(dist_path.read_text("utf-8"))
    features = []

    for name, info in raw.items():
        polyline = info.get("polyline", "")
        if not polyline:
            continue

        coords = []
        for pair in polyline.split(";"):
            parts = pair.split(",")
            if len(parts) != 2:
                continue
            lng_gcj, lat_gcj = float(parts[0]), float(parts[1])
            lng_w, lat_w = gcj02_to_wgs84(lng_gcj, lat_gcj)
            coords.append([round(lng_w, 6), round(lat_w, 6)])

        if coords and coords[0] != coords[-1]:
            coords.append(coords[0])

        features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "nameEn": DISTRICT_EN.get(name.replace("区", ""), name),
                "adcode": info.get("adcode", ""),
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
        })

    collection = {"type": "FeatureCollection", "features": features}
    out_file = OUT / "districts.geojson"
    out_file.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  Districts: {len(features)} ({out_file.stat().st_size / 1024:.0f} KB)")


def prepare_scut():
    """Copy SCUT location."""
    scut_path = DATA / "scut_location.json"
    if scut_path.exists():
        scut = json.loads(scut_path.read_text("utf-8"))
        lat_gcj = float(scut.get("lat", 0))
        lon_gcj = float(scut.get("lon", 0))
        lon_w, lat_w = gcj02_to_wgs84(lon_gcj, lat_gcj)
        out = {"lat": round(lat_w, 6), "lon": round(lon_w, 6), "name": "SCUT (Wushan Campus)"}
        out_file = OUT / "scut.json"
        out_file.write_text(json.dumps(out), encoding="utf-8")
        print(f"  SCUT location: {out}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("Preparing frontend data...")
    print()
    prepare_scut()
    prepare_districts()
    prepare_anjuke()
    prepare_stops()
    prepare_geojson()
    prepare_heatmap()
    prepare_grid_hover()
    print()
    print("Done!")


if __name__ == "__main__":
    main()
