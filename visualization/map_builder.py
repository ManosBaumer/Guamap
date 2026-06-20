"""
Build interactive Folium map: smooth travel-time heatmap (raster), SCUT marker,
stops colored by transit time, and a max-travel-time slider with Apply.
Uses only local data (no API calls). All coordinates converted to WGS84 for display.
"""
import json
import logging
from pathlib import Path

import folium
import numpy as np
import pandas as pd
from matplotlib import use as mpl_use
from matplotlib.colors import LinearSegmentedColormap
from scipy.interpolate import griddata

from config import (
    get_data_path,
    SCUT_LOCATION_JSON,
    STOPS_WITH_TRANSIT_CSV,
    STOPS_DEDUPED_CSV,
    GRID_TRAVEL_TIMES_CSV,
    GUANGZHOU_METRO_GEOJSON,
    GUANGZHOU_COMPOUNDS_GEOJSON,
    COMPOUND_TRANSIT_CACHE_CSV,
    COMMUTE_HEATMAP_HTML,
    SCUT_ADDRESS,
    TRANSIT_NO_ROUTE_SENTINEL,
)
from utils.io import load_json, load_csv

try:
    from pypinyin import pinyin, Style as PinyinStyle
    _HAS_PYPINYIN = True
except ImportError:
    _HAS_PYPINYIN = False

DISTRICT_EN = {
    "天河区": "Tianhe",
    "海珠区": "Haizhu",
    "越秀区": "Yuexiu",
    "荔湾区": "Liwan",
    "白云区": "Baiyun",
    "黄埔区": "Huangpu",
    "番禺区": "Panyu",
    "花都区": "Huadu",
    "南沙区": "Nansha",
    "增城区": "Zengcheng",
    "从化区": "Conghua",
}

mpl_use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def _to_pinyin(text: str) -> str:
    """Convert Chinese text to title-case pinyin. Returns empty string if pypinyin unavailable."""
    if not _HAS_PYPINYIN or not text:
        return ""
    syllables = pinyin(text, style=PinyinStyle.NORMAL)
    return " ".join(s[0].capitalize() for s in syllables)

logger = logging.getLogger(__name__)

# Color scale shifted +10 min: green <45, yellow ~58, orange ~70, red >80
TIME_ANCHORS = [0, 45, 58, 70, 80]  # minutes
# Normalized 0-1 for colormap; 80 min = 1.0
NORM_ANCHORS = [0, 45 / 80, 58 / 80, 70 / 80, 1.0]
COLOR_ANCHORS = ["#00cc00", "#00cc00", "#ffff00", "#ff8800", "#ff0000"]  # green, green, yellow, orange, red
RATING_ANCHORS = [1.0, 2.0, 3.0, 4.0, 5.0]
RATING_COLOR_ANCHORS = ["#d73027", "#fc8d59", "#fee08b", "#91cf60", "#1a9850"]
HEATMAP_RASTER_SIZE = 500
THRESHOLD_STEP = 10
THRESHOLD_MAX = 120
# Sample every Nth grid point for hover lookup (smaller = more accurate, larger payload)
GRID_HOVER_SAMPLE = 8


def _time_to_normalized(t: float) -> float:
    """Map travel time (min) to 0-1 for gradient. 0-35->0-0.5, 35-48->0.5-0.69, etc."""
    return float(np.clip(np.interp(t, TIME_ANCHORS, NORM_ANCHORS), 0.0, 1.0))


def time_to_hex(t: float) -> str:
    """Map transit travel time (minutes) to hex color (gradual green→yellow→orange→red)."""
    norm = _time_to_normalized(t)
    # Linear interpolation between COLOR_ANCHORS
    for i in range(len(NORM_ANCHORS) - 1):
        if NORM_ANCHORS[i] <= norm <= NORM_ANCHORS[i + 1]:
            frac = (norm - NORM_ANCHORS[i]) / (NORM_ANCHORS[i + 1] - NORM_ANCHORS[i])
            c0 = COLOR_ANCHORS[i]
            c1 = COLOR_ANCHORS[i + 1]
            r0, g0, b0 = int(c0[1:3], 16), int(c0[3:5], 16), int(c0[5:7], 16)
            r1, g1, b1 = int(c1[1:3], 16), int(c1[3:5], 16), int(c1[5:7], 16)
            r = int(r0 + (r1 - r0) * frac)
            g = int(g0 + (g1 - g0) * frac)
            b = int(b0 + (b1 - b0) * frac)
            return f"#{r:02x}{g:02x}{b:02x}"
    return COLOR_ANCHORS[-1]


def _interpolate_hex(value: float, anchors: list[float], colors: list[str]) -> str:
    value = float(np.clip(value, anchors[0], anchors[-1]))
    for i in range(len(anchors) - 1):
        if anchors[i] <= value <= anchors[i + 1]:
            frac = (value - anchors[i]) / (anchors[i + 1] - anchors[i])
            c0 = colors[i]
            c1 = colors[i + 1]
            r0, g0, b0 = int(c0[1:3], 16), int(c0[3:5], 16), int(c0[5:7], 16)
            r1, g1, b1 = int(c1[1:3], 16), int(c1[3:5], 16), int(c1[5:7], 16)
            r = int(r0 + (r1 - r0) * frac)
            g = int(g0 + (g1 - g0) * frac)
            b = int(b0 + (b1 - b0) * frac)
            return f"#{r:02x}{g:02x}{b:02x}"
    return colors[-1]


def rating_to_hex(rating: float) -> str:
    """Map average review rating 1-5 to red→green gradient."""
    return _interpolate_hex(rating, RATING_ANCHORS, RATING_COLOR_ANCHORS)


def _normalize_media_url(url: str) -> str:
    """Prefer https for remote media URLs embedded in the HTML."""
    if not url:
        return ""
    return str(url).replace("http://", "https://", 1)


def _build_colormap():
    """Matplotlib colormap for raster: green → yellow → orange → red."""
    return LinearSegmentedColormap.from_list(
        "travel_time",
        list(zip(NORM_ANCHORS, COLOR_ANCHORS)),
        N=256,
    )


def _generate_heatmap_rasters(
    lats: np.ndarray,
    lons: np.ndarray,
    times: np.ndarray,
    out_dir: Path,
) -> tuple[float, float, float, float]:
    """
    Interpolate travel time onto a fine grid (WGS84), then render PNGs per threshold.
    Returns (south, west, north, east) bounds. Heatmap overlays the full extent (no water masking).
    """
    lon_min, lon_max = lons.min(), lons.max()
    lat_min, lat_max = lats.min(), lats.max()
    margin = 0.002
    lon_min -= margin
    lon_max += margin
    lat_min -= margin
    lat_max += margin

    xi = np.linspace(lon_min, lon_max, HEATMAP_RASTER_SIZE)
    yi = np.linspace(lat_min, lat_max, HEATMAP_RASTER_SIZE)
    XI, YI = np.meshgrid(xi, yi)

    Z = griddata((lons, lats), times, (XI, YI), method="cubic", fill_value=np.nan)
    Z = np.clip(Z, 0, 150)
    norm = np.vectorize(_time_to_normalized)(Z)
    norm = np.nan_to_num(norm, nan=0.0, posinf=0.0, neginf=0.0)

    cmap = _build_colormap()
    out_dir.mkdir(parents=True, exist_ok=True)
    from PIL import Image

    for thresh in range(THRESHOLD_STEP, THRESHOLD_MAX + 1, THRESHOLD_STEP):
        mask = np.isfinite(Z) & (Z <= thresh)
        rgba = cmap(norm)
        rgba[..., 3] = np.where(mask, 0.55, 0.0)
        rgba = (np.clip(rgba, 0, 1) * 255).astype(np.uint8)
        rgba = np.flipud(rgba)
        Image.fromarray(rgba).save(out_dir / f"heatmap_t{thresh}.png")

    return (float(lat_min), float(lon_min), float(lat_max), float(lon_max))


def _build_guamap_script(
    stops_json: str, grid_hover_json: str, raster_rel_json: str, map_js_name: str,
    metro_js_var: str = "", compounds_js_var: str = "",
) -> str:
    """Build the guamap script that runs AFTER Folium (so map exists on window)."""
    map_name_quoted = json.dumps(map_js_name)
    metro_ref = metro_js_var if metro_js_var else "null"
    compounds_ref = compounds_js_var if compounds_js_var else "null"
    return f'''<script>
(function() {{
  var stopsData = {stops_json};
  var gridData = {grid_hover_json};
  var rasterRel = {raster_rel_json};
  var mapName = {map_name_quoted};
  var _metroLayer = (typeof {metro_ref} !== "undefined") ? {metro_ref} : null;
  var _compoundsLayer = (typeof {compounds_ref} !== "undefined") ? {compounds_ref} : null;
  function getRasterPath(threshold) {{
    var t = Math.min(120, Math.max(10, Math.round(threshold / 10) * 10));
    return rasterRel + t + ".png";
  }}
  function findMap() {{
    if (typeof window[mapName] !== "undefined" && window[mapName] && typeof window[mapName].eachLayer === "function") return window[mapName];
    return null;
  }}
  function stopIcon(color) {{
    var html = '<div style="width:14px;height:14px;border-radius:50%;background:' + color + ';border:1px solid ' + color + ';display:flex;align-items:center;justify-content:center;">' +
      '<div style="width:4px;height:4px;border-radius:50%;background:white;"></div></div>';
    return L.divIcon({{ html: html, iconSize: [14, 14], iconAnchor: [7, 7] }});
  }}
  function findStopByLatLng(lat, lon, maxDistSq) {{
    maxDistSq = maxDistSq || 1e-6;
    var best = null, bestD = 1e10;
    for (var i = 0; i < stopsData.length; i++) {{
      var s = stopsData[i];
      var d = (s.lat - lat) * (s.lat - lat) + (s.lon - lon) * (s.lon - lon);
      if (d < bestD) {{ bestD = d; best = s; }}
    }}
    return bestD < maxDistSq ? best : null;
  }}
  function esc(s) {{
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }}
  function showStopPanel(stop) {{
    var content = document.getElementById("stop-info-content");
    if (!content) return;
    var typeStr = (stop.type || "bus") === "metro" ? "Metro" : "Bus";
    var html = "<div><strong>Travel time</strong>: " + Math.round(stop.t) + " min</div>" +
      "<div><strong>Type</strong>: " + typeStr + "</div>";
    if (stop.name) html += "<div style=\\"margin-top:6px;\\"><strong>Name</strong>: " + esc(stop.name) + "</div>";
    if (stop.lines) {{
      var linesStr = esc(stop.lines);
      if (linesStr.length > 200) linesStr = linesStr.substring(0, 200) + "...";
      html += "<div style=\\"margin-top:6px;\\"><strong>Lines</strong>: " + linesStr + "</div>";
    }}
    content.innerHTML = html;
  }}
  function bindStopClick(marker, stop) {{
    marker.off("click").on("click", function(ev) {{
      L.DomEvent.stopPropagation(ev);
      showStopPanel(stop);
    }});
  }}
  function nearestGridPoint(lat, lon) {{
    if (!gridData.length) return null;
    var best = null, bestD = Infinity;
    for (var i = 0; i < gridData.length; i++) {{
      var g = gridData[i];
      var d = (g[0] - lat) * (g[0] - lat) + (g[1] - lon) * (g[1] - lon);
      if (d < bestD) {{ bestD = d; best = g; }}
    }}
    return best;
  }}
  var hoverThrottle = null;
  function onMapMouseMove(e) {{
    if (!e || !e.latlng) return;
    var ll = e.latlng;
    if (hoverThrottle) clearTimeout(hoverThrottle);
    hoverThrottle = setTimeout(function() {{
      hoverThrottle = null;
      var g = nearestGridPoint(ll.lat, ll.lng);
      var lbl = document.getElementById("hover-time-label");
      if (lbl && g) {{
        lbl.textContent = "Hover time estimate: ~" + Math.round(g[2]) + " min from here";
      }} else if (lbl) {{
        lbl.textContent = "Hover over the map to see estimated travel time.";
      }}
    }}, 50);
  }}
  function findStopsLayer(map) {{
    var candidates = [];
    map.eachLayer(function(layer) {{
      if (typeof layer.clearLayers === "function" && typeof layer.addLayer === "function" && typeof layer.setUrl !== "function") {{
        var hasMarkers = false;
        layer.eachLayer(function(child) {{
          if (child.getLatLng && typeof child.getLatLng === "function") hasMarkers = true;
        }});
        if (hasMarkers) candidates.push(layer);
      }}
    }});
    return candidates[0] || null;
  }}
  function findHeatmapOverlay(map) {{
    var overlay = null;
    map.eachLayer(function(layer) {{
      if (typeof layer.setUrl === "function") overlay = layer;
    }});
    return overlay;
  }}
  function findMetroLayer(map) {{ return _metroLayer; }}
  function findCompoundsLayer(map) {{ return _compoundsLayer; }}
  var _selectedCompoundLayer = null;
  var _selectedCompoundOrigStyle = null;
  var _centroidMarker = null;
  var _currentCompoundReviews = [];
  var _heatmapLayer = null;
  var _stopsLayer = null;
  var _modalGallery = [];
  var _modalIndex = 0;
  function centroidIcon() {{
    var html = '<div style="width:10px;height:10px;border-radius:50%;background:white;border:2px solid #1e293b;box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>';
    return L.divIcon({{ html: html, iconSize: [14, 14], iconAnchor: [7, 7], className: "" }});
  }}
  function lightenHex(hex, factor) {{
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    r = Math.min(255, Math.round(r + (255-r)*factor));
    g = Math.min(255, Math.round(g + (255-g)*factor));
    b = Math.min(255, Math.round(b + (255-b)*factor));
    return "#" + ((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
  }}
  function safeUrl(url) {{
    if (!url) return "";
    url = String(url).trim();
    if (!/^https?:\/\//i.test(url)) return "";
    return url.replace(/^http:\/\//i, "https://");
  }}
  function starText(score) {{
    score = Math.max(0, Math.min(5, Math.round(Number(score) || 0)));
    if (!score) return "";
    return "★".repeat(score) + '<span style="color:#94a3b8;">' + "★".repeat(5 - score) + "</span>";
  }}
  function ratingFilterValue() {{
    var sel = document.getElementById("compound-rating-filter-select");
    return sel ? sel.value : "all";
  }}
  function matchesRatingFilter(props) {{
    var filter = ratingFilterValue();
    var avg = Number(props.rating_avg || 0);
    var count = Number(props.rating_count || 0);
    if (filter === "all") return true;
    if (filter === "any") return count > 0;
    var star = Number(filter);
    if (!(star >= 1 && star <= 5) || count <= 0) return false;
    if (star === 5) return avg >= 5;
    return avg >= star && avg < (star + 1);
  }}
  function currentMaxThreshold() {{
    var mt = document.getElementById("max-time");
    return mt ? parseFloat(mt.value) : 120;
  }}
  function passesTravelThreshold(props, threshold) {{
    var t = Number(props.transit_time);
    // If no transit time is available (<0), do not hide the compound based on the slider.
    if (!(t >= 0)) return true;
    return t <= threshold;
  }}
  function getCompoundFillColor(props) {{
    var transitCb = document.getElementById("compound-color-transit");
    var ratingCb = document.getElementById("compound-color-rating");
    if (transitCb && transitCb.checked && props.transit_color) return props.transit_color;
    if (ratingCb && ratingCb.checked) {{
      if (Number(props.rating_count || 0) > 0 && props.rating_color) return props.rating_color;
      return "#ffffff";
    }}
    return "#3388ff";
  }}
  function getCompoundStyle(props, threshold) {{
    threshold = (typeof threshold === "number") ? threshold : currentMaxThreshold();
    if (!passesTravelThreshold(props, threshold)) {{
      return {{ color: "#ffffff", weight: 0.5, fillColor: "#ffffff", fillOpacity: 0.0, opacity: 0.0 }};
    }}
    var fill = getCompoundFillColor(props);
    var ratingCb = document.getElementById("compound-color-rating");
    if (ratingCb && ratingCb.checked) {{
      if (!matchesRatingFilter(props)) {{
        return {{ color: fill, weight: 0.5, fillColor: fill, fillOpacity: 0.0, opacity: 0.0 }};
      }}
      if (Number(props.rating_count || 0) > 0) {{
        return {{ color: fill, weight: 1.5, fillColor: fill, fillOpacity: 0.55, opacity: 0.8 }};
      }}
      // Unrated compounds: clearly visible but visually de-emphasized vs rated ones.
      return {{ color: "#9CBFFF", weight: 1.2, fillColor: "#f9fafb", fillOpacity: 0.5, opacity: 0.9 }};
    }}
    return {{ color: fill, weight: 1.5, fillColor: fill, fillOpacity: 0.45, opacity: 0.7 }};
  }}
  function recolorCompounds(threshold) {{
    var cl = findCompoundsLayer(null);
    if (!cl) return;
    threshold = (typeof threshold === "number") ? threshold : currentMaxThreshold();
    var map = findMap();
    var ratedLayers = [];
    var unratedLayers = [];
    cl.eachLayer(function(layer) {{
      var props = (layer.feature && layer.feature.properties) || {{}};
      var style = getCompoundStyle(props, threshold);
      layer.setStyle(style);
      if (Number(props.rating_count || 0) > 0) ratedLayers.push(layer);
      else unratedLayers.push(layer);
    }});
    // Keep unrated polygons behind rated ones in ratings mode.
    unratedLayers.forEach(function(layer) {{ if (layer && layer.bringToBack) layer.bringToBack(); }});
    ratedLayers.forEach(function(layer) {{ if (layer && layer.bringToFront) layer.bringToFront(); }});
    _selectedCompoundLayer = null;
    _selectedCompoundOrigStyle = null;
    if (_centroidMarker && map) {{ map.removeLayer(_centroidMarker); _centroidMarker = null; }}
  }}
  function ensureImageModal() {{
    if (document.getElementById("guamap-image-modal")) return;
    var modal = document.createElement("div");
    modal.id = "guamap-image-modal";
    modal.style.cssText = "display:none;position:fixed;inset:0;z-index:10002;background:rgba(2,6,23,0.85);align-items:center;justify-content:center;padding:28px;";
    modal.innerHTML = '<div style="position:relative;max-width:94vw;max-height:94vh;">' +
      '<button id="guamap-image-modal-close" style="position:absolute;top:-14px;right:-14px;width:34px;height:34px;border-radius:999px;border:1px solid rgba(148,163,184,0.55);background:rgba(15,23,42,0.9);color:#fff;cursor:pointer;font-size:18px;line-height:1;">&times;</button>' +
      '<button id="guamap-image-modal-prev" style="display:none;position:absolute;left:-16px;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:999px;border:1px solid rgba(148,163,184,0.55);background:rgba(15,23,42,0.9);color:#fff;cursor:pointer;font-size:18px;line-height:1;">&#8249;</button>' +
      '<button id="guamap-image-modal-next" style="display:none;position:absolute;right:-16px;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:999px;border:1px solid rgba(148,163,184,0.55);background:rgba(15,23,42,0.9);color:#fff;cursor:pointer;font-size:18px;line-height:1;">&#8250;</button>' +
      '<img id="guamap-image-modal-img" src="" style="max-width:94vw;max-height:94vh;border-radius:12px;border:1px solid rgba(148,163,184,0.35);object-fit:contain;">' +
      "</div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", function(ev) {{
      if (ev.target === modal) window.guamapCloseImage();
    }});
    var closeBtn = document.getElementById("guamap-image-modal-close");
    if (closeBtn) closeBtn.onclick = window.guamapCloseImage;
    var prevBtn = document.getElementById("guamap-image-modal-prev");
    var nextBtn = document.getElementById("guamap-image-modal-next");
    if (prevBtn) prevBtn.onclick = function(ev) {{ ev.stopPropagation(); window.guamapModalPrev(); }};
    if (nextBtn) nextBtn.onclick = function(ev) {{ ev.stopPropagation(); window.guamapModalNext(); }};
  }}
  function renderModalImage() {{
    ensureImageModal();
    var modal = document.getElementById("guamap-image-modal");
    var img = document.getElementById("guamap-image-modal-img");
    var prevBtn = document.getElementById("guamap-image-modal-prev");
    var nextBtn = document.getElementById("guamap-image-modal-next");
    if (!modal || !img || !_modalGallery.length) return;
    var current = safeUrl(_modalGallery[_modalIndex] || "");
    if (!current) return;
    img.src = current;
    var showNav = _modalGallery.length > 1;
    if (prevBtn) prevBtn.style.display = showNav ? "block" : "none";
    if (nextBtn) nextBtn.style.display = showNav ? "block" : "none";
    modal.style.display = "flex";
  }}
  window.guamapOpenImage = function(url) {{
    _modalGallery = [safeUrl(url)];
    _modalIndex = 0;
    renderModalImage();
  }};
  window.guamapOpenReviewImage = function(reviewIdx, picIdx) {{
    var ri = Number(reviewIdx), pi = Number(picIdx);
    if (!(ri >= 0) || !_currentCompoundReviews[ri]) return;
    var pics = (_currentCompoundReviews[ri].pics || []).map(safeUrl).filter(function(u) {{ return !!u; }});
    if (!pics.length) return;
    _modalGallery = pics;
    _modalIndex = Math.max(0, Math.min(pi, pics.length - 1));
    renderModalImage();
  }};
  window.guamapModalPrev = function() {{
    if (!_modalGallery.length) return;
    _modalIndex = (_modalIndex - 1 + _modalGallery.length) % _modalGallery.length;
    renderModalImage();
  }};
  window.guamapModalNext = function() {{
    if (!_modalGallery.length) return;
    _modalIndex = (_modalIndex + 1) % _modalGallery.length;
    renderModalImage();
  }};
  window.guamapCloseImage = function() {{
    var modal = document.getElementById("guamap-image-modal");
    if (modal) modal.style.display = "none";
  }};
  window.guamapTranslateReview = async function(idx, btn) {{
    var i = Number(idx);
    if (!(i >= 0) || !_currentCompoundReviews[i]) return;
    var review = _currentCompoundReviews[i];
    var target = document.getElementById("compound-review-text-" + i);
    if (!target) return;
    if (review._showing_en) {{
      target.innerHTML = esc(review.review || "").replace(/\\n/g, "<br>");
      review._showing_en = false;
      if (btn) btn.textContent = "Translate to English";
      return;
    }}
    if (!review._translated_en) {{
      if (btn) {{ btn.disabled = true; btn.textContent = "Translating..."; }}
      try {{
        var q = encodeURIComponent(String(review.review || ""));
        var url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + q;
        var res = await fetch(url);
        var data = await res.json();
        var translated = "";
        if (Array.isArray(data) && Array.isArray(data[0])) {{
          translated = data[0].map(function(p) {{ return p[0] || ""; }}).join("");
        }}
        review._translated_en = translated || "(Translation unavailable)";
      }} catch (e) {{
        review._translated_en = "(Translation unavailable)";
      }}
    }}
    target.innerHTML = esc(review._translated_en).replace(/\\n/g, "<br>");
    review._showing_en = true;
    if (btn) {{ btn.disabled = false; btn.textContent = "Show original"; }}
  }};
  function buildReviewCard(review, idx) {{
    var html = '<div style="margin-top:12px;padding:10px 12px;border:1px solid rgba(148,163,184,0.18);border-radius:12px;background:rgba(15,23,42,0.25);">';
    html += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">';
    html += '<div style="font-weight:600;color:#f8fafc;">' + esc(review.author || "Anonymous") + '</div>';
    html += '<div style="font-size:12px;color:#94a3b8;white-space:nowrap;">' + esc(review.time || "") + '</div>';
    html += '</div>';
    if (Number(review.score || 0) > 0) {{
      html += '<div style="margin-top:4px;color:#fbbf24;font-size:13px;">' + starText(review.score) + ' <span style="color:#e5e7eb;">(' + Number(review.score) + '/5)</span></div>';
    }}
    if (review.review) {{
      html += '<button style="margin-top:8px;padding:6px 10px;border-radius:999px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.45);color:#cbd5e1;font-size:12px;cursor:pointer;" onclick="window.guamapTranslateReview(' + idx + ', this)">Translate to English</button>';
      html += '<div id="compound-review-text-' + idx + '" style="margin-top:8px;line-height:1.6;color:#e5e7eb;">' + esc(review.review).replace(/\\n/g, "<br>") + '</div>';
    }}
    if (review.pics && review.pics.length) {{
      html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">';
      for (var i = 0; i < review.pics.length; i++) {{
        var pic = safeUrl(review.pics[i]);
        if (!pic) continue;
        html += '<img src="' + esc(pic) + '" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid rgba(148,163,184,0.25);cursor:pointer;" onclick="window.guamapOpenReviewImage(' + idx + ', ' + i + ')" loading="lazy">';
      }}
      html += '</div>';
    }}
    html += '</div>';
    return html;
  }}
  function showCompoundPanel(props) {{
    var content = document.getElementById("stop-info-content");
    if (!content) return;
    var coverUrl = safeUrl(props.cover_url);
    var reviews = Array.isArray(props.reviews) ? props.reviews : [];
    var ratingCount = Number(props.rating_count || 0);
    var reviewCount = Number(props.review_count || reviews.length || 0);
    var html = "";
    if (coverUrl) {{
      html += '<div style="margin-bottom:12px;"><img src="' + esc(coverUrl) + '" alt="Compound cover" style="width:100%;max-height:180px;object-fit:cover;border-radius:14px;border:1px solid rgba(148,163,184,0.22);cursor:pointer;" onclick="window.guamapOpenImage(this.src)" loading="lazy" onerror="this.style.display=\\'none\\'"></div>';
    }}
    html += "<div><strong>Name</strong>: " + esc(props.name || "") + "</div>";
    if (props.name_en) html += "<div><strong>English</strong>: " + esc(props.name_en) + "</div>";
    html += "<div style='margin-top:6px;'><strong>District</strong>: " + esc(props.district || "") + "</div>";
    if (props.district_en) html += "<div><strong>District (EN)</strong>: " + esc(props.district_en) + "</div>";
    if (props.transit_time != null && props.transit_time >= 0) {{
      html += "<div style='margin-top:6px;'><strong>Transit time</strong>: " + Math.round(props.transit_time) + " min</div>";
      if (props.transfers != null && props.transfers >= 0) html += "<div><strong>Transfers</strong>: " + props.transfers + "</div>";
      if (props.breakdown) html += "<div style='margin-top:6px;font-size:13px;color:#cbd5e1;'><strong>Breakdown</strong>:<br>" + esc(props.breakdown).replace(/→/g, "<span style='color:#94a3b8;'> → </span>") + "</div>";
    }} else {{
      html += "<div style='margin-top:6px;color:#f87171;'>No transit data</div>";
    }}
    html += "<div style='margin-top:8px;'><strong>Reviews</strong>: " + reviewCount + "</div>";
    if (ratingCount > 0) {{
      html += "<div><strong>Average rating</strong>: " + Number(props.rating_avg || 0).toFixed(2) + "/5 from " + ratingCount + " scored review" + (ratingCount === 1 ? "" : "s") + "</div>";
    }}
    if (reviewCount > 0) {{
      html += '<button id="compound-reviews-toggle" style="margin-top:12px;padding:8px 12px;border-radius:999px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.45);color:#e5e7eb;font-size:13px;cursor:pointer;" onclick="window.guamapToggleReviews()">' +
        "Open reviews (" + reviewCount + ")" + '</button>';
      html += '<div id="compound-reviews-list" style="display:none;margin-top:8px;"></div>';
    }}
    content.innerHTML = html;
    _currentCompoundReviews = reviews.slice();
    if (reviewCount > 0) {{
      var list = document.getElementById("compound-reviews-list");
      if (list) {{
        var cards = [];
        for (var i = 0; i < reviews.length; i++) cards.push(buildReviewCard(reviews[i], i));
        list.innerHTML = cards.join("");
      }}
    }}
  }}
  function setupCompoundInteraction() {{
    var cl = findCompoundsLayer(null);
    if (!cl) return;
    var map = findMap();
    cl.eachLayer(function(layer) {{
      layer.on("click", function(e) {{
        L.DomEvent.stopPropagation(e);
        if (_selectedCompoundLayer && _selectedCompoundLayer !== layer) {{
          _selectedCompoundLayer.setStyle(_selectedCompoundOrigStyle);
        }}
        var props = (layer.feature && layer.feature.properties) || {{}};
        var baseStyle = getCompoundStyle(props, currentMaxThreshold());
        _selectedCompoundOrigStyle = baseStyle;
        var highlightFill = lightenHex(baseStyle.fillColor, 0.45);
        layer.setStyle({{ color: highlightFill, weight: 2, fillColor: highlightFill, fillOpacity: 0.7, opacity: 0.9 }});
        layer.bringToFront();
        _selectedCompoundLayer = layer;
        showCompoundPanel(props);
        // Centroid marker
        var cLat = props.centroid_lat_wgs, cLon = props.centroid_lon_wgs;
        if (cLat && cLon && map) {{
          if (_centroidMarker) {{ _centroidMarker.setLatLng([cLat, cLon]); }}
          else {{ _centroidMarker = L.marker([cLat, cLon], {{ icon: centroidIcon(), interactive: false, zIndexOffset: 1000 }}).addTo(map); }}
        }}
      }});
    }});
  }}
  function findBaseLayers(map) {{
    var color = null, gray = null;
    map.eachLayer(function(layer) {{
      if (layer instanceof L.TileLayer) {{
        if (layer.options && layer.options.className === "grayscale-tiles") gray = layer;
        else color = layer;
      }}
    }});
    return {{ color: color, gray: gray }};
  }}
  function applyStopsFilter(map, threshold) {{
    threshold = (typeof threshold === "number") ? threshold : currentMaxThreshold();
    if (_heatmapLayer) _heatmapLayer.setUrl(getRasterPath(threshold));
    if (_stopsLayer && stopsData.length) {{
      _stopsLayer.clearLayers();
      stopsData.forEach(function(s) {{
        if (s.t <= threshold) {{
          var m = L.marker([s.lat, s.lon], {{ icon: stopIcon(s.color) }});
          bindStopClick(m, s);
          _stopsLayer.addLayer(m);
        }}
      }});
    }}
    recolorCompounds(threshold);
  }}
  function setupLayerToggles(map) {{
    var heatmapCb = document.getElementById("toggle-heatmap");
    var stopsCb = document.getElementById("toggle-stops");
    var metroCb = document.getElementById("toggle-metro");
    var compoundsCb = document.getElementById("toggle-compounds");
    var grayCb = document.getElementById("toggle-base-gray");
    if (!heatmapCb && !stopsCb && !metroCb && !compoundsCb && !grayCb) return;
    var heatmap = _heatmapLayer || findHeatmapOverlay(map);
    var stopsLayer = _stopsLayer || findStopsLayer(map);
    _heatmapLayer = heatmap || _heatmapLayer;
    _stopsLayer = stopsLayer || _stopsLayer;
    var bases = findBaseLayers(map);
    // Enforce default: colored base ON, grayscale OFF
    if (bases.color && bases.gray) {{
      if (!map.hasLayer(bases.color)) map.addLayer(bases.color);
      if (map.hasLayer(bases.gray)) map.removeLayer(bases.gray);
      if (grayCb) grayCb.checked = false;
    }}
    if (heatmapCb && heatmap) {{
      heatmapCb.checked = map.hasLayer(heatmap);
      heatmapCb.onchange = function() {{
        if (heatmapCb.checked) map.addLayer(heatmap); else map.removeLayer(heatmap);
      }};
    }}
    if (stopsCb && stopsLayer) {{
      stopsCb.checked = map.hasLayer(stopsLayer);
      stopsCb.onchange = function() {{
        if (stopsCb.checked) map.addLayer(stopsLayer); else map.removeLayer(stopsLayer);
      }};
    }}
    if (metroCb) {{
      var metro = findMetroLayer(map);
      if (metro) {{
        metroCb.checked = map.hasLayer(metro);
        metroCb.onchange = function() {{
          if (metroCb.checked) map.addLayer(metro); else map.removeLayer(metro);
        }};
      }} else {{
        metroCb.disabled = true;
      }}
    }}
    if (compoundsCb) {{
      var compounds = findCompoundsLayer(map);
      var compOptsEl = document.getElementById("compounds-options");
      var compTransitCb = document.getElementById("compound-color-transit");
      var compRatingCb = document.getElementById("compound-color-rating");
      var compRatingFilter = document.getElementById("compound-rating-filter");
      var compRatingFilterSelect = document.getElementById("compound-rating-filter-select");
      if (compounds) {{
        compoundsCb.checked = map.hasLayer(compounds);
        if (compOptsEl) compOptsEl.style.display = compoundsCb.checked ? "block" : "none";
        compoundsCb.onchange = function() {{
          if (compoundsCb.checked) {{ map.addLayer(compounds); recolorCompounds(currentMaxThreshold()); }}
          else {{
            map.removeLayer(compounds);
            if (_centroidMarker) {{ map.removeLayer(_centroidMarker); _centroidMarker = null; }}
            _selectedCompoundLayer = null; _selectedCompoundOrigStyle = null;
          }}
          if (compOptsEl) compOptsEl.style.display = compoundsCb.checked ? "block" : "none";
        }};
        if (compTransitCb) {{
          compTransitCb.checked = false;
          compTransitCb.onchange = function() {{
            if (compTransitCb.checked && compRatingCb) compRatingCb.checked = false;
            if (compRatingFilter) compRatingFilter.style.display = (compRatingCb && compRatingCb.checked) ? "block" : "none";
            recolorCompounds(currentMaxThreshold());
          }};
        }}
        if (compRatingCb) {{
          compRatingCb.checked = false;
          compRatingCb.onchange = function() {{
            if (compRatingCb.checked && compTransitCb) compTransitCb.checked = false;
            if (compRatingFilter) compRatingFilter.style.display = compRatingCb.checked ? "block" : "none";
            recolorCompounds(currentMaxThreshold());
          }};
        }}
        if (compRatingFilterSelect) {{
          compRatingFilterSelect.value = "all";
          compRatingFilterSelect.onchange = function() {{
            if (compRatingCb && compRatingCb.checked) recolorCompounds(currentMaxThreshold());
          }};
        }}
        setupCompoundInteraction();
      }} else {{
        compoundsCb.disabled = true;
      }}
    }}
    if (grayCb && bases.gray) {{
      grayCb.checked = map.hasLayer(bases.gray);
      grayCb.onchange = function() {{
        if (!bases.color || !bases.gray) return;
        if (grayCb.checked) {{
          map.addLayer(bases.gray);
          map.removeLayer(bases.color);
        }} else {{
          map.addLayer(bases.color);
          map.removeLayer(bases.gray);
        }}
      }};
    }} else if (grayCb) {{
      grayCb.disabled = true;
    }}
  }}
  // ── Anjuke Listings Layer ──
  var _anjukeLayer = null;
  var _anjukeMarkers = [];
  var _currentAnjukeCommunity = null;
  function anjukeMarkerIcon(count) {{
    var size = count > 50 ? 28 : count > 20 ? 24 : 20;
    var bg = "#6366f1";
    var html = '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + bg + ';border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.35);">' + count + '</div>';
    return L.divIcon({{ html: html, iconSize: [size, size], iconAnchor: [size/2, size/2], className: "" }});
  }}
  function buildAnjukeLayer(map) {{
    if (!window._anjukeData || !window._anjukeData.length) return null;
    var fg = L.featureGroup();
    window._anjukeData.forEach(function(comm, idx) {{
      if (!comm.lat || !comm.lng) return;
      var count = (comm.listings || []).length;
      var marker = L.marker([comm.lat, comm.lng], {{ icon: anjukeMarkerIcon(count) }});
      marker.on("click", function(e) {{
        L.DomEvent.stopPropagation(e);
        showAnjukeCommunityPanel(comm);
      }});
      marker.bindTooltip(esc(comm.name) + " (" + count + ")", {{ sticky: true, direction: "top" }});
      fg.addLayer(marker);
    }});
    return fg;
  }}
  function getAnjukeFilteredListings(comm) {{
    var listings = (comm && comm.listings) || [];
    var rentSel = document.getElementById("anjuke-filter-rent");
    var maxPriceEl = document.getElementById("anjuke-filter-maxprice");
    var sortSel = document.getElementById("anjuke-sort");
    var rent = rentSel ? rentSel.value : "all";
    var maxPrice = maxPriceEl ? parseFloat(maxPriceEl.value) : NaN;
    var sort = sortSel ? sortSel.value : "price-asc";
    var filtered = listings.filter(function(l) {{
      if (rent !== "all" && l.r !== rent) return false;
      if (!isNaN(maxPrice) && Number(l.p) > maxPrice) return false;
      return true;
    }});
    filtered.sort(function(a, b) {{
      if (sort === "price-asc") return Number(a.p) - Number(b.p);
      if (sort === "price-desc") return Number(b.p) - Number(a.p);
      if (sort === "area-desc") return parseFloat(b.a) - parseFloat(a.a);
      if (sort === "area-asc") return parseFloat(a.a) - parseFloat(b.a);
      return 0;
    }});
    return filtered;
  }}
  function ajkImgUrl(hash, size) {{
    if (!hash) return "";
    return "https://pic1.ajkimg.com/display/anjuke/" + hash + "/" + (size || "600x600") + ".jpg?t=1&srotate=1";
  }}
  function ajkThumbUrl(hash) {{ return ajkImgUrl(hash, "240x180c"); }}
  function ajkListingLink(id) {{
    return id ? "https://gz.zu.anjuke.com/fangyuan/" + id : "";
  }}
  function buildListingCard(listing, idx) {{
    var imgs = (listing.ih || []);
    var coverHash = imgs.length ? imgs[0] : "";
    var coverUrl = ajkThumbUrl(coverHash);
    var html = '<div style="margin-top:10px;padding:10px 12px;border:1px solid rgba(148,163,184,0.18);border-radius:12px;background:rgba(15,23,42,0.25);">';
    if (coverUrl) {{
      html += '<img src="' + esc(coverUrl) + '" style="width:100%;max-height:140px;object-fit:cover;border-radius:10px;cursor:pointer;" onclick="window.guamapOpenListingImages(' + idx + ', 0)" loading="lazy">';
    }}
    html += '<div style="margin-top:8px;font-weight:600;color:#f8fafc;font-size:14px;">' + esc(listing.t || "") + '</div>';
    html += '<button style="margin-top:4px;padding:4px 8px;border-radius:999px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.45);color:#cbd5e1;font-size:11px;cursor:pointer;" onclick="window.guamapTranslateListingTitle(' + idx + ', this)">Translate</button>';
    html += '<div id="anjuke-listing-title-' + idx + '" style="display:none;margin-top:4px;font-size:13px;color:#cbd5e1;"></div>';
    html += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;font-size:13px;">';
    html += '<span style="color:#fbbf24;font-weight:700;">¥' + Number(listing.p).toLocaleString() + '/mo</span>';
    if (listing.a) html += '<span style="color:#94a3b8;">' + esc(listing.a) + 'm²</span>';
    if (listing.rh) html += '<span style="color:#94a3b8;">' + esc(listing.rh) + '</span>';
    if (listing.r) html += '<span style="padding:2px 6px;border-radius:4px;background:' + (listing.r === "\u6574\u79df" ? "rgba(34,197,94,0.15);color:#4ade80;" : "rgba(168,85,247,0.15);color:#c084fc;") + 'font-size:11px;">' + esc(listing.r) + '</span>';
    html += '</div>';
    html += '<div style="margin-top:4px;font-size:12px;color:#94a3b8;">';
    if (listing.o) html += esc(listing.o) + ' \u00b7 ';
    if (listing.f) html += esc(listing.f) + ' \u00b7 ';
    if (listing.fl) html += esc(listing.fl);
    if (listing.mi) html += ' \u00b7 \U0001f687 ' + esc(listing.mi);
    html += '</div>';
    if (imgs.length > 1) {{
      html += '<div style="display:flex;gap:6px;margin-top:8px;overflow-x:auto;">';
      for (var i = 0; i < Math.min(imgs.length, 6); i++) {{
        var src = ajkThumbUrl(imgs[i]);
        if (!src) continue;
        html += '<img src="' + esc(src) + '" style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer;flex-shrink:0;" onclick="window.guamapOpenListingImages(' + idx + ', ' + i + ')" loading="lazy">';
      }}
      if (imgs.length > 6) html += '<span style="align-self:center;color:#94a3b8;font-size:11px;white-space:nowrap;">+' + (imgs.length - 6) + '</span>';
      html += '</div>';
    }}
    var linkUrl = ajkListingLink(listing.id);
    if (linkUrl) {{
      html += '<a href="' + esc(linkUrl) + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;padding:6px 12px;border-radius:999px;background:rgba(99,102,241,0.15);color:#a5b4fc;font-size:12px;text-decoration:none;">View on Anjuke \u2192</a>';
    }}
    html += '</div>';
    return html;
  }}
  var _currentAnjukeListings = [];
  function showAnjukeCommunityPanel(comm) {{
    _currentAnjukeCommunity = comm;
    var filtered = getAnjukeFilteredListings(comm);
    _currentAnjukeListings = filtered;
    var content = document.getElementById("stop-info-content");
    if (!content) return;
    var html = '<div style="font-weight:650;font-size:17px;color:#f8fafc;">' + esc(comm.name || "") + '</div>';
    if (comm.name_en) html += '<div style="font-size:13px;color:#94a3b8;">' + esc(comm.name_en) + '</div>';
    html += '<div style="margin-top:6px;font-size:13px;color:#cbd5e1;">';
    if (comm.district) html += esc(comm.district) + (comm.district_en ? ' (' + esc(comm.district_en) + ')' : '') + ' · ';
    if (comm.block) html += esc(comm.block) + ' · ';
    if (comm.build_date) html += 'Built ' + esc(comm.build_date);
    html += '</div>';
    html += '<div style="margin-top:8px;font-weight:600;color:#a5b4fc;">' + filtered.length + ' listing' + (filtered.length === 1 ? '' : 's') + '</div>';
    if (filtered.length > 0) {{
      var prices = filtered.map(function(l) {{ return Number(l.p); }}).filter(function(p) {{ return p > 0; }});
      if (prices.length) {{
        var minP = Math.min.apply(null, prices), maxP = Math.max.apply(null, prices);
        html += '<div style="font-size:13px;color:#94a3b8;">Price range: ¥' + minP.toLocaleString() + ' – ¥' + maxP.toLocaleString() + '/mo</div>';
      }}
    }}
    html += '<div id="anjuke-listings-container" style="margin-top:8px;">';
    for (var i = 0; i < filtered.length; i++) html += buildListingCard(filtered[i], i);
    html += '</div>';
    content.innerHTML = html;
    content.scrollTop = 0;
  }}
  window.guamapOpenListingImages = function(listingIdx, picIdx) {{
    var li = Number(listingIdx);
    if (!(li >= 0) || !_currentAnjukeListings[li]) return;
    var hashes = (_currentAnjukeListings[li].ih || []);
    var imgs = hashes.map(function(h) {{ return ajkImgUrl(h); }}).filter(function(u) {{ return !!u; }});
    if (!imgs.length) return;
    _modalGallery = imgs;
    _modalIndex = Math.max(0, Math.min(picIdx, imgs.length - 1));
    renderModalImage();
  }};
  window.guamapTranslateListingTitle = async function(idx, btn) {{
    var i = Number(idx);
    if (!(i >= 0) || !_currentAnjukeListings[i]) return;
    var listing = _currentAnjukeListings[i];
    var target = document.getElementById("anjuke-listing-title-" + i);
    if (!target) return;
    if (target.style.display !== "none") {{
      target.style.display = "none";
      if (btn) btn.textContent = "Translate";
      return;
    }}
    if (!listing._title_en) {{
      if (btn) {{ btn.disabled = true; btn.textContent = "Translating..."; }}
      try {{
        var text = String(listing.t || "");
        var q = encodeURIComponent(text.substring(0, 1000));
        var url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + q;
        var res = await fetch(url);
        var data = await res.json();
        var translated = "";
        if (Array.isArray(data) && Array.isArray(data[0])) {{
          translated = data[0].map(function(p) {{ return p[0] || ""; }}).join("");
        }}
        listing._title_en = translated || "(Translation unavailable)";
      }} catch (e) {{
        listing._title_en = "(Translation unavailable)";
      }}
    }}
    target.textContent = listing._title_en;
    target.style.display = "block";
    if (btn) {{ btn.disabled = false; btn.textContent = "Hide translation"; }}
  }};
  function setupAnjukeLayer(map) {{
    var anjukeCb = document.getElementById("toggle-anjuke");
    var anjukeOptsEl = document.getElementById("anjuke-options");
    if (!anjukeCb || !window._anjukeData) return;
    _anjukeLayer = buildAnjukeLayer(map);
    if (!_anjukeLayer) {{ anjukeCb.disabled = true; return; }}
    anjukeCb.checked = false;
    if (anjukeOptsEl) anjukeOptsEl.style.display = "none";
    anjukeCb.onchange = function() {{
      if (anjukeCb.checked) {{
        map.addLayer(_anjukeLayer);
      }} else {{
        map.removeLayer(_anjukeLayer);
      }}
      if (anjukeOptsEl) anjukeOptsEl.style.display = anjukeCb.checked ? "block" : "none";
    }};
    // Re-render current community when filters change
    var filterEls = ["anjuke-filter-rent", "anjuke-sort", "anjuke-filter-maxprice"];
    filterEls.forEach(function(elId) {{
      var el = document.getElementById(elId);
      if (el) {{
        el.addEventListener("change", function() {{
          if (_currentAnjukeCommunity) showAnjukeCommunityPanel(_currentAnjukeCommunity);
        }});
        el.addEventListener("input", function() {{
          if (_currentAnjukeCommunity) showAnjukeCommunityPanel(_currentAnjukeCommunity);
        }});
      }}
    }});
  }}
  function setupPanelToggle() {{
    var panel = document.getElementById("control-panel");
    var btn = document.getElementById("panel-toggle");
    if (!panel || !btn) return;
    var collapsed = false;
    btn.onclick = function() {{
      collapsed = !collapsed;
      if (collapsed) {{
        panel.style.transform = "translateX(-85%)";
        panel.style.opacity = "0.6";
        btn.innerHTML = "&rsaquo;";
      }} else {{
        panel.style.transform = "translateX(0)";
        panel.style.opacity = "1";
        btn.innerHTML = "&lsaquo;";
      }}
    }};
  }}
  window.guamapToggleReviews = function() {{
    var list = document.getElementById("compound-reviews-list");
    var btn = document.getElementById("compound-reviews-toggle");
    if (!list || !btn) return;
    var open = list.style.display !== "none";
    if (open) {{
      list.style.display = "none";
      btn.textContent = btn.textContent.replace("Hide reviews", "Open reviews");
    }} else {{
      list.style.display = "block";
      btn.textContent = btn.textContent.replace("Open reviews", "Hide reviews");
    }}
  }};
  window.guamapApply = function() {{
    var map = findMap();
    if (map) {{
      bindMapInteractions(map);
      var mt = document.getElementById("max-time");
      applyStopsFilter(map, mt ? parseFloat(mt.value) : 120);
    }}
  }};
  function bindMapInteractions(map) {{
    if (map._guamapBound) return;
    map._guamapBound = true;
    var container = map.getContainer();
    document.addEventListener("mousemove", function(domEv) {{
      if (!container || !container.contains(domEv.target)) return;
      try {{
        var ll = map.mouseEventToLatLng(domEv);
        onMapMouseMove({{ latlng: ll }});
      }} catch (e) {{}}
    }});
    if (container) {{
      container.addEventListener("mouseleave", function() {{
        var lbl = document.getElementById("hover-time-label");
        if (lbl) lbl.textContent = "Hover over the map to see estimated travel time.";
      }});
    }}
    map.on("click", function(ev) {{
      var stop = findStopByLatLng(ev.latlng.lat, ev.latlng.lng, 1e-5);
      if (stop) showStopPanel(stop);
    }});
  }}
  var map = findMap();
  if (map) {{
    bindMapInteractions(map);
    setupLayerToggles(map);
    setupAnjukeLayer(map);
    applyStopsFilter(map, 120);
  }}
  setupPanelToggle();
}})();
</script>'''


def build_commute_map(
    use_contours: bool = False,
    add_stops_layer: bool = True,
) -> Path:
    """
    Build Folium map: smooth raster heatmap, SCUT marker, stops colored by transit time,
    and a max travel-time slider with Apply. Reads only from data/ (no API calls).
    """
    from utils.coord_transform import gcj02_to_wgs84, gcj02_to_wgs84_array

    path_travel = get_data_path(GRID_TRAVEL_TIMES_CSV)
    if not path_travel.exists():
        raise FileNotFoundError(f"Run Stage 2 first: {path_travel}")

    df = load_csv(path_travel)
    if df.empty:
        raise ValueError("No grid travel times to visualize")

    scut_data = load_json(get_data_path(SCUT_LOCATION_JSON))
    if not scut_data or "lat" not in scut_data:
        raise FileNotFoundError("SCUT location not found; run Stage 1")

    center_lon_gcj = float(scut_data["lon"])
    center_lat_gcj = float(scut_data["lat"])
    center_lon, center_lat = gcj02_to_wgs84(center_lon_gcj, center_lat_gcj)
    scut_label = scut_data.get("address", SCUT_ADDRESS)

    # Grid in WGS84 so heatmap aligns with map and stops (no GCJ-02 offset)
    lats_gcj = np.asarray(df["lat"], dtype=np.float64)
    lons_gcj = np.asarray(df["lon"], dtype=np.float64)
    times = np.asarray(df["travel_time_minutes"], dtype=np.float64)
    lons_wgs, lats_wgs = gcj02_to_wgs84_array(lons_gcj, lats_gcj)

    # Enrich heatmap with compound centroid transit times (real API data, not interpolated)
    ct_path = get_data_path(COMPOUND_TRANSIT_CACHE_CSV)
    if ct_path.exists():
        ct_df = load_csv(ct_path)
        if not ct_df.empty and "centroid_lon" in ct_df.columns and "transit_time_minutes" in ct_df.columns:
            valid = ct_df[ct_df["transit_time_minutes"] < TRANSIT_NO_ROUTE_SENTINEL].copy()
            if not valid.empty:
                c_lons_gcj = np.asarray(valid["centroid_lon"], dtype=np.float64)
                c_lats_gcj = np.asarray(valid["centroid_lat"], dtype=np.float64)
                c_times = np.asarray(valid["transit_time_minutes"], dtype=np.float64)
                c_lons_wgs, c_lats_wgs = gcj02_to_wgs84_array(c_lons_gcj, c_lats_gcj)
                lats_wgs = np.concatenate([lats_wgs, c_lats_wgs])
                lons_wgs = np.concatenate([lons_wgs, c_lons_wgs])
                times = np.concatenate([times, c_times])
                logger.info("Added %d compound centroids to heatmap interpolation", len(valid))

    data_dir = get_data_path("")
    raster_dir = data_dir / "heatmap_rasters"
    south, west, north, east = _generate_heatmap_rasters(lats_wgs, lons_wgs, times, raster_dir)

    m = folium.Map(location=[center_lat, center_lon], zoom_start=12, tiles="OpenStreetMap", zoom_control=False)
    # Grayscale = same OSM tiles with CSS filter (real grayscale, not gray tiles)
    folium.TileLayer(
        tiles="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attr='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        name="OSM Grayscale",
        overlay=False,
        max_zoom=19,
        className="grayscale-tiles",
    ).add_to(m)

    folium.Marker(
        [center_lat, center_lon],
        popup=scut_label,
        tooltip=scut_label,
        icon=folium.Icon(color="red", icon="info-sign"),
    ).add_to(m)

    # Raster overlay (default: show all). Full path so Folium finds file at build time.
    default_raster_path = str((raster_dir / "heatmap_t120.png").resolve())
    overlay = folium.raster_layers.ImageOverlay(
        image=default_raster_path,
        bounds=[[south, west], [north, east]],
        opacity=0.6,
        name="Travel time",
        z_index=1,
    )
    # Store layer name on options so JS can find it (Folium doesn't always pass name to L.imageOverlay)
    overlay.options["name"] = "Travel time"
    overlay.add_to(m)

    # Stops: build data in WGS84; add markers in Python (always visible), JS adds click handlers on load
    stops_data_embed = []
    path_stops_transit = get_data_path(STOPS_WITH_TRANSIT_CSV)
    path_deduped = get_data_path(STOPS_DEDUPED_CSV)
    deduped_df = load_csv(path_deduped) if path_deduped.exists() else pd.DataFrame()
    stops_layer = folium.FeatureGroup(name="Transit stops", show=True)
    if add_stops_layer and path_stops_transit.exists():
        stops_df = load_csv(path_stops_transit)
        if not stops_df.empty and "lat" in stops_df.columns and "lon" in stops_df.columns and "transit_time_minutes" in stops_df.columns:
            if not deduped_df.empty and "stop_id" in deduped_df.columns and "name" in deduped_df.columns and "type" in deduped_df.columns:
                merge_cols = ["stop_id", "name", "type"]
                if "lines" in deduped_df.columns:
                    merge_cols.append("lines")
                stops_df = stops_df.merge(
                    deduped_df[merge_cols].drop_duplicates("stop_id"),
                    on="stop_id",
                    how="left",
                )
            lons_s = np.asarray(stops_df["lon"], dtype=np.float64)
            lats_s = np.asarray(stops_df["lat"], dtype=np.float64)
            lons_sw, lats_sw = gcj02_to_wgs84_array(lons_s, lats_s)
            times_s = np.asarray(stops_df["transit_time_minutes"], dtype=np.float64)
            for i in range(len(stops_df)):
                t = float(times_s[i])
                color = time_to_hex(t)
                name = str(stops_df["name"].iloc[i]) if "name" in stops_df.columns else ""
                stop_type = "bus"
                if "type" in stops_df.columns:
                    tval = str(stops_df["type"].iloc[i]).strip().lower()
                    if tval in ("bus", "metro"):
                        stop_type = tval
                lines_val = stops_df["lines"].iloc[i] if "lines" in stops_df.columns else ""
                lines = "" if pd.isna(lines_val) else str(lines_val).strip()
                stops_data_embed.append({
                    "lat": float(lats_sw[i]), "lon": float(lons_sw[i]), "t": t,
                    "color": color, "name": name, "type": stop_type, "lines": lines,
                })
                icon = folium.DivIcon(
                    icon_size=(14, 14),
                    icon_anchor=(7, 7),
                    html=(
                        f'<div style="width:14px;height:14px;border-radius:50%;'
                        f'background:{color};border:1px solid {color};display:flex;align-items:center;justify-content:center;">'
                        f'<div style="width:4px;height:4px;border-radius:50%;background:white;"></div></div>'
                    ),
                )
                folium.Marker(
                    [float(lats_sw[i]), float(lons_sw[i])],
                    icon=icon,
                    popup=None,
                ).add_to(stops_layer)
    stops_layer.add_to(m)

    # Guangzhou metro lines overlay: fetch from OSM Overpass if missing, then load
    try:
        from data_collection.metro_overpass import fetch_guangzhou_metro_geojson
        fetch_guangzhou_metro_geojson(force=False)
    except Exception as e:
        logger.debug("Metro fetch skipped: %s", e)
    path_metro = get_data_path(GUANGZHOU_METRO_GEOJSON)
    if path_metro.exists():
        metro_data = load_json(path_metro)
        if metro_data and metro_data.get("features"):
            def _metro_style(feature):
                color = feature.get("properties", {}).get("color", "#666666")
                return {"color": color, "weight": 1, "opacity": 0.85}
            folium.GeoJson(
                metro_data,
                name="Guangzhou Metro",
                style_function=_metro_style,
                overlay=True,
            ).add_to(m)

    # Residential compounds overlay (GCJ-02 polygons converted to WGS-84, colored by transit time)
    path_compounds = get_data_path(GUANGZHOU_COMPOUNDS_GEOJSON)
    enrich_lookup = load_json(get_data_path("enrich_cache.json")) or {}
    compound_transit_lookup = {}
    path_ctransit = get_data_path(COMPOUND_TRANSIT_CACHE_CSV)
    if path_ctransit.exists():
        ct_df = load_csv(path_ctransit)
        if not ct_df.empty and "poi_id" in ct_df.columns:
            for _, row in ct_df.iterrows():
                t = float(row.get("transit_time_minutes", TRANSIT_NO_ROUTE_SENTINEL))
                compound_transit_lookup[str(row["poi_id"])] = {
                    "t": t,
                    "color": time_to_hex(t) if t < TRANSIT_NO_ROUTE_SENTINEL else "#888888",
                    "breakdown": str(row.get("breakdown", "")),
                    "transfers": int(row.get("num_transfers", 0)) if pd.notna(row.get("num_transfers")) else 0,
                }
    if path_compounds.exists():
        compounds_data = load_json(path_compounds)
        if compounds_data and compounds_data.get("features"):
            for feat in compounds_data["features"]:
                geom = feat.get("geometry") or {}
                if geom.get("type") == "Polygon" and geom.get("coordinates"):
                    new_rings = []
                    for ring in geom["coordinates"]:
                        new_ring = []
                        for lon_gcj, lat_gcj in ring:
                            lon_w, lat_w = gcj02_to_wgs84(lon_gcj, lat_gcj)
                            new_ring.append([lon_w, lat_w])
                        new_rings.append(new_ring)
                    feat["geometry"]["coordinates"] = new_rings
                props = feat.get("properties") or {}
                poi_id = str(props.get("poi_id", ""))
                ct = compound_transit_lookup.get(poi_id)
                enrich = enrich_lookup.get(poi_id, {})
                enrich_reviews = ((enrich.get("reviews") or {}).get("reviews") or [])
                if ct:
                    props["transit_time"] = ct["t"]
                    props["transit_color"] = ct["color"]
                    props["breakdown"] = ct["breakdown"]
                    props["transfers"] = ct["transfers"]
                else:
                    props["transit_time"] = -1
                    props["transit_color"] = "#888888"
                    props["breakdown"] = ""
                    props["transfers"] = -1
                # Convert centroid GCJ-02 → WGS-84 for JS marker
                c_lon = float(props.get("centroid_lon", 0))
                c_lat = float(props.get("centroid_lat", 0))
                if c_lon and c_lat:
                    c_lon_w, c_lat_w = gcj02_to_wgs84(c_lon, c_lat)
                    props["centroid_lon_wgs"] = c_lon_w
                    props["centroid_lat_wgs"] = c_lat_w
                cleaned_reviews = []
                scored_reviews = []
                for review in enrich_reviews:
                    score = float(review.get("score", 0) or 0)
                    if score >= 1:
                        scored_reviews.append(score)
                    cleaned_reviews.append(
                        {
                            "author": str(review.get("author", "")),
                            "review": str(review.get("review", "")),
                            "score": score,
                            "time": str(review.get("time", "")),
                            "pics": [_normalize_media_url(p) for p in (review.get("pics") or []) if p],
                        }
                    )
                props["cover_url"] = _normalize_media_url(enrich.get("cover_url", ""))
                props["reviews"] = cleaned_reviews
                props["review_count"] = len(cleaned_reviews)
                props["rating_count"] = len(scored_reviews)
                if scored_reviews:
                    rating_avg = round(sum(scored_reviews) / len(scored_reviews), 2)
                    props["rating_avg"] = rating_avg
                    props["rating_color"] = rating_to_hex(rating_avg)
                else:
                    props["rating_avg"] = 0.0
                    props["rating_color"] = "#ffffff"
                # English translations
                props["name_en"] = _to_pinyin(props.get("name", ""))
                district_cn = props.get("district", "")
                props["district_en"] = DISTRICT_EN.get(district_cn, _to_pinyin(district_cn))
            def _compound_style(feature):
                return {
                    "color": "#3388ff",
                    "weight": 1.5,
                    "fillColor": "#3388ff",
                    "fillOpacity": 0.45,
                    "opacity": 0.7,
                }
            compounds_gj = folium.GeoJson(
                compounds_data,
                name="Compounds",
                style_function=_compound_style,
                tooltip=folium.GeoJsonTooltip(
                    fields=["name", "district", "transit_time"],
                    aliases=["Name:", "District:", "Transit (min):"],
                    sticky=True,
                ),
                overlay=True,
                show=False,
            )
            compounds_gj.add_to(m)
            n_with_time = sum(1 for v in compound_transit_lookup.values() if v["t"] < TRANSIT_NO_ROUTE_SENTINEL)
            logger.info("Added %d compound polygons (%d with transit times)", len(compounds_data["features"]), n_with_time)

    # Anjuke rental listings: build community markers + external data file
    anjuke_comm_path = get_data_path("anjuke_communities.json")
    anjuke_listings_path = get_data_path("anjuke_listings_raw.jsonl")
    anjuke_communities = {}  # name -> community data with listings
    if anjuke_comm_path.exists() and anjuke_listings_path.exists():
        raw_comm = load_json(anjuke_comm_path) or {}
        name_to_comm = {}
        for _ckey, cobj in raw_comm.items():
            lat_gcj = float(cobj.get("lat", 0))
            lng_gcj = float(cobj.get("lng", 0))
            if not lat_gcj or not lng_gcj:
                continue
            lng_w, lat_w = gcj02_to_wgs84(lng_gcj, lat_gcj)
            cname = cobj.get("name", "")
            comm_entry = {
                "name": cname,
                "name_en": _to_pinyin(cname),
                "lat": lat_w,
                "lng": lng_w,
                "prop_num": cobj.get("prop_num", 0),
                "build_date": cobj.get("build_date", ""),
                "district": cobj.get("_district", ""),
                "district_en": DISTRICT_EN.get(cobj.get("_district", "") + "区", cobj.get("_district", "")),
                "block": cobj.get("_block_name", ""),
                "listings": [],
            }
            name_to_comm[cname] = comm_entry
        import itertools
        import re as _re
        _AJK_IMG_RE = _re.compile(r"/anjuke/([0-9a-f]{20,})/")

        def _ajk_img_hash(url):
            m = _AJK_IMG_RE.search(url or "")
            return m.group(1) if m else ""

        with open(anjuke_listings_path, "r", encoding="utf-8") as lf:
            for line in itertools.islice(lf, 200000):
                line = line.strip()
                if not line:
                    continue
                try:
                    listing = json.loads(line)
                except json.JSONDecodeError:
                    continue
                cname = listing.get("community_name", "")
                comm = name_to_comm.get(cname)
                if not comm:
                    continue
                img_hashes = [_ajk_img_hash(u) for u in (listing.get("prop_images") or [])[:6]]
                img_hashes = [h for h in img_hashes if h]
                comm["listings"].append({
                    "id": listing.get("id"),
                    "t": listing.get("title", ""),
                    "p": listing.get("price", 0),
                    "a": listing.get("area", ""),
                    "o": listing.get("orient", ""),
                    "f": listing.get("fitment", ""),
                    "r": listing.get("rent_type_name", ""),
                    "rh": listing.get("rhval", ""),
                    "mi": listing.get("metro_info", ""),
                    "fl": listing.get("floor_des", ""),
                    "ih": img_hashes,
                })
        anjuke_communities = {k: v for k, v in name_to_comm.items() if v["listings"]}
        # Write external JS data file
        anjuke_js_path = get_data_path("anjuke_data.js")
        comm_list = list(anjuke_communities.values())
        with open(anjuke_js_path, "w", encoding="utf-8") as jf:
            jf.write("window._anjukeData = ")
            json.dump(comm_list, jf, ensure_ascii=False, separators=(",", ":"))
            jf.write(";\n")
        logger.info("Wrote %d Anjuke communities (%d listings) to %s",
                     len(comm_list), sum(len(c["listings"]) for c in comm_list), anjuke_js_path)

    # Grid sample (WGS84) for hover travel-time estimate
    grid_hover = []
    step = GRID_HOVER_SAMPLE
    for i in range(0, len(lats_wgs), step):
        grid_hover.append([float(lats_wgs[i]), float(lons_wgs[i]), float(times[i])])
    grid_hover_json = json.dumps(grid_hover)

    # Embed stops with name/type/lines for panel and Apply filter
    stops_with_color = [
        {"lat": s["lat"], "lon": s["lon"], "t": s["t"], "color": s["color"], "name": s.get("name", ""), "type": s.get("type", "bus"), "lines": s.get("lines", "")}
        for s in stops_data_embed
    ]
    raster_rel = "heatmap_rasters/heatmap_t"
    stops_json = json.dumps(stops_with_color)
    raster_rel_json = json.dumps(raster_rel)
    map_js_name = m.get_name()
    # Single glass-style control panel on the left with stop info, travel-time slider,
    # overlay toggles, and hover estimate.
    slider_html = """
<style type="text/css">.grayscale-tiles img { filter: grayscale(100%); } .leaflet-interactive:focus { outline: none !important; } path.leaflet-interactive { outline: none !important; }</style>
<div id="control-panel" style="
     position: fixed;
     top: 0;
     left: 0;
     width: 25%;
     height: 100%;
     overflow-y: auto;
     overflow-x: hidden;
     z-index: 9999;
     padding: 22px 24px;
     box-sizing: border-box;
     background: rgba(15, 23, 42, 0.40);
     backdrop-filter: blur(18px);
     -webkit-backdrop-filter: blur(18px);
     border-right: 1px solid rgba(148, 163, 184, 0.4);
     color: #e5e7eb;
     font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
     font-size: 16px;
     display: flex;
     flex-direction: column;
     gap: 22px;
     transform: translateX(0);
     transition: transform 0.25s ease, opacity 0.25s ease;
">
  <button id="panel-toggle" style="
      position: absolute;
      top: 18px;
      right: 18px;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      border: 1px solid rgba(148,163,184,0.5);
      background: rgba(15,23,42,0.7);
      color: #e5e7eb;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
  " title="Collapse/expand panel">&lsaquo;</button>
  <div style="font-weight: 650; font-size: 20px; margin-bottom: 8px;">Details</div>
  <div id="stop-info-content" style="font-size: 15px; line-height: 1.8; color: #e5e7eb;">
    Click a stop or compound on the map.
  </div>
  <div style="border-top: 1px solid rgba(148,163,184,0.4); margin: 8px 0;"></div>
  <div>
    <div style="font-weight: 600; font-size: 16px; margin-bottom: 10px;">Max travel time (min)</div>
    <div style="display: flex; align-items: center; gap: 10px;">
      <input type="range" id="max-time" min="10" max="120" value="120" step="10" style="flex: 1; height: 8px;"
         oninput="var v=document.getElementById('max-time-value');if(v)v.textContent=this.value">
      <span id="max-time-value" style="min-width: 46px; text-align: right; font-size: 16px;">120</span>
    </div>
    <button id="apply-filter" style="
        margin-top: 10px;
        padding: 10px 18px;
        border-radius: 999px;
        border: none;
        background: linear-gradient(135deg, #22c55e, #16a34a);
        color: white;
        font-size: 15px;
        cursor: pointer;
    " onclick="if(window.guamapApply)window.guamapApply()">Apply</button>
  </div>
  <div style="border-top: 1px solid rgba(148,163,184,0.4); margin: 8px 0;"></div>
  <div>
    <div style="font-weight: 600; font-size: 16px; margin-bottom: 10px;">Overlay layers</div>
    <label style="display: block; margin-bottom: 6px; font-size: 15px;">
      <input type="checkbox" id="toggle-heatmap" checked> Heatmap
    </label>
    <label style="display: block; margin-bottom: 6px; font-size: 15px;">
      <input type="checkbox" id="toggle-stops" checked> Stops
    </label>
    <label style="display: block; margin-bottom: 6px; font-size: 15px;">
      <input type="checkbox" id="toggle-metro" checked> Metro
    </label>
    <label style="display: block; margin-bottom: 4px; font-size: 15px;">
      <input type="checkbox" id="toggle-compounds"> Compounds
    </label>
    <div id="compounds-options" style="display: none; margin-left: 22px; margin-bottom: 6px; padding: 6px 0; font-size: 13px; color: #cbd5e1;">
      <label style="display: block; margin-bottom: 4px;">
        <input type="checkbox" id="compound-color-transit"> Color by transit time
      </label>
      <label style="display: block; margin-bottom: 4px;">
        <input type="checkbox" id="compound-color-rating"> Color by ratings
      </label>
      <div id="compound-rating-filter" style="display: none; margin-left: 22px; margin-top: 8px;">
        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">Rating filter</div>
        <select id="compound-rating-filter-select" style="width: 100%; max-width: 180px; padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.35); background: rgba(15,23,42,0.45); color: #e5e7eb;">
          <option value="all">Show all compounds</option>
          <option value="any">Any ratings</option>
          <option value="1">1★ compounds</option>
          <option value="2">2★ compounds</option>
          <option value="3">3★ compounds</option>
          <option value="4">4★ compounds</option>
          <option value="5">5★ compounds</option>
        </select>
      </div>
    </div>
    <label style="display: block; margin-bottom: 6px; font-size: 15px;">
      <input type="checkbox" id="toggle-anjuke"> Anjuke Listings
    </label>
    <div id="anjuke-options" style="display: none; margin-left: 22px; margin-bottom: 6px; padding: 6px 0; font-size: 13px; color: #cbd5e1;">
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        <select id="anjuke-filter-rent" style="padding:5px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.45);color:#e5e7eb;font-size:12px;">
          <option value="all">All types</option>
          <option value="整租">Whole (整租)</option>
          <option value="合租">Shared (合租)</option>
        </select>
        <select id="anjuke-sort" style="padding:5px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.45);color:#e5e7eb;font-size:12px;">
          <option value="price-asc">Price ↑</option>
          <option value="price-desc">Price ↓</option>
          <option value="area-desc">Area ↓</option>
          <option value="area-asc">Area ↑</option>
        </select>
        <input id="anjuke-filter-maxprice" type="number" placeholder="Max ¥" style="width:80px;padding:5px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.45);color:#e5e7eb;font-size:12px;">
      </div>
    </div>
    <label style="display: block; margin-top: 8px; font-size: 15px;">
      <input type="checkbox" id="toggle-base-gray"> Grayscale base
    </label>
  </div>
  <div style="border-top: 1px solid rgba(148,163,184,0.4); margin: 8px 0;"></div>
  <div>
    <div style="font-weight: 600; font-size: 16px; margin-bottom: 8px;">Hover estimate</div>
    <div id="hover-time-label" style="font-size: 15px; color: #cbd5f5;">
      Hover over the map to see estimated travel time.
    </div>
  </div>
</div>
""".replace("__STOPS_JSON__", stops_json).replace("__GRID_JSON__", grid_hover_json).replace("__RASTER_REL_JSON__", raster_rel_json).replace("__MAP_JS_NAME__", json.dumps(map_js_name))
    m.get_root().html.add_child(folium.Element(slider_html))

    out_path = get_data_path(COMMUTE_HEATMAP_HTML)
    m.save(str(out_path))

    # Post-process: (1) inject window[mapName]=map, (2) append our script AFTER Folium so map exists
    import re
    with open(out_path, "r", encoding="utf-8") as f:
        html = f.read()
    # 1. Insert "window[mapName]=mapName;" right after "var map_xxx = L.map(...);"
    pattern = re.compile(
        r"(var " + re.escape(map_js_name) + r" = L\.map\([^;]+\);)\s*\n",
        re.DOTALL,
    )
    repl = (
        r"\1\n            window["
        + json.dumps(map_js_name)
        + r"] = "
        + map_js_name
        + r";\n"
    )
    html = pattern.sub(repl, html, count=1)
    # 2. Extract Folium-generated GeoJSON variable names (metro first, compounds second)
    gj_vars = re.findall(r"var (geo_json_\w+) = L\.geoJson\(", html)
    metro_js_var = gj_vars[0] if len(gj_vars) > 0 else ""
    compounds_js_var = gj_vars[1] if len(gj_vars) > 1 else ""
    # 3. Append our script before </html> so it runs AFTER Folium (map guaranteed to exist)
    guamap_script = _build_guamap_script(
        stops_json, grid_hover_json, raster_rel_json, map_js_name,
        metro_js_var=metro_js_var, compounds_js_var=compounds_js_var,
    )
    # 4. Add Anjuke external data script before our main script
    anjuke_script_tag = '<script src="anjuke_data.js" charset="utf-8"></script>\n' if get_data_path("anjuke_data.js").exists() else ""
    html = html.replace("</html>", anjuke_script_tag + guamap_script + "\n</html>")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    logger.info("Saved map to %s", out_path)
    return out_path
