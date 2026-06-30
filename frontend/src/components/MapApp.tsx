import FilterBar from '@/components/FilterBar'
import LayerControl from '@/components/LayerControl'
import MapView from '@/components/MapView'
import ListingPanel from '@/components/ListingPanel'
import ImageModal from '@/components/ImageModal'
import LoginModal from '@/components/LoginModal'
import SharedListingHydrate from '@/components/SharedListingHydrate'

export default function MapApp() {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <SharedListingHydrate />
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
