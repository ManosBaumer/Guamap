import { Compass, TrainFront, Bed, Bath, Paintbrush, Languages, Home, Star, MapPin, Sparkles, ChevronDown } from 'lucide-react'
import { memo, useState } from 'react'
import { useStore } from '@/lib/store'
import { ajkImgUrl, ajkThumbUrl, ajkListingUrl, translateText } from '@/lib/data'
import type { Listing } from '@/lib/types'
import { listingBedCount, listingBathCount } from '@/lib/listingLayout'
import {
  orientLabelEn,
  rentTypeLabelEn,
  metroLinesDisplayEn,
  roomsLayoutDisplayEn,
} from '@/lib/listingDisplayEn'

const ALL_AMENITIES = [
  { slug: 'ac', label: 'AC' },
  { slug: 'fridge', label: 'Fridge' },
  { slug: 'washing_machine', label: 'Washer' },
  { slug: 'water_heater', label: 'Heater' },
  { slug: 'wifi', label: 'Wifi' },
  { slug: 'tv', label: 'TV' },
  { slug: 'sofa', label: 'Sofa' },
  { slug: 'wardrobe', label: 'Wardrobe' },
  { slug: 'bed', label: 'Bed' },
  { slug: 'cooking_ok', label: 'Cooking' },
  { slug: 'gas_stove', label: 'Gas stove' },
  { slug: 'range_hood', label: 'Hood' },
  { slug: 'bathroom', label: 'Bathroom' },
  { slug: 'balcony', label: 'Balcony' },
  { slug: 'smart_lock', label: 'Smart lock' },
  { slug: 'heating', label: 'Heating' },
]

function ListingCard({
  listing,
  communityId,
  communityName,
}: {
  listing: Listing
  communityId: string
  communityName: string
}) {
  const openModal = useStore((s) => s.openModal)
  const toggleSavedListing = useStore((s) => s.toggleSavedListing)
  const flyToListingOnMap = useStore((s) => s.flyToListingOnMap)
  const mapFocusedListingId = useStore((s) => s.mapFocusedListingId)
  const saved = useStore((s) => s.savedListings.some((x) => x.listing.id === listing.id))
  const highlighted = mapFocusedListingId === listing.id
  const [translatedTitle, setTranslatedTitle] = useState<string | null>(listing._titleEn ?? null)
  const [translating, setTranslating] = useState(false)
  const [showTranslation, setShowTranslation] = useState(false)
  const [amenitiesExpanded, setAmenitiesExpanded] = useState(false)

  const hashes = listing.imgHashes || []
  /** Full-res URLs for modal (600×600). */
  const fullImages = hashes.map((h) => ajkImgUrl(h)).filter(Boolean)
  /** Main tile is much larger than side thumbs — use full size so it isn’t upscaled/blurry. */
  const mainImg = hashes.length > 0 ? ajkImgUrl(hashes[0]) : ''
  const sideImgs = hashes.slice(1, 4).map((h) => ajkThumbUrl(h))
  const pricePerSqm = listing.price && parseFloat(listing.area) > 0
    ? Math.round(listing.price / parseFloat(listing.area))
    : null
  const bedN = listingBedCount(listing)
  const bathN = listingBathCount(listing)
  const layoutFallbackEn =
    bedN == null && bathN == null ? roomsLayoutDisplayEn(listing.rooms) : ''
  const metroEn = metroLinesDisplayEn(listing.metro)
  const orientEn = orientLabelEn(listing.orient)
  const rentTypeEn = rentTypeLabelEn(listing.rentType)

  const handleTranslate = async () => {
    if (translatedTitle) {
      setShowTranslation(!showTranslation)
      return
    }
    setTranslating(true)
    const result = await translateText(listing.title + (listing.des ? '\n' + listing.des : ''))
    listing._titleEn = result
    setTranslatedTitle(result)
    setShowTranslation(true)
    setTranslating(false)
  }

  return (
    <div
      id={`guamap-listing-card-${listing.id}`}
      className={`bg-white rounded-[15px] overflow-hidden transition-shadow ${highlighted
          ? 'ring-2 ring-black ring-offset-2 ring-offset-[var(--color-bg-card)] shadow-md'
          : ''
        }`}
    >
      {/* Image grid */}
      {hashes.length > 0 && (
        <div className="flex gap-1.5 p-3 pb-0">
          <div className="flex-1 aspect-square rounded-[15px] overflow-hidden cursor-pointer" onClick={() => openModal(fullImages, 0)}>
            <img src={mainImg} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
          {sideImgs.length > 0 && (
            <div className="flex flex-col gap-1.5 w-[99px]">
              {sideImgs.map((src, i) => (
                <div key={i} className="h-[97px] rounded-[15px] overflow-hidden cursor-pointer" onClick={() => openModal(fullImages, i + 1)}>
                  <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Title */}
      <div className="px-4 pt-3 pb-1 flex gap-2 items-start">
        <p className="text-sm font-medium text-[var(--color-text)] leading-snug line-clamp-2 flex-1 min-w-0">
          {listing.title.includes('【已下架】') ? (
            <>
              <span className="inline-flex items-center px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[11px] font-bold mr-1.5 align-text-bottom whitespace-nowrap tracking-wide">
                Sold
              </span>
              {listing.title.replace('【已下架】', '').trim()}
            </>
          ) : (
            listing.title
          )}
        </p>
        <button
          type="button"
          onClick={() =>
            toggleSavedListing({ listing, communityId, communityName })
          }
          className="shrink-0 w-8 h-8 -mt-0.5 -mr-1 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-colors"
          title={saved ? 'Remove from saved' : 'Save listing'}
          aria-label={saved ? 'Remove from saved' : 'Save listing'}
          aria-pressed={saved}
        >
          <Star
            className={`w-5 h-5 transition-colors ${saved
                ? 'text-[var(--color-primary)] fill-[var(--color-primary)]'
                : 'text-[var(--color-text)]'
              }`}
          />
        </button>
      </div>
      {showTranslation && translatedTitle && (
        <div className="px-4 pb-1">
          <p className="text-xs text-gray-500 leading-snug">{translatedTitle}</p>
        </div>
      )}

      {/* Price/area tags */}
      <div className="px-4 py-2">
        <div className="flex gap-1.5">
          <span className="px-2.5 py-1 bg-white rounded-[10px] border border-[var(--color-border)] text-xs font-medium text-[var(--color-text)]">
            ¥{listing.price.toLocaleString()}
          </span>
          {listing.area && (
            <span className="px-2.5 py-1 bg-white rounded-[10px] border border-[var(--color-border)] text-xs font-medium text-[var(--color-text)]">
              {listing.area}m²
            </span>
          )}
          {pricePerSqm && (
            <span className="px-2.5 py-1 bg-white rounded-[10px] border border-[var(--color-border)] text-xs font-medium text-[var(--color-text)]">
              ¥{pricePerSqm}/m²
            </span>
          )}
        </div>
      </div>

      {/* Meta info row */}
      <div className="flex items-center gap-3 px-4 pb-3 text-xs text-[var(--color-text)] font-medium flex-wrap">
        {orientEn && (
          <span className="flex items-center gap-1">
            <Compass className="w-3.5 h-3.5 opacity-80" />
            {orientEn}
          </span>
        )}
        {metroEn && (
          <span className="flex items-center gap-1">
            <TrainFront className="w-3 h-3 opacity-80" />
            {metroEn}
          </span>
        )}
        {(bedN != null || bathN != null || layoutFallbackEn) && (
          <span className="flex items-center gap-2 flex-wrap">
            {bedN != null && (
              <span className="flex items-center gap-1">
                <Bed className="w-3.5 h-3.5 opacity-80 shrink-0" />
                {bedN}
              </span>
            )}
            {bedN != null && bathN != null && <span className="text-gray-400">·</span>}
            {bathN != null && (
              <span className="flex items-center gap-1">
                <Bath className="w-3.5 h-3.5 opacity-80 shrink-0" />
                {bathN}
              </span>
            )}
            {layoutFallbackEn && <span>{layoutFallbackEn}</span>}
          </span>
        )}
        {rentTypeEn && (
          <span className="flex items-center gap-1">
            <Home className="w-3.5 h-3.5 opacity-80" />
            {rentTypeEn}
          </span>
        )}
        {/* Amenities collapsible */}
        <div className="w-full mt-1 pt-1 border-t border-gray-50">
          <button
            type="button"
            onClick={() => setAmenitiesExpanded(!amenitiesExpanded)}
            className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-[var(--color-primary)] transition-colors cursor-pointer group"
          >
            <Sparkles className="w-3 h-3 opacity-70 group-hover:opacity-100" />
            <span className="font-semibold">Amenities</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${amenitiesExpanded ? 'rotate-180' : ''}`} />
          </button>
          {amenitiesExpanded && (
            listing.amenities && listing.amenities.length > 0 ? (
              <div className="flex flex-wrap gap-1 mt-2">
                {ALL_AMENITIES.map(({ slug, label }) => {
                  const has = listing.amenities!.includes(slug)
                  return (
                    <span
                      key={slug}
                      className={`px-1.5 py-0.5 text-[9px] rounded-md border leading-none transition-colors ${has
                          ? 'bg-blue-50 text-blue-600 border-blue-300 font-medium'
                          : 'bg-[var(--color-bg-card)] text-gray-300 border-gray-100'
                        }`}
                    >
                      {label}
                    </span>
                  )
                })}
              </div>
            ) : (
              <p className="mt-2 text-[9px] text-red-300 italic">
                No amenity data for this listing
              </p>
            )
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
        <button
          type="button"
          onClick={handleTranslate}
          disabled={translating}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-[var(--color-primary)] transition-colors cursor-pointer"
        >
          <Languages className="w-3.5 h-3.5" />
          {translating ? 'Translating...' : showTranslation ? 'Hide translation' : 'Translate'}
        </button>
        <button
          type="button"
          onClick={() => flyToListingOnMap(listing.id)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-[var(--color-primary)] transition-colors cursor-pointer"
          title="Show on map"
        >
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          On map
        </button>
        <a
          href={ajkListingUrl(listing.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-[var(--color-primary)] hover:underline"
        >
          View on Anjuke →
        </a>
      </div>
    </div>
  )
}

export default memo(ListingCard)
