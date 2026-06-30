import { useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'
import {
  clearPendingShareLink,
  readPendingShareLink,
} from '@/lib/listingShare'

/** Open a listing when the page loads with `?listing=&community=` share params. */
export default function SharedListingHydrate() {
  const communities = useStore((s) => s.communities)
  const openSharedListing = useStore((s) => s.openSharedListing)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    const link = readPendingShareLink()
    if (!link) return
    if (communities.length === 0) return

    startedRef.current = true

    void openSharedListing(link).then((ok) => {
      if (ok) {
        clearPendingShareLink()
      } else {
        startedRef.current = false
        console.warn('[guamap] Shared listing link could not be opened:', link)
      }
    })
  }, [communities.length, openSharedListing])

  return null
}
