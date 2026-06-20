/** GCJ-02 ↔ WGS84 for Amap Web Service (server-side). */

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

export function gcj02ToWgs84(lat: number, lng: number) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lat, lng }
  let wgsLat = lat
  let wgsLng = lng
  for (let i = 0; i < 12; i++) {
    const ml = wgs84ToGcj02(wgsLat, wgsLng)
    wgsLat += lat - ml.lat
    wgsLng += lng - ml.lng
    if (Math.abs(lat - ml.lat) < 1e-7 && Math.abs(lng - ml.lng) < 1e-7) break
  }
  return { lat: wgsLat, lng: wgsLng }
}
