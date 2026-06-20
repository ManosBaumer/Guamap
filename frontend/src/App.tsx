import { useEffect } from 'react'
import MapApp from '@/components/MapApp'
import DevDashboard from '@/pages/DevDashboard'
import { usePathname } from '@/hooks/usePathname'
import { useStore } from '@/lib/store'
import { supabase } from '@/lib/supabase'

export default function App() {
  const pathname = usePathname()
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
        setSavedListings(
          data.map((row: {
            listing: unknown
            community_id: string
            community_name: string
            saved_at: string
          }) => ({
            listing: row.listing as Parameters<typeof setSavedListings>[0][number]['listing'],
            communityId: row.community_id,
            communityName: row.community_name,
            savedAt: row.saved_at,
          })),
        )
      }
    }

    return () => subscription.unsubscribe()
  }, [setSavedListings, setSavedMapViewActive, setUser])

  const isDevRoute = pathname === '/dev' || pathname === '/dev/'

  if (isDevRoute) {
    return <DevDashboard />
  }

  return <MapApp />
}
