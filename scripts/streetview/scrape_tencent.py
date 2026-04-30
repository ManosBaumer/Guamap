"""
Scrape Tencent/QQ Maps Street View panorama coverage for the 4 core Guangzhou districts.

Two-phase approach:
  Phase 1 — Grid seeding: query a grid of points to discover initial panoramas.
  Phase 2 — BFS crawl: follow links from every discovered pano to fill gaps.

Usage:
    python scripts/streetview/scrape_tencent.py [--spacing 0.002] [--rps 8] [--workers 6]

Output:
    data/streetview/tencent_panos.json
"""

import argparse
import json
import logging
import re
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coord_convert import generate_grid, load_district_rings, tencent_plane_xy_to_gcj02

LOG = logging.getLogger("tencent_sv")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = PROJECT_ROOT / "data" / "streetview"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://map.qq.com/",
    "Accept": "*/*",
}


class RateLimiter:
    def __init__(self, rps: float):
        self._interval = 1.0 / rps
        self._lock = threading.Lock()
        self._last = 0.0

    def acquire(self):
        with self._lock:
            now = time.monotonic()
            wait = self._last + self._interval - now
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()


def _ts() -> int:
    return int(time.time() * 1000)


def _strip_jsonp(raw: str) -> str:
    """Strip JSONP callback wrapper if present."""
    raw = raw.strip()
    m = re.match(r'^[a-zA-Z0-9_.\[\]]+\((.*)\);?\s*$', raw, re.DOTALL)
    if m:
        return m.group(1)
    if raw.startswith("(") and raw.endswith(")"):
        return raw[1:-1]
    return raw


def _fetch_json(url: str, retries: int = 3) -> dict | list | None:
    for attempt in range(retries):
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            cleaned = _strip_jsonp(raw)
            return json.loads(cleaned)
        except (HTTPError, URLError, json.JSONDecodeError, OSError) as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            LOG.debug("fetch failed %s: %s", url, exc)
            return None


def _parse_pano_entry(entry: dict) -> dict | None:
    """Parse Tencent /xf detail or /sv detail subtree into a normalized pano record."""
    # Full metadata from /sv?svid=… (nested shape)
    if isinstance(entry.get("basic"), dict):
        basic = entry["basic"]
        pano_id = basic.get("svid")
        if not pano_id:
            return None
        addr = entry.get("addr") or {}
        lat_v = addr.get("y_lat")
        lng_v = addr.get("x_lng")
        if lat_v is None or lng_v is None:
            tx, ty = basic.get("x"), basic.get("y")
            if tx is None or ty is None:
                return None
            lat_v, lng_v = tencent_plane_xy_to_gcj02(float(tx), float(ty))
        else:
            lat_v, lng_v = float(lat_v), float(lng_v)
        dir_raw = basic.get("dir") or basic.get("h") or 0
        try:
            heading = float(dir_raw)
        except (TypeError, ValueError):
            heading = 0.0
        road = ""
        for road_obj in entry.get("roads") or []:
            if road_obj.get("name"):
                road = str(road_obj["name"])
                break

        link_ids: list[str] = []
        for vp in entry.get("vpoints") or []:
            for lk in vp.get("link") or []:
                sid = lk.get("svid")
                if sid and str(sid) != str(pano_id):
                    link_ids.append(str(sid))

        seen: set[str] = set()
        deduped: list[str] = []
        for lid in link_ids:
            if lid not in seen:
                seen.add(lid)
                deduped.append(lid)

        return {
            "id": str(pano_id),
            "lat": round(lat_v, 7),
            "lng": round(lng_v, 7),
            "heading": round(heading, 2),
            "date": "",
            "road": road,
            "links": deduped,
        }

    # Flat /xf?lat=&lng= detail object
    pano_id = entry.get("svid") or entry.get("svrid") or entry.get("id") or entry.get("pano_id")
    if not pano_id:
        return None
    tx = entry.get("x")
    ty = entry.get("y")
    if tx is None or ty is None:
        lng = entry.get("lng") or entry.get("lon")
        lat = entry.get("lat")
        if lng is None or lat is None:
            return None
        lat_v, lng_v = float(lat), float(lng)
    else:
        fx, fy = float(tx), float(ty)
        if abs(fx) > 1_000_000 or abs(fy) > 1_000_000:
            lat_v, lng_v = tencent_plane_xy_to_gcj02(fx, fy)
        elif abs(fy) <= 90 and abs(fx) <= 180:
            lng_v, lat_v = fx, fy
        else:
            lat_v, lng_v = tencent_plane_xy_to_gcj02(fx, fy)

    heading = float(entry.get("heading") or entry.get("dir") or 0)
    date = str(entry.get("date") or entry.get("Date") or "")
    road = str(entry.get("roadName") or entry.get("road_name") or "")

    return {
        "id": str(pano_id),
        "lat": round(lat_v, 7),
        "lng": round(lng_v, 7),
        "heading": round(heading, 2),
        "date": date,
        "road": road,
        "links": [],
    }


def query_by_location(lat_gcj: float, lng_gcj: float, rl: RateLimiter) -> list[dict]:
    """Query Tencent for the nearest pano at a GCJ-02 point (/xf expects lat= & lng=)."""
    url = (
        f"https://sv.map.qq.com/xf?"
        f"lat={lat_gcj:.6f}&lng={lng_gcj:.6f}"
        f"&r=500&n=20&output=json"
        f"&pf=jsapi&ref=jsapi&t={_ts()}"
    )
    rl.acquire()
    data = _fetch_json(url)
    if not data or not isinstance(data, dict):
        return []

    panos = []
    detail = data.get("detail")
    if detail:
        p = _parse_pano_entry(detail)
        if p:
            panos.append(p)
    for key in ("others", "nearbypanos", "panos"):
        for entry in data.get(key) or []:
            p = _parse_pano_entry(entry)
            if p:
                panos.append(p)

    return panos


def query_by_id(svrid: str, rl: RateLimiter) -> dict | None:
    """Query Tencent for a specific panorama by svid."""
    url = (
        f"https://sv.map.qq.com/sv?"
        f"svid={svrid}&output=json"
        f"&pf=jsapi&ref=jsapi&t={_ts()}"
    )
    rl.acquire()
    data = _fetch_json(url)
    if not data or not isinstance(data, dict):
        return None

    info = data.get("info") or {}
    if info.get("error") not in (0, None):
        return None

    detail = data.get("detail")
    if not detail:
        return None
    return _parse_pano_entry(detail)


def save_checkpoint(panos: dict, path: Path):
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(panos, f, ensure_ascii=False)
    tmp.replace(path)


def load_checkpoint(path: Path) -> dict:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def phase1_grid(spacing: float, rps: float, workers: int, panos: dict, ckpt_path: Path) -> dict:
    """Grid seeding: discover panoramas at regular intervals across districts."""
    LOG.info("Loading district polygons...")
    rings = load_district_rings()
    grid = generate_grid(rings, spacing)
    LOG.info("Grid has %d points inside the 4 districts (spacing=%.4f°)", len(grid), spacing)

    rl = RateLimiter(rps)
    new_count = 0
    done = 0
    total = len(grid)
    lock = threading.Lock()

    def process_point(lat_lng):
        return query_by_location(lat_lng[0], lat_lng[1], rl)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process_point, pt): pt for pt in grid}
        for future in as_completed(futures):
            done += 1
            try:
                result_panos = future.result()
            except Exception as exc:
                LOG.debug("grid point error: %s", exc)
                continue
            with lock:
                for p in result_panos:
                    if p["id"] not in panos:
                        panos[p["id"]] = p
                        new_count += 1
                if done % 200 == 0:
                    LOG.info(
                        "  grid: %d/%d done, %d panos discovered (total %d)",
                        done, total, new_count, len(panos),
                    )
                if new_count > 0 and done % 500 == 0:
                    save_checkpoint(panos, ckpt_path)

    save_checkpoint(panos, ckpt_path)
    LOG.info("Phase 1 complete: %d new panos from grid (%d total)", new_count, len(panos))
    return panos


def _hydrate_links_from_sv(
    panos: dict, rps: float, workers: int, ckpt_path: Path | None
) -> None:
    """Fill empty `links` via /sv — /xf grid hits only include svid + pose, not neighbors."""
    need = [pid for pid, p in panos.items() if not p.get("links")]
    if not need:
        return
    LOG.info(
        "Hydrating neighbor links: fetching /sv for %d panos (not provided by /xf)...",
        len(need),
    )
    rl = RateLimiter(rps)
    lock = threading.Lock()
    done = 0
    ok = 0

    def fetch(pid: str) -> tuple[str, dict | None]:
        return pid, query_by_id(pid, rl)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch, pid): pid for pid in need}
        for future in as_completed(futures):
            try:
                pid, full = future.result()
            except Exception as exc:
                LOG.debug("hydrate error: %s", exc)
                continue
            with lock:
                done += 1
                if full and pid in panos:
                    panos[pid]["links"] = full.get("links") or []
                    if full.get("road"):
                        panos[pid]["road"] = full["road"]
                    ok += 1
                if done % 500 == 0:
                    LOG.info("  hydrate: %d/%d /sv fetches (%d ok)", done, len(need), ok)
                if ckpt_path and done % 1000 == 0:
                    save_checkpoint(panos, ckpt_path)

    if ckpt_path:
        save_checkpoint(panos, ckpt_path)
    with_links = sum(1 for p in panos.values() if p.get("links"))
    LOG.info(
        "Hydration done: %d successful /sv fetches (of %d); %d panos have neighbor links",
        ok,
        len(need),
        with_links,
    )


def phase2_crawl(rps: float, workers: int, panos: dict, ckpt_path: Path) -> dict:
    """BFS crawl: follow road links to discover side-street coverage."""
    _hydrate_links_from_sv(panos, rps, workers, ckpt_path)

    queue: deque[str] = deque()
    visited_links: set[str] = set(panos.keys())

    for p in list(panos.values()):
        for link_id in p.get("links", []):
            if link_id not in visited_links:
                queue.append(link_id)

    LOG.info("Phase 2: %d link IDs to crawl", len(queue))

    rl = RateLimiter(rps)
    new_count = 0
    queried = 0
    lock = threading.Lock()

    def fetch_link(pid: str) -> dict | None:
        return query_by_id(pid, rl)

    batch_size = workers * 4
    while queue:
        batch = []
        seen_in_batch = set()
        while queue and len(batch) < batch_size:
            pid = queue.popleft()
            if pid in visited_links or pid in seen_in_batch:
                continue
            seen_in_batch.add(pid)
            batch.append(pid)

        if not batch:
            continue

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(fetch_link, pid): pid for pid in batch}
            for future in as_completed(futures):
                queried += 1
                pid = futures[future]
                visited_links.add(pid)
                try:
                    p = future.result()
                except Exception:
                    continue
                if not p:
                    continue
                with lock:
                    if p["id"] not in panos:
                        panos[p["id"]] = p
                        new_count += 1
                    for link_id in p.get("links", []):
                        if link_id not in visited_links:
                            queue.append(link_id)

                if queried % 500 == 0:
                    LOG.info(
                        "  crawl: %d queried, %d new panos (%d total), %d in queue",
                        queried, new_count, len(panos), len(queue),
                    )
                if queried % 1000 == 0:
                    save_checkpoint(panos, ckpt_path)

    save_checkpoint(panos, ckpt_path)
    LOG.info("Phase 2 complete: %d new panos from crawl (%d total)", new_count, len(panos))
    return panos


def main():
    parser = argparse.ArgumentParser(description="Scrape Tencent Street View for Guangzhou")
    parser.add_argument("--spacing", type=float, default=0.002, help="Grid spacing in degrees (default 0.002 ≈ 220m)")
    parser.add_argument("--rps", type=float, default=8, help="Max requests per second (default 8)")
    parser.add_argument("--workers", type=int, default=6, help="Thread pool workers (default 6)")
    parser.add_argument("--skip-grid", action="store_true", help="Skip grid phase (resume crawl only)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "tencent_panos.json"
    ckpt_path = OUT_DIR / "tencent_checkpoint.json"

    panos = load_checkpoint(ckpt_path)
    if panos:
        LOG.info("Resumed from checkpoint: %d existing panos", len(panos))

    if not args.skip_grid:
        panos = phase1_grid(args.spacing, args.rps, args.workers, panos, ckpt_path)

    panos = phase2_crawl(args.rps, args.workers, panos, ckpt_path)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(panos, f, ensure_ascii=False)
    LOG.info("Saved %d panoramas to %s", len(panos), out_path)

    samples = list(panos.values())[:3]
    for s in samples:
        LOG.info("  sample: id=%s lat=%.6f lng=%.6f heading=%.1f date=%s road=%s links=%d",
                 s["id"], s["lat"], s["lng"], s["heading"], s["date"],
                 s.get("road", ""), len(s.get("links", [])))


if __name__ == "__main__":
    main()
