/**
 * WGS84 ↔ GCJ-02 (China) helpers for aligning Tencent/GCJ vector data with WGS84 basemaps.
 */

import type L from 'leaflet'

function transformLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * Math.PI)) + (20 * Math.sin(2 * x * Math.PI))) * 2 / 3
  r += ((20 * Math.sin(y * Math.PI)) + (40 * Math.sin(y / 3 * Math.PI))) * 2 / 3
  r += ((160 * Math.sin(y / 12 * Math.PI)) + (320 * Math.sin(y * Math.PI / 30))) * 2 / 3
  return r
}

function transformLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * Math.PI)) + (20 * Math.sin(2 * x * Math.PI))) * 2 / 3
  r += ((20 * Math.sin(x * Math.PI)) + (40 * Math.sin(x / 3 * Math.PI))) * 2 / 3
  r += ((150 * Math.sin(x / 12 * Math.PI)) + (300 * Math.sin(x / 30 * Math.PI))) * 2 / 3
  return r
}

export function wgs84ToGcj02(lat: number, lng: number) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lat, lng }
  const a = 6378245.0
  const ee = 0.006693421622965943
  const dLat = transformLat(lng - 105.0, lat - 35.0)
  const dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = lat / 180.0 * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const mLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI)
  const mLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI)
  return { lat: lat + mLat, lng: lng + mLng }
}

/**
 * Inverse of {@link wgs84ToGcj02}. Tencent streetview index / API plane coords are GCJ-02; OSM / Leaflet
 * clicks are WGS84 — convert pano positions to WGS for basemap markers, and clicks to GCJ for index lookup.
 */
export function gcj02ToWgs84(lat: number, lng: number) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lat, lng }
  let wgsLat = lat
  let wgsLng = lng
  for (let i = 0; i < 12; i++) {
    const ml = wgs84ToGcj02(wgsLat, wgsLng)
    const dLat = lat - ml.lat
    const dLng = lng - ml.lng
    wgsLat += dLat
    wgsLng += dLng
    if (Math.abs(dLat) < 1e-7 && Math.abs(dLng) < 1e-7) break
  }
  return { lat: wgsLat, lng: wgsLng }
}

/**
 * Pixel delta between “true WGS position” and “GCJ coords plotted as WGS” for one anchor point,
 * in the map’s current CRS. Use a **stable** anchor (e.g. current pano) on small maps so wheel-zoom
 * (which moves `getCenter()`) doesn’t recompute a new shift every step and make overlays swim.
 */
export function gcjBasemapShiftLayerPixelsAt(map: L.Map, lat: number, lng: number) {
  const gcj = wgs84ToGcj02(lat, lng)
  const pWgs = map.latLngToLayerPoint([lat, lng])
  const pGcj = map.latLngToLayerPoint([gcj.lat, gcj.lng])
  return { dx: pWgs.x - pGcj.x, dy: pWgs.y - pGcj.y }
}

/** Leaflet map: pixel delta at the current viewport center (main map use). */
export function gcjBasemapShiftLayerPixels(map: L.Map) {
  const c = map.getCenter()
  return gcjBasemapShiftLayerPixelsAt(map, c.lat, c.lng)
}

/**
 * Half the gutter needed on each side of an oversized Leaflet root so pane translate(dx,dy)
 * never clips. Shift scales with zoom; a fixed 300px pad fails at z18+ in China.
 */
export function recommendedGcjOverscanPadPx(map: L.Map, opts?: { slack?: number; minPad?: number; maxPad?: number }) {
  const slack = opts?.slack ?? 160
  const minPad = opts?.minPad ?? 260
  const maxPad = opts?.maxPad ?? 1100
  const { dx, dy } = gcjBasemapShiftLayerPixels(map)
  const shift = Math.max(Math.abs(dx), Math.abs(dy))
  return Math.min(maxPad, Math.max(minPad, Math.ceil(shift + slack)))
}
