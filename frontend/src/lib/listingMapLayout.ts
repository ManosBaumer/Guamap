import { communityMatchesBuildYear } from './listingFilters'
import { communityPassesMapFilters, type MapLocationFilterOpts } from './mapQuery'
import { orderedSavedSnapshotsMatchingFilters } from './panelListings'
import type { Community, Filters, SavedListingSnapshot, SortMode } from './types'

const M_PER_DEG_LAT = 111_320

/**
 * Spread multiple listing pins around a community center (meters-scale offsets)
 * so markers stay clickable when they share one compound.
 */
export function offsetsForListingIds(
  listingIdsSorted: number[],
  baseLat: number,
  baseLng: number,
): Map<number, { lat: number; lng: number }> {
  const n = listingIdsSorted.length
  const out = new Map<number, { lat: number; lng: number }>()
  const latRad = (baseLat * Math.PI) / 180
  const mPerDegLng = M_PER_DEG_LAT * Math.max(0.25, Math.cos(latRad))

  for (let i = 0; i < n; i++) {
    const id = listingIdsSorted[i]!
    if (n === 1) {
      out.set(id, { lat: baseLat, lng: baseLng })
      continue
    }
    const angle = (2 * Math.PI * i) / n
    const rM = 14 + (i % 5) * 10
    const dxM = rM * Math.cos(angle)
    const dyM = rM * Math.sin(angle)
    out.set(id, {
      lat: baseLat + dyM / M_PER_DEG_LAT,
      lng: baseLng + dxM / mPerDegLng,
    })
  }
  return out
}

function communityEligibleOnMap(
  comm: Community,
  mapFilterOpts: MapLocationFilterOpts,
  appliedFilters: Filters,
): boolean {
  return (
    communityPassesMapFilters(comm, mapFilterOpts) &&
    communityMatchesBuildYear(comm, appliedFilters)
  )
}

/** Lat/lng for each saved listing (after filters), grouped by community with small offsets. */
export function savedListingPositions(
  snapshots: SavedListingSnapshot[],
  communities: Community[],
  mapFilterOpts: MapLocationFilterOpts,
  appliedFilters: Filters,
  sort: SortMode,
): Map<number, { lat: number; lng: number }> {
  const ordered = orderedSavedSnapshotsMatchingFilters(snapshots, appliedFilters, sort)
  const byComm = new Map<string, SavedListingSnapshot[]>()
  for (const s of ordered) {
    const list = byComm.get(s.communityId) ?? []
    list.push(s)
    byComm.set(s.communityId, list)
  }

  const commById = new Map(communities.map((c) => [c.id, c]))
  const positions = new Map<number, { lat: number; lng: number }>()

  for (const [commId, group] of byComm) {
    const comm = commById.get(commId)
    if (!comm || !communityEligibleOnMap(comm, mapFilterOpts, appliedFilters)) continue
    const ids = [...new Set(group.map((g) => g.listing.id))].sort((a, b) => a - b)
    const offs = offsetsForListingIds(ids, comm.lat, comm.lng)
    for (const id of ids) {
      const p = offs.get(id)
      if (p) positions.set(id, p)
    }
  }

  return positions
}

export function resolveListingMapPosition(args: {
  listingId: number
  savedMapViewActive: boolean
  savedListings: SavedListingSnapshot[]
  communities: Community[]
  mapFilterOpts: MapLocationFilterOpts
  appliedFilters: Filters
  sort: SortMode
  selectedCommunity: Community | null
  panelListingIdsInOrder: number[]
}): { lat: number; lng: number } | null {
  const {
    listingId,
    savedMapViewActive,
    savedListings,
    communities,
    mapFilterOpts,
    appliedFilters,
    sort,
    selectedCommunity,
    panelListingIdsInOrder,
  } = args

  if (savedMapViewActive) {
    const map = savedListingPositions(
      savedListings,
      communities,
      mapFilterOpts,
      appliedFilters,
      sort,
    )
    return map.get(listingId) ?? null
  }

  if (!selectedCommunity) return null
  if (!communityEligibleOnMap(selectedCommunity, mapFilterOpts, appliedFilters)) {
    return null
  }

  const ids =
    panelListingIdsInOrder.length > 0
      ? [...panelListingIdsInOrder]
      : [listingId]
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  const offs = offsetsForListingIds(sorted, selectedCommunity.lat, selectedCommunity.lng)
  return offs.get(listingId) ?? { lat: selectedCommunity.lat, lng: selectedCommunity.lng }
}
