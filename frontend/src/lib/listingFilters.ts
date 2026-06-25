import type { Community, Filters, Listing, ListingMetadata } from './types'
import { metroTokensFromRaw } from './metroFilterOptions'

/** First 4-digit year in strings like "2016年" or "2021-03年". */
export function parseBuildYear(buildDate: string): number | null {
  if (!buildDate || typeof buildDate !== 'string') return null
  const m = buildDate.match(/(\d{4})/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  return y >= 1800 && y <= 2100 ? y : null
}

/** Community-level filter: building completion year from `buildDate`. */
export function communityMatchesBuildYear(c: Community, filters: Filters): boolean {
  if (filters.minBuildYear === null && filters.maxBuildYear === null) return true
  const y = parseBuildYear(c.buildDate)
  if (y === null) return false
  if (filters.minBuildYear !== null && y < filters.minBuildYear) return false
  if (filters.maxBuildYear !== null && y > filters.maxBuildYear) return false
  return true
}

/** Listing-level filters only (fetch listings + match counts when active). */
export function listingFiltersAreActive(filters: Filters): boolean {
  return !!(
    filters.orient.length > 0 ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.minArea !== null ||
    filters.maxArea !== null ||
    filters.rooms ||
    filters.bathrooms ||
    filters.metro.length > 0 ||
    filters.rentType ||
    filters.amenities.length > 0
  )
}

/** Any search filter, including community build year. */
export function filtersAreActive(filters: Filters): boolean {
  return !!(
    listingFiltersAreActive(filters) ||
    filters.minBuildYear !== null ||
    filters.maxBuildYear !== null
  )
}

/** Anjuke delisted listings are tagged in the title. */
export const OFF_MARKET_TAG = '【已下架】'

export function tagOffMarketTitle(title: string): string {
  const trimmed = (title || '').trim()
  if (trimmed.includes(OFF_MARKET_TAG)) return trimmed
  return trimmed ? `${OFF_MARKET_TAG}${trimmed}` : OFF_MARKET_TAG
}

export function isListingOffMarket(listing: Listing): boolean {
  return listing.title.includes(OFF_MARKET_TAG)
}

/** Same rules as ListingPanel filterAndSort (filter stage only). */
export function listingMatchesFilters(l: Listing, filters: Filters): boolean {
  if (filters.orient.length > 0 && !filters.orient.includes(l.orient)) return false
  if (filters.minPrice !== null && l.price < filters.minPrice) return false
  if (filters.maxPrice !== null && l.price > filters.maxPrice) return false
  if (filters.rentType && l.rentType !== filters.rentType) return false
  if (filters.metro.length > 0) {
    const tokens = metroTokensFromRaw(l.metro)
    if (tokens.length === 0) return false
    const hit = filters.metro.some((line) => tokens.includes(line))
    if (!hit) return false
  }
  if (filters.rooms) {
    if (filters.rooms === '5+') {
      if (l.roomCount < 5) return false
    } else {
      if (l.roomCount !== Number(filters.rooms)) return false
    }
  }
  if (filters.bathrooms) {
    const bt = l.bathroomCount
    if (bt == null || typeof bt !== 'number') return false
    if (filters.bathrooms === '5+') {
      if (bt < 5) return false
    } else {
      if (bt !== Number(filters.bathrooms)) return false
    }
  }
  const area = parseFloat(l.area)
  if (filters.minArea !== null && (isNaN(area) || area < filters.minArea)) return false
  if (filters.maxArea !== null && (isNaN(area) || area > filters.maxArea)) return false
  if (filters.amenities.length > 0) {
    if (!l.amenities) return false
    if (!filters.amenities.every((a) => l.amenities!.includes(a))) return false
  }
  return true
}

export function countMatchingListings(listings: Listing[], filters: Filters): number {
  if (!filtersAreActive(filters)) return listings.length
  let n = 0
  for (const l of listings) {
    if (listingMatchesFilters(l, filters)) n++
  }
  return n
}

export function listingMetadataMatchesFilters(l: ListingMetadata, filters: Filters): boolean {
  if (filters.orient.length > 0 && !filters.orient.includes(l.o)) return false
  if (filters.minPrice !== null && l.p < filters.minPrice) return false
  if (filters.maxPrice !== null && l.p > filters.maxPrice) return false
  if (filters.rentType && l.rt !== filters.rentType) return false
  if (filters.metro.length > 0) {
    const tokens = metroTokensFromRaw(l.m)
    if (tokens.length === 0) return false
    const hit = filters.metro.some((line) => tokens.includes(line))
    if (!hit) return false
  }
  if (filters.rooms) {
    if (filters.rooms === '5+') {
      if (l.rc < 5) return false
    } else {
      if (l.rc !== Number(filters.rooms)) return false
    }
  }
  if (filters.bathrooms) {
    const bt = l.bc
    if (bt == null || typeof bt !== 'number') return false
    if (filters.bathrooms === '5+') {
      if (bt < 5) return false
    } else {
      if (bt !== Number(filters.bathrooms)) return false
    }
  }
  const area = parseFloat(l.a)
  if (filters.minArea !== null && (isNaN(area) || area < filters.minArea)) return false
  if (filters.maxArea !== null && (isNaN(area) || area > filters.maxArea)) return false
  if (filters.amenities.length > 0) {
    if (!l.am) return false
    if (!filters.amenities.every((a) => l.am.includes(a))) return false
  }
  return true
}
