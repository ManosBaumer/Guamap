import FilterBar from '@/components/FilterBar'
import LayerControl from '@/components/LayerControl'
import MapView from '@/components/MapView'
import ListingPanel from '@/components/ListingPanel'
import ImageModal from '@/components/ImageModal'
import LoginModal from '@/components/LoginModal'
import { useEffect } from 'react'
import { useStore } from '@/lib/store'
import { supabase } from '@/lib/supabase'

export default function App() {
  const setUser = useStore((s) => s.setUser)
  const setSavedListings = useStore((s) => s.setSavedListings)
  const setSavedMapViewActive = useStore((s) => s.setSavedMapViewActive)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchSaved(session.user.id)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchSaved(session.user.id)
      } else {
        setSavedListings([])
        setSavedMapViewActive(false)
      }
    })

    async function fetchSaved(userId: string) {
      const { data, error } = await supabase
        .from('saved_listings')
        .select('*')
        .eq('user_id', userId)
      
      if (!error && data) {
        setSavedListings(data.map((row: any) => ({
          listing: row.listing,
          communityId: row.community_id,
          communityName: row.community_name,
          savedAt: row.saved_at
        })))
      }
    }

    return () => subscription.unsubscribe()
  }, [])
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <LoginModal />
      <FilterBar />
      <div className="flex flex-1 min-h-0">
        <LayerControl />
        <MapView />
        <ListingPanel />
      </div>
      <ImageModal />
    </div>
  )
}
