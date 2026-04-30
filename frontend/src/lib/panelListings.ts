import { listingMatchesFilters } from './listingFilters'
import type { Filters, Listing, SortMode, SavedListingSnapshot } from './types'

export function filterAndSortListings(
  listings: Listing[],
  filters: Filters,
  sort: SortMode,
): Listing[] {
  let result = listings.filter((l) => listingMatchesFilters(l, filters))

  result.sort((a, b) => {
    if (sort === 'price-asc') return a.price - b.price
    if (sort === 'price-desc') return b.price - a.price
    if (sort === 'area-desc') return parseFloat(b.area || '0') - parseFloat(a.area || '0')
    if (sort === 'area-asc') return parseFloat(a.area || '0') - parseFloat(b.area || '0')
    return 0
  })

  return result
}

/** Saved snapshots in the same order as filtered/sorted listings (for panel + map). */
export function orderedSavedSnapshotsMatchingFilters(
  snapshots: SavedListingSnapshot[],
  filters: Filters,
  sort: SortMode,
): SavedListingSnapshot[] {
  const byId = new Map(snapshots.map((s) => [s.listing.id, s]))
  const ordered = filterAndSortListings(
    snapshots.map((s) => s.listing),
    filters,
    sort,
  )
  return ordered.map((l) => byId.get(l.id)!).filter(Boolean) as SavedListingSnapshot[]
}
