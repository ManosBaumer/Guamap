# Updating Anjuke Data Pipeline

This document outlines the step-by-step process for performing an incremental update of the Anjuke housing listings. The pipeline is specifically designed to safely add new properties, remove sold properties, and preserve your personal saved/bookmarked listings (by tagging them as `【已下架】` instead of permanently deleting them).

---

### Step 1: Extract a Fresh Cookie

Anjuke heavily relies on session cookies and security tokens. Before you run the scraper, you must grab a fresh browser cookie to avoid getting blocked or encountering a 403 Forbidden error.

1. Open your web browser and navigate to **Guangzhou Anjuke** (or perform a search on their site).
2. Right-click anywhere on the page and select **Inspect** to open the Chrome/Edge Developer Tools.
3. Go to the **Network** tab. 
4. Refresh the page (F5).
5. Look for the primary HTML document request (usually the very first item, often named `guangzhou.anjuke.com` or similar). Click on it.
6. Scroll down to the **Request Headers** section and look for the `cookie:` field.
7. Right-click the cookie value and select **Copy Value**.

---

### Step 2: Update the Scraper

1. Open `data/scraping/main.py` in your code editor.
2. Locate the `RAW_COOKIE` variable near the top of the file.
3. Replace the string with the massive cookie string you just copied:
   ```python
   RAW_COOKIE = "your_new_massive_cookie_string_goes_here"
   ```

---

### Step 3: Run the Incremental Scraper

The core scraping logic has been optimized to perform **delta updates**. This means it cross-references the live market against your existing files to avoid redundant API calls and prevent memory crashes.

1. Open your terminal in the root directory (`guamap/`).
2. Run the main scraper:
   ```bash
   python data/scraping/main.py
   ```
3. **What it does:**
   - It automatically parses your raw cookie string into the necessary headers.
   - It performs a session ping to verify authentication.
   - It scrapes all communities and then iterates through all active listings.
   - It creates a backup of your old dataset (`anjuke_listings_raw.jsonl.bak`).
   - It saves the fresh listings to `anjuke_listings_raw.jsonl`.

---

### Step 4: Calculate Transit Times (If Necessary)

If the scraper found brand new communities that were not in your database before, you need to calculate their transit times to the university. *This script is smart enough to skip communities that already have calculated transit times, saving you API calls.*

1. Run the transit script:
   ```bash
   python data/scraping/transit.py
   ```
   *(Ensure your `AMAP_KEY` is safely located in your project's `.env` file).*

---

### Step 5: Prepare the Frontend Data

Once the raw data is completely scraped and geolocated, you must format it for the React frontend. This script aggregates the data, drops broken listings, generates the heatmaps, and handles your personal saved listings.

1. Run the preparation script:
   ```bash
   python scripts/prepare_frontend_data.py
   ```
2. **What it does:**
   - Converts coordinates from Baidu (bd09) to GPS standard (WGS84).
   - Generates the updated heatmap clusters using pandas/matplotlib.
   - Checks your `saved_listings.json` file against the live market. If any of your saved listings were sold or taken down, it secretly adds `【已下架】` to their title instead of deleting them.
   - Outputs the final, minified JSON files directly into `frontend/public/data/`.

---

### Step 6: Verify the Update

1. Restart your frontend server if it isn't running:
   ```bash
   cd frontend
   npm run dev
   ```
2. Open the web app. Check the listing counts in the sidebar to confirm the active listings number has refreshed.
3. Check your Saved Favourites. You can use your new "Available only" filter to seamlessly toggle the visibility of any listings that went off-market during this update!
