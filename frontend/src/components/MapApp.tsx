import FilterBar from '@/components/FilterBar'
import LayerControl from '@/components/LayerControl'
import MapView from '@/components/MapView'
import ListingPanel from '@/components/ListingPanel'
import ImageModal from '@/components/ImageModal'
import LoginModal from '@/components/LoginModal'
import SharedListingHydrate from '@/components/SharedListingHydrate'
import ShareSheet from '@/components/ShareSheet'
import { MAP_STAGE_ID } from '@/hooks/useTopChromeHeight'

export default function MapApp() {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <SharedListingHydrate />
      <LoginModal />
      <FilterBar />
      <div id={MAP_STAGE_ID} className="flex flex-1 min-h-0 relative">
        <LayerControl />
        <div className="flex flex-1 min-w-0 min-h-0 relative">
          <MapView />
          <ListingPanel />
        </div>
      </div>
      <ImageModal />
      <ShareSheet />
    </div>
  )
}
