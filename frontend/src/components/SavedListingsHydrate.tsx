import { useEffect } from 'react'
import { useStore } from '@/lib/store'
import { fetchSavedListingsFromFile } from '@/lib/savedListingsStorage'

/** Load favourites from `data/saved_listings.json` via Vite dev/preview API. */
export default function SavedListingsHydrate() {
  const setSavedListings = useStore((s) => s.setSavedListings)

  useEffect(() => {
    void fetchSavedListingsFromFile().then(setSavedListings)
  }, [setSavedListings])

  return null
}
