export interface TransitSegment {
  type: 'transit' | 'walking'
  dur: number
  line?: string
  from?: string
  to?: string
  stops?: string
  dist?: number
}

export interface Community {
  id: string
  name: string
  nameEn: string
  lat: number
  lng: number
  buildDate: string
  district: string
  districtEn: string
  block: string
  listingCount: number
  priceMin: number
  priceMax: number
  transitMin: number
  transitCost: number
  transitSegments: TransitSegment[]
  /** Real Anjuke community view ID (from scrape_community_ids.py). */
  anjukeId?: string
}

export interface Listing {
  id: number
  title: string
  price: number
  area: string
  orient: string
  rentType: string
  rooms: string
  /** Bedroom count (from 室 in layout string). */
  roomCount: number
  /** Bathroom count (卫) when parseable from layout/description; omit or null if unknown. */
  bathroomCount?: number | null
  des: string
  metro: string
  floor: string
  imgHashes: string[]
  amenities?: string[]
  _titleEn?: string
}

/** Persisted favorite — includes full listing so the panel can render ListingCard (images, meta). */
export interface SavedListingSnapshot {
  listing: Listing
  communityId: string
  communityName: string
  savedAt: string
}

export interface ListingMetadata {
  id: number
  c: string
  p: number
  a: string
  o: string
  rt: string
  rc: number
  bc: number | null | undefined
  m: string
  am: string[]
}

export interface Stop {
  lat: number
  lon: number
  name: string
  type: 'bus' | 'metro'
  /** Source row id from stops_raw (optional). */
  id?: string
  /** Present only when using transit-time stop set; used for max-transit filter on map. */
  t?: number
  lines?: string
}

export interface HeatmapBounds {
  south: number
  north: number
  west: number
  east: number
}

export interface ScutLocation {
  lat: number
  lon: number
  name: string
}

export interface StreetviewIndexEntry {
  id: string
  lat: number
  lng: number
  /** Heading (degrees). */
  h: number
  /** Capture date (optional). */
  d?: string
}

export interface StreetviewIndex {
  cellSize: number
  cells: Record<string, StreetviewIndexEntry[]>
}

export interface DistrictProperties {
  name: string
  nameEn: string
  adcode: string
}

export type LayerName = 'stops' | 'heatmap' | 'metro' | 'baseMap' | 'anjuke' | 'compounds' | 'streetview'

/** Shown when the Base map layer is on (default when enabling the layer: satellite). */
export type BaseMapStyle = 'satellite' | 'grayscale' | 'dark' | 'positron' | 'topo' | 'voyager'

export type CompoundColorMode = 'none' | 'transit' | 'ratings'

export type StreetviewProvider = 'tencent' | 'baidu'

export type SortMode = 'price-asc' | 'price-desc' | 'area-desc' | 'area-asc'

export interface Filters {
  /** Facings (OR): empty = any; values match listing `orient` (e.g. 朝南). */
  orient: string[]
  minPrice: number | null
  maxPrice: number | null
  minArea: number | null
  maxArea: number | null
  /** Community building year (from `buildDate`), not per-listing. */
  minBuildYear: number | null
  maxBuildYear: number | null
  /** Bedroom count filter: '', '1'…'4', '5+'. */
  rooms: string
  /** Bathroom count filter: '', '1'…'4', '5+'. */
  bathrooms: string
  /** Metro lines (OR): empty = any; tokens e.g. `3号线`, `广佛线` (see metroFilterOptions). */
  metro: string[]
  rentType: string
  amenities: string[]
}
