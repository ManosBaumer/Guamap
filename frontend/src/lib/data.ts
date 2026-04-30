import type { Community, Listing, ListingMetadata, Stop, HeatmapBounds, ScutLocation, StreetviewIndex, StreetviewProvider } from './types'

const BASE = import.meta.env.BASE_URL + 'data'

export async function loadCommunities(): Promise<Community[]> {
  const res = await fetch(`${BASE}/communities.json`)
  return res.json()
}

/** Match Anjuke layout text: N卫 → bathroom count (used if JSON has no bathroomCount). */
function parseBathroomCountFromListing(l: Listing): number | null {
  if (typeof l.bathroomCount === 'number') return l.bathroomCount
  const combined = `${l.rooms || ''} ${l.des || ''} ${l.title || ''}`
  const m = combined.match(/(\d+)\s*卫/)
  return m ? parseInt(m[1], 10) : null
}

function normalizeListing(l: Listing): Listing {
  const bathroomCount = parseBathroomCountFromListing(l)
  return bathroomCount === l.bathroomCount ? l : { ...l, bathroomCount }
}

const _listingsByCommunityId = new Map<string, Listing[]>()

/** Cached per community (normalized). Safe to call from many places. */
export async function loadListings(communityId: string): Promise<Listing[]> {
  const hit = _listingsByCommunityId.get(communityId)
  if (hit) return hit
  const res = await fetch(`${BASE}/listings/${communityId}.json`)
  if (!res.ok) {
    _listingsByCommunityId.set(communityId, [])
    return []
  }
  const raw: Listing[] = await res.json()
  const uniqueListings = new Map<number, Listing>()
  for (const l of raw) {
    if (!uniqueListings.has(l.id)) {
      uniqueListings.set(l.id, l)
    }
  }
  const data = Array.from(uniqueListings.values()).map(normalizeListing)
  _listingsByCommunityId.set(communityId, data)
  return data
}

let _metadataPromise: Promise<ListingMetadata[]> | null = null

/** Fetches global listing metadata (minimal fields for filtering). Cached once. */
export async function loadListingsMetadata(): Promise<ListingMetadata[]> {
  if (_metadataPromise) return _metadataPromise
  _metadataPromise = (async () => {
    const res = await fetch(`${BASE}/listings_metadata.json`)
    if (!res.ok) return []
    return res.json()
  })()
  return _metadataPromise
}

export async function loadStops(): Promise<Stop[]> {
  const res = await fetch(`${BASE}/stops.json`)
  if (!res.ok) return []
  return res.json()
}

export async function loadMetroGeoJSON(): Promise<GeoJSON.FeatureCollection | null> {
  const res = await fetch(`${BASE}/metro.geojson`)
  if (!res.ok) return null
  return res.json()
}

export async function loadCompoundsGeoJSON(): Promise<GeoJSON.FeatureCollection | null> {
  const res = await fetch(`${BASE}/compounds.geojson`)
  if (!res.ok) return null
  return res.json()
}

export async function loadStreetviewGeoJSON(provider: StreetviewProvider): Promise<GeoJSON.FeatureCollection | null> {
  const res = await fetch(`${BASE}/streetview_${provider}.geojson`)
  if (!res.ok) return null
  return res.json()
}

export async function loadStreetviewIndex(provider: StreetviewProvider): Promise<StreetviewIndex | null> {
  const res = await fetch(`${BASE}/streetview_${provider}_index.json`)
  if (!res.ok) return null
  return res.json()
}

export async function loadHeatmapBounds(): Promise<HeatmapBounds | null> {
  const res = await fetch(`${BASE}/heatmap_bounds.json`)
  if (!res.ok) return null
  return res.json()
}

export async function loadScutLocation(): Promise<ScutLocation | null> {
  const res = await fetch(`${BASE}/scut.json`)
  if (!res.ok) return null
  return res.json()
}

export async function loadGridHover(): Promise<number[][] | null> {
  const res = await fetch(`${BASE}/grid_hover.json`)
  if (!res.ok) return null
  return res.json()
}

export function ajkImgUrl(hash: string, size = '600x600'): string {
  if (!hash) return ''
  return `https://pic1.ajkimg.com/display/anjuke/${hash}/${size}.jpg?t=1&srotate=1`
}

export function ajkThumbUrl(hash: string): string {
  return ajkImgUrl(hash, '240x180c')
}

export function ajkListingUrl(id: number): string {
  return `https://gz.zu.anjuke.com/fangyuan/${id}`
}

export async function translateText(text: string): Promise<string> {
  try {
    const q = encodeURIComponent(text.substring(0, 1000))
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${q}`
    const res = await fetch(url)
    const data = await res.json()
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((p: string[]) => p[0] || '').join('')
    }
    return '(Translation unavailable)'
  } catch {
    return '(Translation unavailable)'
  }
}

export async function loadDistricts(): Promise<GeoJSON.FeatureCollection | null> {
  const res = await fetch(`${BASE}/districts.geojson`)
  if (!res.ok) return null
  return res.json()
}

export function pointInPolygon(lat: number, lng: number, polygon: number[][][]): boolean {
  for (const ring of polygon) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][1], yi = ring[i][0]
      const xj = ring[j][1], yj = ring[j][0]
      const intersect = ((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)
      if (intersect) inside = !inside
    }
    return inside
  }
  return false
}

export function heatmapRasterUrl(threshold: number): string {
  return `${BASE}/heatmap_rasters/heatmap_t${threshold}.png`
}
