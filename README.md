# Guangzhou SCUT Commute Isochrone Heatmap

Generates an interactive HTML map of public transport commute time from central Guangzhou (Liwan, Yuexiu, Tianhe, Haizhu) to **South China University of Technology (SCUT)** — 华南理工大学(大学城校区).

## Setup

1. **Python 3.9+** with pip.

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Amap API key:** Use either option (Web Service API key from [Amap Open Platform](https://lbs.amap.com/)):

   - **Option A — .env file (recommended):** In the project root, create a file named `.env` with:
     ```
     AMAP_KEY=your_key_here
     ```
     The app loads this automatically (do not commit `.env`; it is in `.gitignore`).

   - **Option B — Environment variable:** Set in your shell before running:
     ```bash
     set AMAP_KEY=your_key_here
     ```
     (Use `export AMAP_KEY=...` on Linux/macOS.)

## Usage

Run the full pipeline (geocode SCUT, fetch districts and POI stops, deduplicate, transit routing, grid, commute times, map):

```bash
python main.py
```

**If you corrected SCUT location** (e.g. replaced the cached file with the 大学城 campus): run with `--force-transit` so transit times are recomputed to the correct destination. Example: `python main.py --force-transit` (or `--skip-stage1 --force-transit` then run stage 2 and viz).

**Options:**

- `--skip-stage1` — Use cached API data (geocode, districts, POI, transit).
- `--skip-stage2` — Skip grid and commute computation.
- `--skip-viz` — Skip generating the HTML map.
- `--force-geocode` — Re-fetch SCUT coordinates.
- `--force-poi` — Re-fetch POI stops (use if you want better bus coverage in sparse areas).
- `--force-transit` — Re-fetch all transit times (required after changing SCUT location).
- `--force-districts` — Re-fetch district boundaries.
- `--no-contours` — No longer used (map always uses smooth raster heatmap).
- `--no-stops` — Do not add transit stops layer to the map.

**Map only (no API calls):** To only regenerate the map from existing data (e.g. after tweaking visualization):
```bash
python main.py --skip-stage1 --skip-stage2
```
This reads only from `data/` and does not call Amap.

## Output

- **data/commute_heatmap.html** — Open in a browser. Smooth travel-time raster heatmap (green &lt;35 min → yellow → orange → red), stops colored by transit time, and a **max travel time** slider with **Apply** to filter heatmap and stops. Map works offline (no API calls); base tiles may need one online load.
- **data/heatmap_rasters/** — PNG rasters per threshold (10–120 min) for the slider.
- **data/grid_travel_times.csv** — Lat, lon, travel_time_minutes per grid point.
- **data/stops_with_transit_times.csv** — Cached transit times from each stop to SCUT.

## Frontend app (`frontend/`)

- `cd frontend && npm install && npm run dev` — React + Leaflet map UI.
- **Saved listings (favourites)** are written to **`data/saved_listings.json`** at the repo root (under `data/`, which is gitignored). Vite **dev** and **`vite preview`** serve `GET` / `PUT /api/saved-listings` to read/write that file. Static hosting of `dist/` alone cannot update the file — use dev or preview locally for persistence.
- If `saved_listings.json` is missing or empty but **localStorage** still has data from the old app, it is **migrated once** into the file and the old keys are cleared.

## Coordinate system

Data and APIs use **GCJ-02** (Amap). The map is built in **WGS84** (converted at visualization time) so markers and contours align with OpenStreetMap.

## API usage (one full run)

- Geocoding: 1 call  
- District API: 4 calls  
- POI search: up to ~200 calls per (keyword × district), 7 keywords × 4 districts, paginated  
- Transit routing: ~2,500–3,500 calls (one per deduplicated stop)  

Well within typical Amap free-tier limits (e.g. 150,000 LBS + 5,000 search per month).
