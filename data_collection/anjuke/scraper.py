"""
Incremental Anjuke scraper for Guangzhou rental communities + listings.

Cookie is passed at runtime (env ANJUKE_COOKIE or run_scrape(cookie=...)).
Raw data is written under data/; resume state under data/scraping/.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.github_progress import maybe_push_github_progress, push_scrape_progress
DATA_DIR = ROOT / "data"
SCRAPING_DIR = DATA_DIR / "scraping"

BLOCKS_CACHE = DATA_DIR / "anjuke_blocks.json"
COMMUNITIES_CACHE = DATA_DIR / "anjuke_communities.json"
LISTINGS_FILE = DATA_DIR / "anjuke_listings_raw.jsonl"
COMMUNITIES_STATE = SCRAPING_DIR / "communities_state.json"
LISTINGS_STATE = SCRAPING_DIR / "listings_state.json"
LISTINGS_FILE_NEW = SCRAPING_DIR / "anjuke_listings_new.jsonl"

HEADERS = {
    "accept": "application/json, text/javascript, */*; q=0.01",
    "accept-language": "en,en-US;q=0.9,nl;q=0.8",
    "referer": "https://gz.zu.anjuke.com/ditu/",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    ),
    "x-requested-with": "XMLHttpRequest",
}

BASE = "https://gz.zu.anjuke.com/map/ajax/pclist"

DISTRICTS = {
    "天河": {"lat": "23.090000_23.220000", "lng": "113.300000_113.500000"},
    "越秀": {"lat": "23.100000_23.170000", "lng": "113.240000_113.320000"},
    "海珠": {"lat": "23.030000_23.120000", "lng": "113.230000_113.400000"},
    "荔湾": {"lat": "23.080000_23.180000", "lng": "113.170000_113.280000"},
}

_COOKIES: dict[str, str] = {}


def parse_cookie_string(raw: str) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for pair in (raw or "").split(";"):
        if "=" in pair:
            k, v = pair.split("=", 1)
            cookies[k.strip()] = v.strip()
    return cookies


def configure_cookie(raw: str) -> dict[str, str]:
    global _COOKIES
    _COOKIES = parse_cookie_string(raw)
    if not _COOKIES:
        raise ValueError("Anjuke cookie is empty")
    SCRAPING_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return _COOKIES


def test_cookie(raw: str) -> tuple[str, str]:
    """Validate cookie; returns (et, bst) on success."""
    configure_cookie(raw)
    return get_session_params()


def load_json(path: Path, default):
    if path.exists():
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_existing_listings() -> dict[str, dict]:
    existing: dict[str, dict] = {}
    if not LISTINGS_FILE.exists():
        return existing
    print(f"Loading existing listings from {LISTINGS_FILE}...")
    with LISTINGS_FILE.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                existing[str(data["id"])] = data
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
    print(f"Loaded {len(existing)} existing listings.")
    return existing


def gettoken(ver: str, tk: str) -> str:
    version = int(ver) // 2
    arr = [
        ["md5", "sha1", "sha256"],
        ["md5", "sha256", "sha1"],
        ["sha1", "sha256", "md5"],
        ["sha1", "md5", "sha256"],
        ["sha256", "sha1", "md5"],
        ["sha256", "md5", "sha1"],
        ["md5", "sha1"],
        ["sha1", "md5"],
        ["md5", "sha256"],
        ["sha256", "md5"],
        ["sha256", "sha1"],
        ["sha1", "sha256"],
        "base64_encode",
    ]
    index = (int(tk[:3], 16) + version) % len(arr)
    algorithm = arr[index]

    def apply_algo(val: str, algo: str) -> str:
        if algo == "md5":
            return hashlib.md5(val.encode()).hexdigest()
        if algo == "sha1":
            return hashlib.sha1(val.encode()).hexdigest()
        if algo == "sha256":
            return hashlib.sha256(val.encode()).hexdigest()
        if algo == "base64_encode":
            return base64.b64encode(val.encode()).decode()
        raise ValueError(f"Unknown algo: {algo}")

    if isinstance(algorithm, str):
        return apply_algo(tk, algorithm)

    new_token = tk
    for algo in algorithm:
        new_token = apply_algo(new_token, algo)
    return new_token


def get_session_params() -> tuple[str, str]:
    r = requests.get(
        "https://gz.zu.anjuke.com/ditu/",
        headers={
            "user-agent": HEADERS["user-agent"],
            "referer": "https://gz.zu.anjuke.com/",
        },
        cookies=_COOKIES,
        timeout=10,
    )
    version = re.search(r"version:\s*'(\d+)'", r.text)
    tk = re.search(r"gettoken\('[^']+',\s*'([a-f0-9]+)'\)", r.text)
    bst = re.search(r"bst\s*:\s*'([a-z0-9]+)'", r.text)
    if not version or not tk or not bst:
        raise ValueError("Could not extract session params — cookies may have expired")
    et = gettoken(version.group(1), tk.group(1))[:6]
    bst_val = bst.group(1)
    print(f"Session params — version: {version.group(1)}  et: {et}  bst: {bst_val}")
    return et, bst_val


def get(url: str, params: dict, retries: int = 3):
    for attempt in range(retries):
        try:
            r = requests.get(
                url,
                params=params,
                headers=HEADERS,
                cookies=_COOKIES,
                timeout=10,
            )
            data = r.json()
            if data.get("code") == 0:
                return data.get("val", {})
            print(f"  Non-zero code: {data.get('code')} {data.get('msg')}")
            return None
        except Exception as e:
            wait = 2**attempt
            print(f"  Attempt {attempt + 1} failed: {e} — retrying in {wait}s")
            time.sleep(wait)
    return None


def fetch_blocks(base_params: dict):
    cache = load_json(BLOCKS_CACHE, None)
    if cache:
        total = sum(len(v) for v in cache.values())
        print(f"Blocks cache: {total} blocks across {len(cache)} districts")
        return cache

    all_blocks = {}
    for district_name, bounds in DISTRICTS.items():
        val = get(
            f"{BASE}/Api_get_facet",
            {
                **base_params,
                "p": 1,
                "maxp": 999,
                "lat": bounds["lat"],
                "lng": bounds["lng"],
                "zoom": 15,
            },
        )
        blocks = val.get("block_list", []) if val else []
        all_blocks[district_name] = blocks
        print(f"  {district_name}: {len(blocks)} blocks")
        time.sleep(0.3)

    save_json(BLOCKS_CACHE, all_blocks)
    push_scrape_progress("blocks fetched")
    return all_blocks


def get_block_subtiles(block: dict, grid: int = 3):
    lat = float(block["lat"])
    lng = float(block["lng"])
    lat_min = lat - 0.0065
    lat_max = lat + 0.0065
    lng_min = lng - 0.0113
    lng_max = lng + 0.0113
    lat_step = (lat_max - lat_min) / grid
    lng_step = (lng_max - lng_min) / grid
    tiles = []
    for i in range(grid):
        for j in range(grid):
            tiles.append(
                (
                    f"{lat_min + i * lat_step:.6f}_{lat_min + (i + 1) * lat_step:.6f}",
                    f"{lng_min + j * lng_step:.6f}_{lng_min + (j + 1) * lng_step:.6f}",
                )
            )
    return tiles


def fetch_communities(all_blocks: dict, base_params: dict):
    existing_communities = load_json(COMMUNITIES_CACHE, {})
    state = load_json(
        COMMUNITIES_STATE,
        {"completed_blocks": [], "communities": {}, "_completed": False},
    )

    if state.get("_completed"):
        print("Communities fetch already completed previously.")
        return state["communities"]

    all_communities = state["communities"]
    seen_ids = set(all_communities.keys())
    completed_blocks = set(state["completed_blocks"])

    for district_name, blocks in all_blocks.items():
        print(f"\n  {district_name} — {len(blocks)} blocks")
        for block in blocks:
            block_id = str(block["id"])
            if block_id in completed_blocks:
                continue

            subtiles = get_block_subtiles(block, grid=3)
            block_new = 0

            for lat_str, lng_str in subtiles:
                val = get(
                    f"{BASE}/Api_get_facet",
                    {
                        **base_params,
                        "p": 1,
                        "maxp": block.get("prop_num", 999),
                        "lat": lat_str,
                        "lng": lng_str,
                        "zoom": 17,
                    },
                )
                communities = val.get("community_list", []) if val else []
                for c in communities:
                    cid = str(c["id"])
                    if cid not in seen_ids:
                        seen_ids.add(cid)
                        new_c = {
                            "id": c.get("id"),
                            "name": c.get("name"),
                            "lat": c.get("lat"),
                            "lng": c.get("lng"),
                            "prop_num": c.get("prop_num"),
                            "build_date": c.get("build_date"),
                            "_district": district_name,
                            "_block_id": block["id"],
                            "_block_name": block["name"],
                        }
                        if cid in existing_communities:
                            for k, v in existing_communities[cid].items():
                                if k.startswith("transit_"):
                                    new_c[k] = v
                        all_communities[cid] = new_c
                        block_new += 1
                time.sleep(0.15)

            completed_blocks.add(block_id)
            save_json(
                COMMUNITIES_STATE,
                {
                    "completed_blocks": list(completed_blocks),
                    "communities": all_communities,
                    "_completed": False,
                },
            )
            print(f"    [{block['name']}] +{block_new} new ({len(all_communities)} total)")
            maybe_push_github_progress(
                f"communities progress ({len(completed_blocks)} blocks done)",
            )

    state["_completed"] = True
    save_json(COMMUNITIES_STATE, state)
    save_json(COMMUNITIES_CACHE, all_communities)
    push_scrape_progress(f"communities complete ({len(all_communities)} total)")
    return all_communities


def fetch_listing_detail(prop_id: str, base_params: dict) -> dict:
    val = get(
        f"{BASE}/Api_get_detail",
        {
            **base_params,
            "prop_id": prop_id,
            "source_type": 1,
            "hfilter": "filterlist",
        },
    )
    if not val:
        return {}
    return {
        "des": val.get("des"),
        "metro_info": val.get("metro_info"),
        "prop_images": val.get("prop_images", []),
        "floor_des": val.get("floor_des"),
    }


def fetch_all_listings(all_communities: dict, base_params: dict) -> int:
    state = load_json(LISTINGS_STATE, {"fetched_communities": []})
    fetched_communities = set(state["fetched_communities"])
    existing_listings = load_existing_listings()

    if not fetched_communities and LISTINGS_FILE_NEW.exists():
        LISTINGS_FILE_NEW.unlink()

    communities = list(all_communities.items())
    total_communities = len(communities)
    remaining = [(cid, c) for cid, c in communities if cid not in fetched_communities]

    print(
        f"Communities: {total_communities} total, "
        f"{len(fetched_communities)} done, "
        f"{len(remaining)} remaining"
    )

    total_saved = 0

    for _cidx, (cid, community) in enumerate(remaining):
        prop_count = community.get("prop_num", 0)
        print(
            f"\n  [{len(fetched_communities) + 1}/{total_communities}] "
            f"{community['name']} ({community.get('_district', '')}) "
            f"— ~{prop_count} listings"
        )

        page = 1
        community_listings = []

        while True:
            val = get(
                f"{BASE}/Api_get_house_list",
                {
                    **base_params,
                    "refer_url": "https://guangzhou.anjuke.com/",
                    "p": page,
                    "maxp": 99,
                    "community_id": cid,
                },
            )
            if not val:
                break

            props = val.get("props", [])
            if not props:
                break

            for prop in props:
                prop_id = str(prop.get("id"))
                if prop_id in existing_listings:
                    community_listings.append(existing_listings[prop_id])
                else:
                    detail = fetch_listing_detail(prop_id, base_params)
                    time.sleep(0.15)
                    community_listings.append(
                        {
                            "id": prop_id,
                            "title": prop.get("title"),
                            "img": prop.get("img"),
                            "price": prop.get("price"),
                            "area": prop.get("area"),
                            "orient": prop.get("orient"),
                            "fitment": prop.get("fitment"),
                            "rent_type_name": prop.get("rent_type_name"),
                            "rhval": prop.get("rhval"),
                            "community_id": prop.get("community_id"),
                            "community_name": prop.get("community_name"),
                            "block_name": prop.get("block_name"),
                            "region_name": prop.get("region_name"),
                            "detailUrl": prop.get("detailUrl"),
                            "is_auction": prop.get("is_auction"),
                            "is_list": prop.get("is_list"),
                            "des": detail.get("des"),
                            "metro_info": detail.get("metro_info"),
                            "prop_images": detail.get("prop_images", []),
                            "floor_des": detail.get("floor_des"),
                        }
                    )

            pages_info = val.get("pages", {})
            total_count = int(pages_info.get("totalCount", 0))
            fetched_so_far = page * len(props)
            print(
                f"    page {page} — {len(props)} listings "
                f"({min(fetched_so_far, total_count)}/{total_count})"
            )
            if fetched_so_far >= total_count or len(props) == 0:
                break
            page += 1
            time.sleep(0.2)

        with LISTINGS_FILE_NEW.open("a", encoding="utf-8") as f:
            for listing in community_listings:
                f.write(json.dumps(listing, ensure_ascii=False) + "\n")

        total_saved += len(community_listings)
        fetched_communities.add(cid)
        save_json(LISTINGS_STATE, {"fetched_communities": list(fetched_communities)})
        print(f"    saved {len(community_listings)} listings (running total: ~{total_saved})")
        maybe_push_github_progress(
            f"listings progress ({len(fetched_communities)}/{total_communities} communities)",
        )

    bak_file = Path(str(LISTINGS_FILE) + ".bak")
    if LISTINGS_FILE.exists():
        if bak_file.exists():
            bak_file.unlink()
        LISTINGS_FILE.rename(bak_file)

    if LISTINGS_FILE_NEW.exists():
        LISTINGS_FILE_NEW.rename(LISTINGS_FILE)

    if LISTINGS_STATE.exists():
        LISTINGS_STATE.unlink()
    if COMMUNITIES_STATE.exists():
        COMMUNITIES_STATE.unlink()

    push_scrape_progress(f"listings scrape complete (~{total_saved} rows in new file)")
    return total_saved


def run_scrape(cookie: str) -> int:
    """Scrape blocks, communities, and active listings. Returns listing count."""
    configure_cookie(cookie)
    et, bst = get_session_params()
    base_params = {
        "room_num": 0,
        "price_id": 0,
        "rent_type": 0,
        "price_min": 0,
        "price_max": 0,
        "lx_id": "",
        "tag_id": "",
        "orient_id": "",
        "order_id": 0,
        "ib": 1,
        "et": et,
        "bst": bst,
    }

    print("\n=== Level 1: Fetching blocks ===")
    all_blocks = fetch_blocks(base_params)

    print("\n=== Level 2: Fetching communities ===")
    all_communities = fetch_communities(all_blocks, base_params)
    print(f"\nTotal unique communities: {len(all_communities)}")

    print("\n=== Level 3+4: Fetching listings + details ===")
    total = fetch_all_listings(all_communities, base_params)

    print("\n=== Scrape done ===")
    print(f"Total active listings saved: {total}")
    print(f"Output file updated: {LISTINGS_FILE}")
    return total
