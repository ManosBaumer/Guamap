# Updating Anjuke Data Pipeline

Incremental refresh for Guangzhou rental communities and listings. **No transit recalculation** — the transit planner handles routing live.

---

## Quick start (recommended)

### Option A — Dev dashboard (local)

1. Run `npm run dev` in `frontend/`.
2. Sign in and open **Listing refresh** (wrench icon → `/dev`).
3. Paste a fresh Anjuke cookie → **Test cookie** → **Start refresh**.
4. Keep the dev server running until logs show success (often 1–3 hours).

### Option B — GitHub Actions (free cloud, overnight)

1. Open [Actions → Refresh Anjuke listings](https://github.com/ManosBaumer/Guamap/actions/workflows/refresh-anjuke.yml).
2. **Run workflow** and paste your cookie when prompted.
3. When finished, the workflow commits updated `frontend/public/data/` to the repo.
4. Pull the latest commit on your machine (or redeploy).

Raw scrape progress is saved **during the run** on branch `anjuke-scrape-cache` (every ~25 communities). On timeout/failure, workflow **Continue Anjuke refresh** auto-starts another run after ~1 minute (max **20** retries). When a run finishes fully, it commits `frontend/public/data/` to `main` and resets the retry counter.

### Email notifications

Add to `.env` (local) and **GitHub repository secrets** (cloud):

| Variable | Example |
|----------|---------|
| `NOTIFY_EMAIL` | address that receives alerts |
| `SMTP_USER` | sender login (Gmail address) |
| `SMTP_PASSWORD` | Gmail **App Password** (not your normal password) |
| `SMTP_HOST` | `smtp.gmail.com` (optional) |
| `SMTP_PORT` | `587` (optional) |

You get email on: refresh **started**, **success** (with counts), **cookie invalid**, **crash**, and GitHub Actions **workflow failure**.

```bash
python scripts/refresh_anjuke_listings.py --notify-test
```

### Option C — CLI

```bash
# From repo root
pip install -r requirements-scrape.txt

# Test cookie only
ANJUKE_COOKIE='...' python scripts/refresh_anjuke_listings.py --test-cookie-only

# Full refresh
ANJUKE_COOKIE='...' python scripts/refresh_anjuke_listings.py

# Re-export frontend JSON from existing raw files (no scrape)
python scripts/refresh_anjuke_listings.py --prepare-only
```

---

## Step 1: Extract a fresh cookie

1. Open **https://gz.zu.anjuke.com/ditu/** in Chrome/Edge.
2. DevTools → **Network** → refresh the page.
3. Click the document request → **Request Headers** → copy the full `cookie:` value.

Cookies expire quickly; always test before a long run.

---

## What the refresh does

| Step | Output |
|------|--------|
| Scrape communities + active listings | `data/anjuke_communities.json`, `data/anjuke_listings_raw.jsonl` |
| Detect removed listings | Appends to `data/anjuke_off_market.jsonl`, tags titles with `【已下架】` |
| Tag saved favourites | Updates `data/saved_listings.json` for delisted items |
| Export for React map | `frontend/public/data/communities.json`, `listings/*.json`, `listings_metadata.json` |

**Skipped:** `data/scraping/transit.py`, heatmaps, stop refresh, Amap batch routing.

---

## Legacy manual flow

The old entry point `data/scraping/main.py` (gitignored, cookie hardcoded) is replaced by:

- `data_collection/anjuke/scraper.py` — committed scraper module
- `scripts/refresh_anjuke_listings.py` — orchestrator

You can still paste a cookie into `data/scraping/main.py` locally if needed, but prefer the dashboard or CLI above.

---

## Verify

1. Restart or reload the frontend after a successful run.
2. Check community/listing counts on the map.
3. Open **Saved** favourites — delisted items show a **Sold** badge; use **Available only** to hide them.
