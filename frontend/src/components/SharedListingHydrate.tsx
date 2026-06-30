import { useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'
import {
  clearPendingShareLink,
  readPendingShareLink,
} from '@/lib/listingShare'

/** Open a listing or community when the page loads with share query params. */
export default function SharedListingHydrate() {
  const communities = useStore((s) => s.communities)
  const openSharedListing = useStore((s) => s.openSharedListing)
  const openSharedCommunity = useStore((s) => s.openSharedCommunity)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    const pending = readPendingShareLink()
    if (!pending) return
    if (communities.length === 0) return

    startedRef.current = true

    const open =
      pending.kind === 'listing'
        ? openSharedListing(pending.link)
        : openSharedCommunity(pending.communityId)

    void open.then((ok) => {
      if (ok) {
        clearPendingShareLink()
      } else {
        startedRef.current = false
        console.warn('[guamap] Shared link could not be opened:', pending)
      }
    })
  }, [communities.length, openSharedListing, openSharedCommunity])

  return null
}
