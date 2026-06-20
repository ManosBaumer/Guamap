import type { Listing } from './types'

/** Bedroom count for listing UI (icon + number). */
export function listingBedCount(listing: Listing): number | null {
  const br = listing.roomCount
  if (typeof br === 'number' && br > 0) return br
  const m = (listing.rooms || '').match(/(\d+)\s*室/)
  return m ? parseInt(m[1], 10) : null
}

/** Bathroom count for listing UI (icon + number). */
export function listingBathCount(listing: Listing): number | null {
  const bt = listing.bathroomCount
  if (typeof bt === 'number' && bt >= 0) return bt
  const combined = `${listing.rooms || ''} ${listing.des || ''} ${listing.title || ''}`
  const m = combined.match(/(\d+)\s*卫/)
  return m ? parseInt(m[1], 10) : null
}
