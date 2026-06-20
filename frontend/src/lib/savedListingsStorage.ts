import type { Listing, SavedListingSnapshot } from './types'

/** Vite dev/preview middleware serves this path (see `vite.config.ts`). */
function savedListingsApiUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}api/saved-listings`
}

const KEY_V2 = 'guamap-saved-listings-v2'
const KEY_V1 = 'guamap-saved-listings-v1'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function coerceListing(v: unknown): Listing | null {
  if (!isRecord(v)) return null
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) return null
  if (typeof v.title !== 'string') return null
  if (typeof v.price !== 'number' || !Number.isFinite(v.price)) return null
  const area = typeof v.area === 'string' ? v.area : String(v.area ?? '')
  const hashesRaw = v.imgHashes
  const imgHashes =
    Array.isArray(hashesRaw) && hashesRaw.every((h) => typeof h === 'string')
      ? hashesRaw
      : []
  const roomCount =
    typeof v.roomCount === 'number' && Number.isFinite(v.roomCount) ? v.roomCount : 0
  return {
    id: v.id,
    title: v.title,
    price: v.price,
    area,
    orient: typeof v.orient === 'string' ? v.orient : '',
    rentType: typeof v.rentType === 'string' ? v.rentType : '',
    rooms: typeof v.rooms === 'string' ? v.rooms : '',
    roomCount,
    bathroomCount:
      typeof v.bathroomCount === 'number' && Number.isFinite(v.bathroomCount)
        ? v.bathroomCount
        : v.bathroomCount === null
          ? null
          : undefined,
    des: typeof v.des === 'string' ? v.des : '',
    metro: typeof v.metro === 'string' ? v.metro : '',
    floor: typeof v.floor === 'string' ? v.floor : '',
    imgHashes,
    amenities: Array.isArray(v.amenities) ? (v.amenities as string[]) : [],
    ...(typeof v._titleEn === 'string' ? { _titleEn: v._titleEn } : {}),
  }
}

function rowToSnapshot(row: unknown): SavedListingSnapshot | null {
  if (!isRecord(row)) return null
  if (typeof row.savedAt !== 'string') return null
  if (typeof row.communityId !== 'string') return null
  if (typeof row.communityName !== 'string') return null

  const coerced = coerceListing(row.listing)
  if (coerced) {
    return {
      listing: coerced,
      communityId: row.communityId,
      communityName: row.communityName,
      savedAt: row.savedAt,
    }
  }

  if (typeof row.id === 'number' && typeof row.title === 'string' && typeof row.price === 'number') {
    const listing: Listing = {
      id: row.id,
      title: row.title,
      price: row.price,
      area: typeof row.area === 'string' ? row.area : '',
      orient: '',
      rentType: '',
      rooms: '',
      roomCount: 0,
      des: '',
      metro: '',
      floor: '',
      imgHashes: [],
      amenities: [],
    }
    return {
      listing,
      communityId: row.communityId,
      communityName: row.communityName,
      savedAt: row.savedAt,
    }
  }

  return null
}

export function dedupeByListingId(list: SavedListingSnapshot[]): SavedListingSnapshot[] {
  const byId = new Map<number, SavedListingSnapshot>()
  for (const s of list) {
    byId.set(s.listing.id, s)
  }
  return [...byId.values()]
}

function parseSavedListingsPayload(raw: unknown): SavedListingSnapshot[] {
  if (!Array.isArray(raw)) return []
  const out = raw.map(rowToSnapshot).filter((x): x is SavedListingSnapshot => x !== null)
  return dedupeByListingId(out)
}

/** Read legacy browser storage (one-time migration to `data/saved_listings.json`). */
function readLegacyLocalStorage(): SavedListingSnapshot[] {
  if (typeof window === 'undefined') return []

  try {
    const rawV2 = localStorage.getItem(KEY_V2)
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as unknown
      return parseSavedListingsPayload(parsed)
    }

    const rawV1 = localStorage.getItem(KEY_V1)
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as unknown
      return parseSavedListingsPayload(parsed)
    }
  } catch {
    /* ignore */
  }
  return []
}

function clearLegacyLocalStorage(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(KEY_V2)
    localStorage.removeItem(KEY_V1)
  } catch {
    /* ignore */
  }
}

/**
 * Load favourites from disk via dev/preview server (`data/saved_listings.json`).
 * If the file is empty and legacy localStorage has data, migrates once then clears localStorage.
 */
export async function fetchSavedListingsFromFile(): Promise<SavedListingSnapshot[]> {
  try {
    const r = await fetch(savedListingsApiUrl(), { cache: 'no-store' })
    if (!r.ok) {
      console.warn('[guamap] Could not load saved listings from file:', r.status)
      return []
    }
    const raw = (await r.json()) as unknown
    let list = parseSavedListingsPayload(raw)

    if (list.length === 0) {
      const legacy = readLegacyLocalStorage()
      if (legacy.length > 0) {
        list = dedupeByListingId(legacy)
        await persistSavedListingsToFile(list)
        clearLegacyLocalStorage()
      }
    }

    return list
  } catch (e) {
    console.warn('[guamap] Saved listings file API unavailable (use npm run dev / vite preview):', e)
    return readLegacyLocalStorage()
  }
}

/** Persist favourites to `data/saved_listings.json` (dev/preview server only). */
export async function persistSavedListingsToFile(list: SavedListingSnapshot[]): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const r = await fetch(savedListingsApiUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(list),
    })
    if (!r.ok) {
      console.warn('[guamap] Could not save listings to file:', r.status)
    }
  } catch (e) {
    console.warn('[guamap] Saved listings write failed:', e)
  }
}
