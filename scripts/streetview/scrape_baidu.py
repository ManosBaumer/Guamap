"""
Scrape Baidu Street View panorama coverage for the 4 core Guangzhou districts.

Two-phase approach:
  Phase 1 — Grid seeding: query a grid of points to discover initial panoramas.
  Phase 2 — BFS crawl: follow road links from every discovered pano to fill gaps.

Usage:
    python scripts/streetview/scrape_baidu.py [--spacing 0.002] [--rps 8] [--workers 6]

Output:
    data/streetview/baidu_panos.json
"""

import argparse
import json
import logging
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coord_convert import (
    bd09_to_gcj02,
    bd09mc_meters_to_gcj02,
    generate_grid,
    gcj02_to_bd09_mc,
    load_district_rings,
)

LOG = logging.getLogger("baidu_sv")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = PROJECT_ROOT / "data" / "streetview"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://map.baidu.com/",
    "Accept": "application/json, text/javascript, */*; q=0.01",
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


def _fetch_json(url: str, retries: int = 3) -> dict | None:
    for attempt in range(retries):
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            # Some responses may be JSONP wrapped — strip the callback
            if raw.startswith("(") and raw.endswith(")"):
                raw = raw[1:-1]
            elif "(" in raw and raw.endswith(")"):
                idx = raw.index("(")
                raw = raw[idx + 1 : -1]
            return json.loads(raw)
        except (HTTPError, URLError, json.JSONDecodeError, OSError) as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            LOG.debug("fetch failed %s: %s", url, exc)
            return None


def _parse_pano(content: dict) -> dict | None:
    """Extract panorama data from a Baidu qsdata/sdata content entry."""
    pano_id = content.get("ID") or content.get("id")
    if not pano_id:
        return None

    rx = content.get("RX")
    ry = content.get("RY")
    x = content.get("X")
    y = content.get("Y")

    gcj_lat = gcj_lng = None
    if rx is not None and ry is not None:
        frx, fry = float(rx), float(ry)
        if abs(fry) <= 90 and abs(frx) <= 180:
            gcj_lat, gcj_lng = bd09_to_gcj02(fry, frx)

    if gcj_lat is None and x is not None and y is not None:
        fx, fy = float(x) / 100.0, float(y) / 100.0
        if abs(fx) > 1000 or abs(fy) > 1000:
            gcj_lat, gcj_lng = bd09mc_meters_to_gcj02(fx, fy)

    if gcj_lat is None:
        return None

    heading = content.get("MoveDir") or content.get("Dir") or content.get("Heading") or 0
    date = content.get("Date", "")

    link_ids: list[str] = []
    for road in content.get("Roads") or []:
        for p in road.get("Panos") or []:
            pid = p.get("PID")
            if pid and pid != pano_id:
                link_ids.append(str(pid))
        if road.get("Panos"):
            continue
        rid = road.get("ID") or road.get("id")
        if rid and road.get("IsPano", 1) and str(rid) != pano_id:
            link_ids.append(str(rid))

    seen: set[str] = set()
    deduped = []
    for lid in link_ids:
        if lid not in seen:
            seen.add(lid)
            deduped.append(lid)

    return {
        "id": pano_id,
        "lat": round(gcj_lat, 7),
        "lng": round(gcj_lng, 7),
        "heading": round(float(heading), 2),
        "date": str(date),
        "links": deduped,
    }


def query_by_location(lat_gcj: float, lng_gcj: float, rl: RateLimiter) -> list[dict]:
    """Query Baidu for the nearest panorama at a GCJ-02 point (BD09 Mercator qsdata)."""
    mc_x, mc_y = gcj02_to_bd09_mc(lat_gcj, lng_gcj)
    url = f"https://mapsv0.bdimg.com/?qt=qsdata&x={mc_x}&y={mc_y}&action=1"
    rl.acquire()
    data = _fetch_json(url)
    if not data:
        return []
    result = data.get("result") or {}
    if result.get("error") not in (0, None):
        return []
    content = data.get("content")
    if not content:
        return []
    if isinstance(content, dict):
        content = [content]
    panos = []
    for entry in content:
        p = _parse_pano(entry)
        if p:
            panos.append(p)
    return panos


def query_by_id(pano_id: str, rl: RateLimiter) -> dict | None:
    """Query Baidu for a specific panorama by ID. Returns parsed pano or None."""
    url = f"https://mapsv0.bdimg.com/?qt=sdata&pc=1&sid={pano_id}"
    rl.acquire()
    data = _fetch_json(url)
    if not data:
        return None
    result = data.get("result") or {}
    if result.get("error") not in (0, None):
        return None
    content = data.get("content")
    if not content:
        return None
    if isinstance(content, list):
        content = content[0]
    return _parse_pano(content)


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
    """Grid seeding phase: discover panoramas at regular intervals."""
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


def phase2_crawl(rps: float, workers: int, panos: dict, ckpt_path: Path) -> dict:
    """BFS crawl: follow road links to discover side-street coverage."""
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
    parser = argparse.ArgumentParser(description="Scrape Baidu Street View for Guangzhou")
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
    out_path = OUT_DIR / "baidu_panos.json"
    ckpt_path = OUT_DIR / "baidu_checkpoint.json"

    panos = load_checkpoint(ckpt_path)
    if panos:
        LOG.info("Resumed from checkpoint: %d existing panos", len(panos))

    if not args.skip_grid:
        panos = phase1_grid(args.spacing, args.rps, args.workers, panos, ckpt_path)

    panos = phase2_crawl(args.rps, args.workers, panos, ckpt_path)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(panos, f, ensure_ascii=False)
    LOG.info("Saved %d panoramas to %s", len(panos), out_path)

    # Log a few sample panos for verification
    samples = list(panos.values())[:3]
    for s in samples:
        LOG.info("  sample: id=%s lat=%.6f lng=%.6f heading=%.1f date=%s links=%d",
                 s["id"], s["lat"], s["lng"], s["heading"], s["date"], len(s.get("links", [])))


if __name__ == "__main__":
    main()
