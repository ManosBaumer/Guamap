import { create } from 'zustand'
import type {
  Community,
  Listing,
  LayerName,
  BaseMapStyle,
  CompoundColorMode,
  SortMode,
  Filters,
  SavedListingSnapshot,
  StreetviewProvider,
} from './types'
import { persistSavedListingsToFile } from './savedListingsStorage'

import { supabase } from './supabase'

interface AppState {
  user: any | null
  setUser: (user: any | null) => void
  authModalOpen: boolean
  setAuthModalOpen: (open: boolean) => void

  layers: Record<LayerName, boolean>
  toggleLayer: (layer: LayerName) => void

  /** Active when `layers.baseMap` is true. Toggling base map on resets to satellite. */
  baseMapStyle: BaseMapStyle
  setBaseMapStyle: (style: BaseMapStyle) => void

  compoundColorMode: CompoundColorMode
  setCompoundColorMode: (mode: CompoundColorMode) => void

  streetviewProvider: StreetviewProvider
  setStreetviewProvider: (provider: StreetviewProvider) => void

  maxTransitTime: number
  setMaxTransitTime: (val: number) => void

  /** Loaded with the map; used to jump from saved listings to a community marker. */
  communities: Community[]
  setCommunities: (list: Community[]) => void

  /**
   * Session-only: community id → `listingCount` when the user last opened it.
   * A marker counts as "viewed" only while `sessionViewedCommunityCounts[id] === community.listingCount`
   * (so a scrape/data refresh that changes the count clears the viewed state).
   */
  sessionViewedCommunityCounts: Record<string, number>

  selectedCommunity: Community | null
  selectedListings: Listing[] | null
  loadingListings: boolean
  selectCommunity: (community: Community | null) => void
  setSelectedListings: (listings: Listing[] | null) => void
  setLoadingListings: (loading: boolean) => void

  savedListings: SavedListingSnapshot[]
  setSavedListings: (list: SavedListingSnapshot[]) => void
  /** Map + listing panel show only saved communities / saved cards. */
  savedMapViewActive: boolean
  toggleSavedMapView: () => void
  setSavedMapViewActive: (active: boolean) => void
  toggleSavedListing: (payload: {
    listing: Listing
    communityId: string
    communityName: string
  }) => void
  removeSavedListing: (id: number) => void

  /** Highlights a listing card; map fly-to only when `flyToListingOnMap` is used. */
  mapFocusedListingId: number | null
  setMapFocusedListingId: (id: number | null) => void
  /** Bumped by panel "On map" — MapFocusController flies when this changes. */
  mapFlyToNonce: number
  flyToListingOnMap: (id: number) => void
  /** Panel listing order for map offsets in community mode (synced from ListingPanel). */
  panelListingOrderIds: number[]
  setPanelListingOrderIds: (ids: number[]) => void

  sort: SortMode
  setSort: (sort: SortMode) => void

  /** Saved view: hide delisted Anjuke listings (title contains 【已下架】). */
  hideOffMarket: boolean
  setHideOffMarket: (hide: boolean) => void

  /** Current listing filters — map & panel update as values change. */
  appliedFilters: Filters
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void
  resetFilters: () => void

  /** Sum of listings across map-eligible communities (all listings, or count matching applied listing filters). */
  shownListingCount: number
  listingsCountLoading: boolean
  setListingCountDisplay: (count: number, loading: boolean) => void

  /** When false, areas outside the four district polygons are masked and excluded from counts/markers. */
  showAreasOutsideFourDistricts: boolean
  toggleShowAreasOutsideFourDistricts: () => void

  /** When stops layer is on: metro only by default; enable to also show bus stops. */
  showBusStops: boolean
  setShowBusStops: (show: boolean) => void

  activeDistricts: Record<string, boolean>
  toggleDistrict: (name: string) => void

  modalImages: string[]
  modalIndex: number
  openModal: (images: string[], index: number) => void
  closeModal: () => void
  modalNext: () => void
  modalPrev: () => void
}

const defaultFilters: Filters = {
  orient: [],
  minPrice: null,
  maxPrice: null,
  minArea: null,
  maxArea: null,
  minBuildYear: null,
  maxBuildYear: null,
  rooms: '',
  bathrooms: '',
  metro: [],
  rentType: '',
  amenities: [],
}

export const useStore = create<AppState>((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),
  authModalOpen: false,
  setAuthModalOpen: (open) => set({ authModalOpen: open }),

  layers: {
    stops: false,
    heatmap: false,
    metro: false,
    baseMap: false,
    anjuke: true,
    compounds: false,
    streetview: false,
  },
  baseMapStyle: 'satellite',
  setBaseMapStyle: (style: BaseMapStyle) => set({ baseMapStyle: style }),
  streetviewProvider: 'tencent',
  setStreetviewProvider: (provider) => set({ streetviewProvider: provider }),
  toggleLayer: (layer) =>
    set((s) => {
      const wasOn = s.layers[layer]
      const nextOn = !wasOn
      if (layer === 'baseMap' && nextOn) {
        return { layers: { ...s.layers, [layer]: nextOn }, baseMapStyle: 'satellite' }
      }
      return { layers: { ...s.layers, [layer]: nextOn } }
    }),

  compoundColorMode: 'none',
  setCompoundColorMode: (mode) => set({ compoundColorMode: mode }),

  maxTransitTime: 120,
  setMaxTransitTime: (val) => set({ maxTransitTime: val }),

  communities: [],
  setCommunities: (list) =>
    set((s) => {
      const byId = new Map(list.map((c) => [c.id, c]))
      const nextSession: Record<string, number> = {}
      for (const [id, countAtView] of Object.entries(s.sessionViewedCommunityCounts)) {
        const c = byId.get(id)
        if (c != null && c.listingCount === countAtView) {
          nextSession[id] = countAtView
        }
      }
      return { communities: list, sessionViewedCommunityCounts: nextSession }
    }),

  sessionViewedCommunityCounts: {},

  selectedCommunity: null,
  selectedListings: null,
  loadingListings: false,
  selectCommunity: (community) =>
    set((s) => {
      if (community === null) {
        return {
          selectedCommunity: null,
          selectedListings: null,
          mapFocusedListingId: null,
        }
      }
      const sessionViewedCommunityCounts = {
        ...s.sessionViewedCommunityCounts,
        [community.id]: community.listingCount,
      }
      /** Re-clicking the same map marker must not wipe listings — effect only re-runs when selection id changes. */
      const sameId = s.selectedCommunity?.id === community.id
      if (sameId) {
        return {
          selectedCommunity: community,
          mapFocusedListingId: null,
          savedMapViewActive: false,
          sessionViewedCommunityCounts,
        }
      }
      return {
        selectedCommunity: community,
        selectedListings: null,
        mapFocusedListingId: null,
        savedMapViewActive: false,
        sessionViewedCommunityCounts,
      }
    }),
  setSelectedListings: (listings) => set({ selectedListings: listings, loadingListings: false }),
  setLoadingListings: (loading) => set({ loadingListings: loading }),

  savedListings: [],
  setSavedListings: (list: SavedListingSnapshot[]) => set({ savedListings: list }),
  savedMapViewActive: false,
  toggleSavedMapView: () =>
    set((s) => {
      const next = !s.savedMapViewActive
      return {
        savedMapViewActive: next,
        selectedCommunity: null,
        selectedListings: null,
        loadingListings: false,
        mapFocusedListingId: null,
        ...(next ? { layers: { ...s.layers, anjuke: true } } : {}),
      }
    }),
  setSavedMapViewActive: (active) =>
    set((s) => ({
      savedMapViewActive: active,
      mapFocusedListingId: null,
      ...(active
        ? {
            selectedCommunity: null,
            selectedListings: null,
            loadingListings: false,
            layers: { ...s.layers, anjuke: true },
          }
        : {}),
    })),
  toggleSavedListing: async (payload) => {
    const s = get()
    if (!s.user) {
      s.setAuthModalOpen(true)
      return
    }
    const id = payload.listing.id
    const exists = s.savedListings.some((x) => x.listing.id === id)
    let next: SavedListingSnapshot[]
    
    if (exists) {
      next = s.savedListings.filter((x) => x.listing.id !== id)
      set({ savedListings: next })
      await supabase.from('saved_listings').delete().match({ user_id: s.user.id, listing_id: id })
    } else {
      const snapshot = {
        listing: { ...payload.listing },
        communityId: payload.communityId,
        communityName: payload.communityName,
        savedAt: new Date().toISOString(),
      }
      next = [...s.savedListings, snapshot]
      set({ savedListings: next })
      await supabase.from('saved_listings').insert({
        user_id: s.user.id,
        listing_id: id,
        community_id: snapshot.communityId,
        community_name: snapshot.communityName,
        listing: snapshot.listing,
        saved_at: snapshot.savedAt
      })
    }
  },
  removeSavedListing: async (id) => {
    const s = get()
    if (!s.user) return
    const next = s.savedListings.filter((x) => x.listing.id !== id)
    set({
      savedListings: next,
      mapFocusedListingId: s.mapFocusedListingId === id ? null : s.mapFocusedListingId,
    })
    await supabase.from('saved_listings').delete().match({ user_id: s.user.id, listing_id: id })
  },

  mapFocusedListingId: null,
  setMapFocusedListingId: (id) => set({ mapFocusedListingId: id }),
  mapFlyToNonce: 0,
  flyToListingOnMap: (id) =>
    set((s) => ({
      mapFocusedListingId: id,
      mapFlyToNonce: s.mapFlyToNonce + 1,
    })),
  panelListingOrderIds: [],
  setPanelListingOrderIds: (ids) => set({ panelListingOrderIds: ids }),

  sort: 'price-asc',
  setSort: (sort) => set({ sort }),

  hideOffMarket: true,
  setHideOffMarket: (hide) => set({ hideOffMarket: hide }),

  appliedFilters: { ...defaultFilters },
  setFilter: (key, value) =>
    set((s) => ({ appliedFilters: { ...s.appliedFilters, [key]: value } })),
  resetFilters: () => set({ appliedFilters: { ...defaultFilters } }),

  shownListingCount: 0,
  listingsCountLoading: false,
  setListingCountDisplay: (count, loading) =>
    set({ shownListingCount: count, listingsCountLoading: loading }),

  showAreasOutsideFourDistricts: true,
  toggleShowAreasOutsideFourDistricts: () =>
    set((s) => ({ showAreasOutsideFourDistricts: !s.showAreasOutsideFourDistricts })),

  showBusStops: false,
  setShowBusStops: (show) => set({ showBusStops: show }),

  activeDistricts: { '天河区': true, '越秀区': true, '海珠区': true, '荔湾区': true },
  toggleDistrict: (name) =>
    set((s) => ({ activeDistricts: { ...s.activeDistricts, [name]: !s.activeDistricts[name] } })),

  modalImages: [],
  modalIndex: 0,
  openModal: (images, index) => set({ modalImages: images, modalIndex: index }),
  closeModal: () => set({ modalImages: [], modalIndex: 0 }),
  modalNext: () =>
    set((s) => ({ modalIndex: Math.min(s.modalIndex + 1, s.modalImages.length - 1) })),
  modalPrev: () =>
    set((s) => ({ modalIndex: Math.max(s.modalIndex - 1, 0) })),
}))
