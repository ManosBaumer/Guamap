import { isListingOffMarket } from './listingFilters'
import { listingIdNumber } from './listingIds'
import type { Listing } from './types'

const PENDING_SHARE_LINK_KEY = 'guamap-pending-share-link'

export const LISTING_SHARE_PARAM = 'listing'
export const COMMUNITY_SHARE_PARAM = 'community'
/** Base64url snapshot — used for sold / delisted listings so the link survives data refreshes. */
export const SNAPSHOT_SHARE_PARAM = 's'

export type ListingShareSnapshot = {
  listing: Listing
  communityId: string
  communityName: string
}

export type ParsedListingShareLink = {
  listingId: number
  communityId: string
  snapshot: ListingShareSnapshot | null
}

export type PendingShareLink =
  | { kind: 'listing'; link: ParsedListingShareLink }
  | { kind: 'community'; communityId: string }

export function buildCommunityShareUrl(communityId: string): string {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set(COMMUNITY_SHARE_PARAM, communityId)
  return url.toString()
}

export function buildListingShareUrl(args: {
  listing: Listing
  communityId: string
  communityName: string
}): string {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set(LISTING_SHARE_PARAM, String(listingIdNumber(args.listing.id) ?? args.listing.id))
  url.searchParams.set(COMMUNITY_SHARE_PARAM, args.communityId)
  if (isListingOffMarket(args.listing)) {
    url.searchParams.set(
      SNAPSHOT_SHARE_PARAM,
      encodeListingShareSnapshot({
        listing: args.listing,
        communityId: args.communityId,
        communityName: args.communityName,
      }),
    )
  }
  return url.toString()
}

/** Read share params from the URL and persist until consumed (survives StrictMode + early URL strip). */
export function readPendingShareLink(): PendingShareLink | null {
  const fromUrl = parseShareLinkFromSearch(window.location.search)
  if (fromUrl) {
    try {
      sessionStorage.setItem(PENDING_SHARE_LINK_KEY, JSON.stringify(fromUrl))
    } catch {
      // private browsing / quota — still return for this attempt
    }
    return fromUrl
  }
  try {
    const raw = sessionStorage.getItem(PENDING_SHARE_LINK_KEY)
    if (!raw) return null
    return parseStoredPendingShare(raw)
  } catch {
    return null
  }
}

function parseStoredPendingShare(raw: string): PendingShareLink | null {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (obj.kind === 'community' && typeof obj.communityId === 'string') {
    return { kind: 'community', communityId: obj.communityId }
  }
  if (obj.kind === 'listing' && obj.link && typeof obj.link === 'object') {
    const link = obj.link as ParsedListingShareLink
    if (link.communityId && Number.isFinite(link.listingId)) {
      return { kind: 'listing', link }
    }
  }
  // Legacy: bare listing share object
  const legacy = parsed as ParsedListingShareLink
  if (legacy.communityId && Number.isFinite(legacy.listingId)) {
    return { kind: 'listing', link: legacy }
  }
  return null
}

export function parseShareLinkFromSearch(search: string): PendingShareLink | null {
  const listing = parseListingShareLink(search)
  if (listing) return { kind: 'listing', link: listing }
  const communityId = parseCommunityShareLink(search)
  if (communityId) return { kind: 'community', communityId }
  return null
}

export function parseCommunityShareLink(search: string): string | null {
  const params = new URLSearchParams(search)
  const communityId = params.get(COMMUNITY_SHARE_PARAM)?.trim()
  if (!communityId) return null
  if (params.get(LISTING_SHARE_PARAM)) return null
  if (params.get(SNAPSHOT_SHARE_PARAM)) return null
  return communityId
}

export function clearPendingShareLink(): void {
  try {
    sessionStorage.removeItem(PENDING_SHARE_LINK_KEY)
  } catch {
    /* ignore */
  }
  stripListingShareParamsFromUrl()
}

export function parseListingShareLink(search: string): ParsedListingShareLink | null {
  const params = new URLSearchParams(search)
  const listingRaw = params.get(LISTING_SHARE_PARAM)
  const communityId = params.get(COMMUNITY_SHARE_PARAM)?.trim()
  if (!listingRaw || !communityId) return null
  const listingId = Number(listingRaw)
  if (!Number.isFinite(listingId)) return null
  const snapshotRaw = params.get(SNAPSHOT_SHARE_PARAM)
  const snapshot = snapshotRaw ? decodeListingShareSnapshot(snapshotRaw) : null
  return { listingId, communityId, snapshot }
}

export function hasShareLink(search: string): boolean {
  return parseShareLinkFromSearch(search) !== null
}

/** @deprecated Use hasShareLink */
export function hasListingShareLink(search: string): boolean {
  return hasShareLink(search)
}

export function stripListingShareParamsFromUrl(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(LISTING_SHARE_PARAM)
  url.searchParams.delete(COMMUNITY_SHARE_PARAM)
  url.searchParams.delete(SNAPSHOT_SHARE_PARAM)
  const next = url.pathname + url.search + url.hash
  window.history.replaceState({}, '', next || url.pathname)
}

export function encodeListingShareSnapshot(snapshot: ListingShareSnapshot): string {
  const json = JSON.stringify({
    l: snapshot.listing,
    c: snapshot.communityId,
    n: snapshot.communityName,
  })
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function decodeListingShareSnapshot(encoded: string): ListingShareSnapshot | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(escape(atob(b64)))
    const raw = JSON.parse(json) as { l?: Listing; c?: string; n?: string }
    if (!raw?.l || listingIdNumber(raw.l.id) == null || !raw.c) return null
    const listing = raw.l
    const id = listingIdNumber(listing.id)
    return {
      listing: id != null && listing.id !== id ? { ...listing, id } : listing,
      communityId: raw.c,
      communityName: typeof raw.n === 'string' ? raw.n : '',
    }
  } catch {
    return null
  }
}

export async function copyOrShareUrl(url: string, title: string): Promise<'shared' | 'copied'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: title.replace(/【已下架】/g, '').trim(), url })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}
