import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  memo,
  startTransition,
  type MutableRefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, ImageOverlay, Polygon, Pane, useMap, useMapEvent } from 'react-leaflet'
import { Plus, Minus } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useStore } from '@/lib/store'
import { gcjBasemapShiftLayerPixels, GCJ_MAP_OVERSCAN_PAD_PX } from '@/lib/gcj'
import { LeafletTunedWheelZoom } from '@/lib/leafletWheelZoom'
import { TransitPlannerMapLayer } from '@/components/TransitPlannerMapLayer'
import StreetviewModal from '@/components/StreetviewModal'
import CommunityListingCountsCanvas, { type CommunityCountCanvasItem } from '@/components/CommunityListingCountsCanvas'
import TransitStopsCanvas from '@/components/TransitStopsCanvas'
import * as protomapsL from 'protomaps-leaflet'
import {
  loadCommunities, loadStops, loadMetroGeoJSON, loadCompoundsGeoJSON,
  loadStreetviewIndex,
  loadHeatmapBounds, loadScutLocation, loadDistricts,
  heatmapRasterUrl, loadListings, loadListingsMetadata,
} from '@/lib/data'
import type { BaseMapStyle } from '@/lib/types'
import {
  countMatchingListings,
  communityMatchesBuildYear,
  listingFiltersAreActive,
  listingMetadataMatchesFilters,
} from '@/lib/listingFilters'
import { communityPassesMapFilters, stopPassesMapFilters, type MapLocationFilterOpts } from '@/lib/mapQuery'
import { resolveListingMapPosition, savedListingPositions } from '@/lib/listingMapLayout'
import { filteredSavedListings } from '@/lib/panelListings'
import { clearMapLayerHover, setMapLayerHover } from '@/lib/mapPointerCursor'
import type { Community, Stop, HeatmapBounds, ScutLocation, StreetviewIndex, StreetviewIndexEntry } from '@/lib/types'

const GUANGZHOU_CENTER: L.LatLngExpression = [23.13, 113.33]
/** z19 tiles are often missing in Guangzhou — cap user zoom below that. */
const MAP_MAX_ZOOM = 18
const TIME_COLORS = ['#00cc00', '#00cc00', '#ffff00', '#ff8800', '#ff0000']
const TIME_ANCHORS = [0, 45, 58, 70, 80]

function timeToColor(t: number): string {
  const clamped = Math.max(0, Math.min(80, t))
  for (let i = 0; i < TIME_ANCHORS.length - 1; i++) {
    if (clamped <= TIME_ANCHORS[i + 1]) {
      const frac = (clamped - TIME_ANCHORS[i]) / (TIME_ANCHORS[i + 1] - TIME_ANCHORS[i])
      const c0 = TIME_COLORS[i], c1 = TIME_COLORS[i + 1]
      const r = Math.round(parseInt(c0.slice(1, 3), 16) + (parseInt(c1.slice(1, 3), 16) - parseInt(c0.slice(1, 3), 16)) * frac)
      const g = Math.round(parseInt(c0.slice(3, 5), 16) + (parseInt(c1.slice(3, 5), 16) - parseInt(c0.slice(3, 5), 16)) * frac)
      const b = Math.round(parseInt(c0.slice(5, 7), 16) + (parseInt(c1.slice(5, 7), 16) - parseInt(c0.slice(5, 7), 16)) * frac)
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    }
  }
  return TIME_COLORS[TIME_COLORS.length - 1]
}

const RATING_ANCHORS = [1, 2, 3, 4, 5]
const RATING_COLORS = ['#d73027', '#fc8d59', '#fee08b', '#91cf60', '#1a9850']

/** South China University of Technology — official seal (`public/scut-marker.png`) */
const SCUT_MARKER_PX = 40
const SCUT_MAP_ICON = L.icon({
  iconUrl: `${String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')}scut-marker.png`,
  iconSize: [SCUT_MARKER_PX, SCUT_MARKER_PX],
  iconAnchor: [SCUT_MARKER_PX / 2, SCUT_MARKER_PX / 2],
  popupAnchor: [0, -SCUT_MARKER_PX / 2],
  className: 'gm-scut-marker-leaflet',
})

/** Below this zoom, render lightweight CircleMarkers (no DOM text per point). */
const ZOOM_LABELED_MARKERS = 12
const MAX_MARKERS_IN_VIEW = 650

/** Max stops drawn on canvas in view (viewport + cap). */
const MAX_STOP_MARKERS_IN_VIEW = 750

/** Evenly pick up to `limit` items (spatial order preserved by index in `arr`). */
function subsampleToLimit<T>(arr: T[], limit: number): T[] {
  if (arr.length <= limit) return arr
  const out: T[] = []
  for (let i = 0; i < limit; i++) {
    const idx = Math.floor(((i + 0.5) * arr.length) / limit)
    out.push(arr[Math.min(idx, arr.length - 1)])
  }
  return out
}

/** When over cap: keep all metro first (subsample only if needed), then fill with bus up to max. */
function capStopsPrioritizeMetro(inside: Stop[], max: number): Stop[] {
  if (inside.length <= max) return inside
  const metros = inside.filter((s) => s.type === 'metro')
  const buses = inside.filter((s) => s.type === 'bus')

  if (metros.length >= max) return subsampleToLimit(metros, max)

  const pickedMetro = metros
  const busSlots = max - pickedMetro.length
  const pickedBus = subsampleToLimit(buses, busSlots)
  return [...pickedMetro, ...pickedBus]
}

function ratingToColor(r: number): string {
  const clamped = Math.max(1, Math.min(5, r))
  for (let i = 0; i < RATING_ANCHORS.length - 1; i++) {
    if (clamped <= RATING_ANCHORS[i + 1]) {
      const frac = (clamped - RATING_ANCHORS[i]) / (RATING_ANCHORS[i + 1] - RATING_ANCHORS[i])
      const c0 = RATING_COLORS[i], c1 = RATING_COLORS[i + 1]
      const rr = Math.round(parseInt(c0.slice(1, 3), 16) + (parseInt(c1.slice(1, 3), 16) - parseInt(c0.slice(1, 3), 16)) * frac)
      const gg = Math.round(parseInt(c0.slice(3, 5), 16) + (parseInt(c1.slice(3, 5), 16) - parseInt(c0.slice(3, 5), 16)) * frac)
      const bb = Math.round(parseInt(c0.slice(5, 7), 16) + (parseInt(c1.slice(5, 7), 16) - parseInt(c0.slice(5, 7), 16)) * frac)
      return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`
    }
  }
  return RATING_COLORS[RATING_COLORS.length - 1]
}

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function basemapConfig(
  baseMapOn: boolean,
  style: BaseMapStyle,
): {
  key: string
  url: string
  attribution: string
  maxZoom?: number
  maxNativeZoom?: number
} {
  if (!baseMapOn) {
    return {
      key: 'std-osm',
      url: OSM_TILE_URL,
      attribution: OSM_ATTRIBUTION,
      maxNativeZoom: MAP_MAX_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
    }
  }
  switch (style) {
    case 'grayscale':
      return {
        key: 'gray-osm',
        url: OSM_TILE_URL,
        attribution: OSM_ATTRIBUTION,
        maxNativeZoom: MAP_MAX_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
      }
    case 'satellite':
      return {
        key: 'esri-sat',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        maxNativeZoom: MAP_MAX_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
      }
    case 'dark':
      return {
        key: 'carto-dark',
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxNativeZoom: MAP_MAX_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
      }
    case 'positron':
      return {
        key: 'carto-light',
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxNativeZoom: MAP_MAX_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
      }
    case 'voyager':
      return {
        key: 'carto-voyager',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxNativeZoom: MAP_MAX_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
      }
    case 'topo':
      return {
        key: 'opentopo',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
        maxZoom: 17,
        maxNativeZoom: 17,
      }
    default:
      return { key: 'std-osm', url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION }
  }
}

function BasemapTileLayer() {
  const baseMapOn = useStore((s) => s.layers.baseMap)
  const baseMapStyle = useStore((s) => s.baseMapStyle)
  const cfg = useMemo(
    () => basemapConfig(baseMapOn, baseMapStyle),
    [baseMapOn, baseMapStyle],
  )

  return (
    <TileLayer
      key={cfg.key}
      url={cfg.url}
      attribution={cfg.attribution}
      updateWhenZooming={false}
      updateWhenIdle
      keepBuffer={4}
      {...(cfg.maxZoom != null ? { maxZoom: cfg.maxZoom } : {})}
      {...(cfg.maxNativeZoom != null ? { maxNativeZoom: cfg.maxNativeZoom } : {})}
    />
  )
}

/** CSS grayscale filter on OSM tiles only (base map style “Grayscale”). */
function BasemapGrayscaleClassSync() {
  const map = useMap()
  const baseMapOn = useStore((s) => s.layers.baseMap)
  const baseMapStyle = useStore((s) => s.baseMapStyle)
  const grayscaleCss = baseMapOn && baseMapStyle === 'grayscale'

  useEffect(() => {
    const container = map.getContainer()
    if (grayscaleCss) {
      container.classList.add('grayscale-tiles')
    } else {
      container.classList.remove('grayscale-tiles')
    }
    return () => {
      container.classList.remove('grayscale-tiles')
    }
  }, [map, grayscaleCss])

  return null
}

const DISTRICT_MASK_PANE = 'districtClipMask'

const districtMaskCanvasRenderer = L.canvas({ tolerance: 5, padding: 0.5, pane: DISTRICT_MASK_PANE })

const DISTRICT_MASK_PATH_OPTIONS: L.PathOptions = {
  renderer: districtMaskCanvasRenderer,
  fillColor: '#ffffff',
  fillOpacity: 1,
  stroke: true,
  color: '#e5e7eb',
  weight: 1,
  opacity: 1,
  interactive: false,
  bubblingMouseEvents: false,
}

/**
 * District mask — `_update` renderers. Throttle `move`; sync on `moveend` / `zoomend`.
 * Skip `L.GeoJSON` (metro). Heatmap not handled here.
 */
function LeafletMoveSync() {
  const map = useMap()

  useEffect(() => {
    let raf = 0
    let lastMoveThrottle = 0
    const MOVE_THROTTLE_MS = 120

    const syncDistrictPaths = () => {
      const renderers = new Set<L.Renderer>()
      const districtPaneEl = map.getPane(DISTRICT_MASK_PANE)

      const isDistrictMaskPath = (layer: L.Layer): boolean => {
        if (!(layer instanceof L.Path)) return false
        const optPane = (layer.options as { pane?: string } | undefined)?.pane
        if (optPane === DISTRICT_MASK_PANE) return true
        if (districtPaneEl && layer.getPane?.() === districtPaneEl) return true
        return false
      }

      const walk = (layer: L.Layer) => {
        if (layer instanceof L.GeoJSON) {
          return
        }
        if (isDistrictMaskPath(layer)) {
          const p = layer as L.Path & { _renderer?: L.Renderer }
          if (p._renderer) renderers.add(p._renderer)
        }
        const group = layer as L.LayerGroup
        if (typeof group.eachLayer === 'function') {
          group.eachLayer(walk)
        }
      }

      map.eachLayer(walk)
      renderers.forEach((r) => {
        const ren = r as L.Renderer & { _update?: () => void }
        ren._update?.()
      })
    }

    const scheduleDistrict = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        syncDistrictPaths()
      })
    }

    const syncDistrictEnd = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      syncDistrictPaths()
    }

    const onMoveThrottled = () => {
      const now = performance.now()
      if (now - lastMoveThrottle < MOVE_THROTTLE_MS) return
      lastMoveThrottle = now
      scheduleDistrict()
    }

    const onMoveEnd = () => {
      lastMoveThrottle = 0
      syncDistrictEnd()
    }

    map.on('move', onMoveThrottled)
    map.on('moveend', onMoveEnd)
    map.on('zoomend', syncDistrictEnd)

    return () => {
      map.off('move', onMoveThrottled)
      map.off('moveend', onMoveEnd)
      map.off('zoomend', syncDistrictEnd)
      cancelAnimationFrame(raf)
    }
  }, [map])

  return null
}

/** Black star, white outline; focused state is slightly larger (no ring). */
const savedStarIconCache = new Map<string, L.DivIcon>()
const SAVED_STAR_FILL = '#0a0a0a'
const SAVED_STAR_STROKE = '#ffffff'

function getSavedListingStarIcon(focused: boolean): L.DivIcon {
  const key = focused ? 'f' : 'n'
  let icon = savedStarIconCache.get(key)
  if (!icon) {
    const outer = focused ? 52 : 40
    const inner = Math.max(22, outer - 14)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${inner}" height="${inner}" fill="${SAVED_STAR_FILL}" stroke="${SAVED_STAR_STROKE}" stroke-width="1.85" stroke-linejoin="round" style="display:block;filter:drop-shadow(0 0 1px rgba(255,255,255,0.9)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`
    const html = `<div style="width:${outer}px;height:${outer}px;display:flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;">${svg}</div>`
    icon = L.divIcon({
      html,
      iconSize: [outer, outer],
      iconAnchor: [outer / 2, outer / 2],
      className: 'leaflet-div-icon guamap-saved-star-marker',
    })
    savedStarIconCache.set(key, icon)
  }
  return icon
}

function SavedListingStarMarkers({ mapFilterOpts }: { mapFilterOpts: MapLocationFilterOpts }) {
  const layers = useStore((s) => s.layers)
  const savedMapViewActive = useStore((s) => s.savedMapViewActive)
  const savedListings = useStore((s) => s.savedListings)
  const communities = useStore((s) => s.communities)
  const appliedFilters = useStore((s) => s.appliedFilters)
  const sort = useStore((s) => s.sort)
  const hideOffMarket = useStore((s) => s.hideOffMarket)
  const mapFocusedListingId = useStore((s) => s.mapFocusedListingId)
  const setMapFocusedListingId = useStore((s) => s.setMapFocusedListingId)

  const map = useMap()
  const [bounds, setBounds] = useState(() => map.getBounds())

  useEffect(() => {
    const u = () => setBounds(map.getBounds())
    u()
    map.on('moveend zoomend', u)
    return () => {
      map.off('moveend zoomend', u)
    }
  }, [map])

  const positions = useMemo(
    () =>
      savedListingPositions(
        savedListings,
        communities,
        mapFilterOpts,
        appliedFilters,
        sort,
        hideOffMarket,
      ),
    [savedListings, communities, mapFilterOpts, appliedFilters, sort, hideOffMarket],
  )

  const visible = useMemo(() => {
    const b = bounds.pad(0.22)
    const out: { id: number; lat: number; lng: number; label: string }[] = []
    for (const [id, pos] of positions) {
      if (b.contains([pos.lat, pos.lng])) {
        const snapshot = savedListings.find((s) => s.listing.id === id)
        const label = snapshot?.communityName ?? snapshot?.listing.title ?? 'Saved listing'
        out.push({ id, lat: pos.lat, lng: pos.lng, label })
      }
    }
    return out
  }, [positions, bounds, savedListings])

  if (!layers.anjuke || !savedMapViewActive) return null

  return (
    <>
      {visible.map(({ id, lat, lng, label }) => (
        <Marker
          key={id}
          position={[lat, lng]}
          icon={getSavedListingStarIcon(mapFocusedListingId === id)}
          zIndexOffset={mapFocusedListingId === id ? 1400 : 700}
          eventHandlers={{
            mouseover: () => setMapLayerHover(map, 'saved', true),
            mouseout: () => clearMapLayerHover(map, 'saved'),
            click: (e) => {
              L.DomEvent.stopPropagation(e)
              const state = useStore.getState()
              if (state.transitPlannerOpen && state.savedMapViewActive) {
                const point = { lat, lng, label }
                if (state.transitPickOriginMode !== 'none') {
                  state.setTransitOrigin(point)
                  if (state.transitDestination) void state.requestTransitRoutes()
                  return
                }
                if (state.transitPickDestinationMode !== 'none') {
                  state.setTransitDestination(point)
                  if (state.transitOrigin) void state.requestTransitRoutes()
                  return
                }
                if (!state.transitOrigin) {
                  state.setTransitOrigin(point)
                  if (state.transitDestination) void state.requestTransitRoutes()
                  return
                }
                if (!state.transitDestination) {
                  state.setTransitDestination(point)
                  if (state.transitOrigin) void state.requestTransitRoutes()
                  return
                }
              }
              setMapFocusedListingId(id)
            },
          }}
        />
      ))}
    </>
  )
}

/** Persist center/zoom so we can unmount Leaflet while street view is open without losing the map position. */
function MapViewSnapshotSync({
  snapshotRef,
}: {
  snapshotRef: MutableRefObject<{ center: L.LatLngExpression; zoom: number }>
}) {
  const map = useMap()
  useEffect(() => {
    const persist = () => {
      try {
        if (!map.getContainer()?.isConnected) return
        const c = map.getCenter()
        snapshotRef.current = {
          center: [c.lat, c.lng],
          zoom: Math.min(MAP_MAX_ZOOM, Math.round(map.getZoom())),
        }
      } catch {
        // Leaflet can be mid-teardown during React unmount; skip snapshot.
      }
    }
    map.on('moveend zoomend', persist)
    persist()
    return () => {
      map.off('moveend zoomend', persist)
      // Do not call persist() here — getCenter() throws after Leaflet starts destroying the map.
    }
  }, [map, snapshotRef])
  return null
}

function MapFocusController({ mapFilterOpts }: { mapFilterOpts: MapLocationFilterOpts }) {
  const map = useMap()
  const mapFlyToNonce = useStore((s) => s.mapFlyToNonce)
  const lastHandledFlyToNonce = useRef(0)

  useEffect(() => {
    if (mapFlyToNonce === 0 || mapFlyToNonce === lastHandledFlyToNonce.current) return
    lastHandledFlyToNonce.current = mapFlyToNonce

    const st = useStore.getState()
    const listingId = st.mapFocusedListingId
    if (listingId == null) return
    const pos = resolveListingMapPosition({
      listingId,
      savedMapViewActive: st.savedMapViewActive,
      savedListings: st.savedListings,
      communities: st.communities,
      mapFilterOpts,
      appliedFilters: st.appliedFilters,
      sort: st.sort,
      hideOffMarket: st.hideOffMarket,
      selectedCommunity: st.selectedCommunity,
      panelListingIdsInOrder: st.panelListingOrderIds,
    })
    if (!pos) return
    const z = Math.max(map.getZoom(), 16)
    map.flyTo([pos.lat, pos.lng], z, { duration: 0.42, easeLinearity: 0.22 })
  }, [map, mapFilterOpts, mapFlyToNonce])

  return null
}

function CommunityMarkers({
  communities,
  mapFilterOpts,
}: {
  communities: Community[]
  mapFilterOpts: MapLocationFilterOpts
}) {
  const layers = useStore((s) => s.layers)
  const selectCommunity = useStore((s) => s.selectCommunity)
  const appliedFilters = useStore((s) => s.appliedFilters)
  const savedMapViewActive = useStore((s) => s.savedMapViewActive)
  const selectedCommunityId = useStore((s) => s.selectedCommunity?.id ?? null)
  const sessionViewedCommunityCounts = useStore((s) => s.sessionViewedCommunityCounts)

  const map = useMap()
  const [view, setView] = useState(() => ({ bounds: map.getBounds(), zoom: map.getZoom() }))
  /** Match counts for current applied listing filters; merged across pans/zooms until filters change. */
  const [listingMatchById, setListingMatchById] = useState<Record<string, number>>({})
  const listingMatchByIdRef = useRef<Record<string, number>>({})
  listingMatchByIdRef.current = listingMatchById

  useEffect(() => {
    const onMove = () => setView({ bounds: map.getBounds(), zoom: map.getZoom() })
    map.on('moveend zoomend', onMove)
    onMove()
    return () => {
      map.off('moveend zoomend', onMove)
    }
  }, [map])

  const filtersOn = useMemo(() => listingFiltersAreActive(appliedFilters), [appliedFilters])

  const filtered = useMemo(
    () =>
      communities.filter(
        (c) =>
          communityPassesMapFilters(c, mapFilterOpts) && communityMatchesBuildYear(c, appliedFilters),
      ),
    [communities, mapFilterOpts, appliedFilters],
  )

  const visible = useMemo(() => {
    const { bounds, zoom } = view
    const b = bounds.pad(0.08)
    let list = filtered.filter((c) => b.contains([c.lat, c.lng]))
    if (list.length > MAX_MARKERS_IN_VIEW) {
      list = [...list].sort((a, b) => b.listingCount - a.listingCount).slice(0, MAX_MARKERS_IN_VIEW)
    }
    return { list, zoom }
  }, [filtered, view])

  const selectCb = useCallback((c: Community) => {
    selectCommunity(c)
    const state = useStore.getState()
    if (state.transitPlannerOpen && state.transitOrigin && state.transitDestination) {
      void state.requestTransitRoutes()
    }
  }, [selectCommunity])

  useEffect(() => {
    const clearCounts = () => {
      setListingMatchById({})
      // Keep ref in sync immediately so the fetch effect below (same tick) does not still see
      // stale ids from the previous filter — otherwise toFetch is empty until pan/zoom changes visible.list.
      listingMatchByIdRef.current = {}
    }
    if (savedMapViewActive) {
      clearCounts()
      return
    }
    if (!filtersOn) {
      clearCounts()
      return
    }
    clearCounts()
  }, [savedMapViewActive, filtersOn, appliedFilters])

  /** Load / compute match counts only for communities we don't already know (persists across viewport changes). */
  useEffect(() => {
    if (savedMapViewActive) return
    if (!filtersOn) return

    const visibleIds = visible.list.map((c) => c.id)
    const toFetch = visibleIds.filter((id) => listingMatchByIdRef.current[id] === undefined)
    if (toFetch.length === 0) return

    let cancelled = false
    const pendingBatch: Record<string, number> = {}
    let flushRaf = 0

    const flushPendingCounts = () => {
      flushRaf = 0
      if (cancelled) return
      const keys = Object.keys(pendingBatch)
      if (keys.length === 0) return
      const patch: Record<string, number> = {}
      for (const k of keys) {
        patch[k] = pendingBatch[k]!
        delete pendingBatch[k]
      }
      const patchKeys = Object.keys(patch)
      startTransition(() => {
        setListingMatchById((prev) => {
          let next = prev
          for (const id of patchKeys) {
            if (next[id] !== undefined) continue
            if (next === prev) next = { ...prev }
            next[id] = patch[id]!
          }
          return next
        })
      })
    }

    const scheduleFlush = () => {
      if (flushRaf !== 0) return
      flushRaf = requestAnimationFrame(flushPendingCounts)
    }

    const t = setTimeout(() => {
      void (async () => {
        const queue = [...toFetch]
        const concurrency = 8

        async function worker() {
          while (queue.length > 0 && !cancelled) {
            const id = queue.shift()
            if (id == null) break
            if (listingMatchByIdRef.current[id] !== undefined) continue
            const listings = await loadListings(id)
            if (cancelled) return
            const count = countMatchingListings(listings, appliedFilters)
            if (cancelled) return
            if (listingMatchByIdRef.current[id] !== undefined) continue
            pendingBatch[id] = count
            scheduleFlush()
          }
        }

        await Promise.all(Array.from({ length: concurrency }, () => worker()))
        if (!cancelled && flushRaf === 0 && Object.keys(pendingBatch).length > 0) {
          flushPendingCounts()
        }
      })()
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(t)
      if (flushRaf !== 0) cancelAnimationFrame(flushRaf)
    }
  }, [savedMapViewActive, filtersOn, appliedFilters, visible.list])

  const showLabels = visible.zoom >= ZOOM_LABELED_MARKERS

  const communityCanvasItems = useMemo((): CommunityCountCanvasItem[] => {
    const out: CommunityCountCanvasItem[] = []
    for (const comm of visible.list) {
      const isSessionViewed =
        sessionViewedCommunityCounts[comm.id] === comm.listingCount
      if (filtersOn) {
        const matched = listingMatchById[comm.id]
        if (matched === undefined || matched === 0) continue
        out.push({
          comm,
          displayCount: matched,
          isSelected: selectedCommunityId === comm.id,
          isSessionViewed,
        })
      } else {
        out.push({
          comm,
          displayCount: comm.listingCount,
          isSelected: selectedCommunityId === comm.id,
          isSessionViewed,
        })
      }
    }
    return out
  }, [
    visible.list,
    filtersOn,
    listingMatchById,
    selectedCommunityId,
    sessionViewedCommunityCounts,
  ])

  if (!layers.anjuke) return null

  /** Saved view uses per-listing star markers instead of community pills. */
  if (savedMapViewActive) return null

  return (
    <CommunityListingCountsCanvas
      variant={showLabels ? 'counts' : 'dots'}
      items={communityCanvasItems}
      onSelect={selectCb}
    />
  )
}

/** Only mount markers in view (+ padding); cap count so ~3k stops stay responsive. */
function StopMarkersInView({ filtered }: { filtered: Stop[] }) {
  const map = useMap()
  const [bounds, setBounds] = useState<L.LatLngBounds>(() => map.getBounds())

  useEffect(() => {
    const update = () => setBounds(map.getBounds())
    update()
    map.on('moveend', update)
    map.on('zoomend', update)
    map.on('resize', update)
    return () => {
      map.off('moveend', update)
      map.off('zoomend', update)
      map.off('resize', update)
    }
  }, [map])

  const visible = useMemo(() => {
    const b = bounds.pad(0.15)
    const inside = filtered.filter((s) => b.contains(L.latLng(s.lat, s.lon)))
    return capStopsPrioritizeMetro(inside, MAX_STOP_MARKERS_IN_VIEW)
  }, [filtered, bounds])

  return <TransitStopsCanvas stops={visible} />
}

function StopMarkers({
  stops,
  mapFilterOpts,
}: {
  stops: Stop[]
  mapFilterOpts: MapLocationFilterOpts
}) {
  const layers = useStore((s) => s.layers)

  const filtered = useMemo(() => {
    return stops.filter((s) => s.type === 'metro' && stopPassesMapFilters(s, mapFilterOpts))
  }, [stops, mapFilterOpts])

  if (!layers.stops) return null

  return <StopMarkersInView filtered={filtered} />
}

/** Isochrone heatmap raster threshold (minutes); fixed — no user filter. */
const HEATMAP_RASTER_THRESHOLD = 120

function HeatmapOverlay({ gridBounds }: { gridBounds: HeatmapBounds | null }) {
  const layers = useStore((s) => s.layers)

  const config = useMemo(() => {
    if (!layers.heatmap || !gridBounds) return null
    const rounded = Math.ceil(HEATMAP_RASTER_THRESHOLD / 10) * 10
    return {
      key: `grid-${rounded}`,
      url: heatmapRasterUrl(rounded),
      bounds: [[gridBounds.south, gridBounds.west], [gridBounds.north, gridBounds.east]] as L.LatLngBoundsExpression,
    }
  }, [layers.heatmap, gridBounds])

  const [imageReady, setImageReady] = useState(false)
  useEffect(() => {
    if (!config?.url) {
      setImageReady(false)
      return
    }
    setImageReady(false)
    const img = new Image()
    img.decoding = 'async'
    const done = () => setImageReady(true)
    img.onload = done
    img.onerror = done
    img.src = config.url
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [config?.url])

  if (!config || !imageReady) return null

  return (
    <Pane name="heatmapRaster" style={{ zIndex: 390 }}>
      <ImageOverlay key={config.key} url={config.url} bounds={config.bounds} opacity={0.55} />
    </Pane>
  )
}

const metroCanvasRenderer = L.canvas({ tolerance: 4, padding: 0.35 })

const MetroLayer = memo(function MetroLayer({ data }: { data: GeoJSON.FeatureCollection }) {
  const layers = useStore((s) => s.layers)

  const style = useCallback((feature?: GeoJSON.Feature) => {
    return {
      color: (feature?.properties as { color?: string } | undefined)?.color || '#666',
      weight: 2,
      opacity: 0.85,
      renderer: metroCanvasRenderer,
      interactive: false,
    }
  }, [])

  if (!layers.metro) return null

  return (
    <Pane name="metroLines" style={{ zIndex: 340 }}>
      <GeoJSON data={data} interactive={false} bubblingMouseEvents={false} style={style} />
    </Pane>
  )
})

function TencentLinesPmtilesLayer({ pmtilesUrl }: { pmtilesUrl: string }) {
  const map = useMap()
  const enabled = useStore((s) => s.layers.streetview)
  const layerRef = useRef<any>(null)

  useEffect(() => {
    // Always clean up the previous layer first
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    if (!enabled) return

    const lineWide = new (protomapsL as any).LineSymbolizer({ width: 5, color: '#99e9f2', opacity: 0.95 })
    const lineMid = new (protomapsL as any).LineSymbolizer({ width: 3, color: '#99e9f2', opacity: 0.95 })
    const lineThin = new (protomapsL as any).LineSymbolizer({ width: 1, color: '#1098ad', opacity: 0.95 })

    const layer = (protomapsL as any).leafletLayer({
      url: pmtilesUrl,
      pane: 'tencentStreetviewLines',
      maxDataZoom: 11,
      paintRules: [
        { dataLayer: 'sv', symbolizer: lineWide, maxzoom: 5 },
        { dataLayer: 'sv', symbolizer: lineMid, minzoom: 6 },
        { dataLayer: 'sv', symbolizer: lineThin },
      ],
      labelRules: [],
      backgroundColor: 'rgba(0,0,0,0)',
      keepBuffer: 4,
    })

    layerRef.current = layer
    layer.addTo(map)

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [enabled, map, pmtilesUrl])

  return null
}

function MapZoomButtons({ portalEl }: { portalEl: HTMLElement | null }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  const minZoom = map.getMinZoom()
  const maxZoom = map.getMaxZoom()

  useEffect(() => {
    const onZoomEnd = () => setZoom(map.getZoom())
    map.on('zoomend', onZoomEnd)
    return () => {
      map.off('zoomend', onZoomEnd)
    }
  }, [map])

  if (!portalEl) return null

  return createPortal(
    <div className="flex flex-col gap-1" role="group" aria-label="Map zoom">
      <button
        type="button"
        className="w-10 h-10 flex items-center justify-center rounded-lg bg-white border border-[var(--color-border)] shadow-md text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        aria-label="Zoom in"
        disabled={zoom >= maxZoom}
        onClick={() => map.zoomIn(1)}
      >
        <Plus className="w-5 h-5" aria-hidden />
      </button>
      <button
        type="button"
        className="w-10 h-10 flex items-center justify-center rounded-lg bg-white border border-[var(--color-border)] shadow-md text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        aria-label="Zoom out"
        disabled={zoom <= minZoom}
        onClick={() => map.zoomOut(1)}
      >
        <Minus className="w-5 h-5" aria-hidden />
      </button>
    </div>,
    portalEl,
  )
}

function TencentCoveragePaneOffset() {
  const map = useMap()
  const enabled = useStore((s) => s.layers.streetview)

  useEffect(() => {
    const pane = map.getPane('tencentStreetviewLines')
    if (!pane) return

    const applyOffset = () => {
      if (!enabled) {
        pane.style.transform = ''
        return
      }
      const { dx, dy } = gcjBasemapShiftLayerPixels(map)
      pane.style.transform = `translate(${dx}px, ${dy}px)`
    }

    applyOffset()
    map.on('move zoom', applyOffset)
    return () => {
      map.off('move zoom', applyOffset)
      pane.style.transform = ''
    }
  }, [enabled, map])

  return null
}

function approxDistanceSqMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  // Equirectangular approximation is sufficient for “nearest pano” in a tiny cell (0.001deg).
  const R = 111_320.0
  const midLat = (lat1 + lat2) / 2.0
  const dlat = (lat2 - lat1) * R
  const dlng = (lng2 - lng1) * R * Math.cos((midLat * Math.PI) / 180.0)
  return dlat * dlat + dlng * dlng
}

/** WGS84 click vs WGS84 index (`process_coverage.py` converts GCJ panos to WGS before gridding). */
function findNearestTencentPano(index: StreetviewIndex, lat: number, lng: number): StreetviewIndexEntry | null {
  const { cellSize, cells } = index
  // Index generator used `int(lat / cell_size)`; since our lat/lng are positive, `floor` matches.
  const baseRow = Math.floor(lat / cellSize)
  const baseCol = Math.floor(lng / cellSize)

  let best: StreetviewIndexEntry | null = null
  let bestD = Number.POSITIVE_INFINITY

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const key = `${baseRow + dr}_${baseCol + dc}`
      const entries = cells[key]
      if (!entries) continue
      for (const e of entries) {
        const d = approxDistanceSqMeters(lat, lng, e.lat, e.lng)
        if (d < bestD) {
          bestD = d
          best = e
        }
      }
    }
  }

  return best
}

const STREETVIEW_HOVER_RADIUS_PX = 16

function isNearStreetviewPano(
  map: L.Map,
  index: StreetviewIndex,
  lat: number,
  lng: number,
  containerPoint: L.Point,
): boolean {
  const nearest = findNearestTencentPano(index, lat, lng)
  if (!nearest) return false
  const pt = map.latLngToContainerPoint([nearest.lat, nearest.lng])
  const dx = pt.x - containerPoint.x
  const dy = pt.y - containerPoint.y
  const r = STREETVIEW_HOVER_RADIUS_PX
  return dx * dx + dy * dy <= r * r
}

function transitMapPickActive(): boolean {
  const st = useStore.getState()
  return (
    st.transitPlannerOpen &&
    (st.transitPickOriginMode === 'map' || st.transitPickDestinationMode === 'map')
  )
}

function TencentStreetviewHoverCursor({ index }: { index: StreetviewIndex | null }) {
  const map = useMap()
  const enabled = useStore((s) => s.layers.streetview)

  useMapEvent('mousemove', (e) => {
    if (!enabled || !index || transitMapPickActive()) {
      clearMapLayerHover(map, 'streetview')
      return
    }
    const near = isNearStreetviewPano(map, index, e.latlng.lat, e.latlng.lng, e.containerPoint)
    setMapLayerHover(map, 'streetview', near)
  })

  useMapEvent('mouseout', () => {
    clearMapLayerHover(map, 'streetview')
  })

  return null
}

function TencentStreetviewClickOpen({
  index,
  onOpen,
}: {
  index: StreetviewIndex | null
  onOpen: (entry: StreetviewIndexEntry) => void
}) {
  const map = useMap()
  const enabled = useStore((s) => s.layers.streetview)
  const transitPlannerOpen = useStore((s) => s.transitPlannerOpen)
  const transitPickDestinationMode = useStore((s) => s.transitPickDestinationMode)
  const transitPickOriginMode = useStore((s) => s.transitPickOriginMode)
  const lastOpenedAtRef = useRef(0)

  useEffect(() => {
    if (!enabled || !index) return
    if (transitPlannerOpen) {
      const st = useStore.getState()
      if (st.transitPickOriginMode === 'map' || st.transitPickDestinationMode === 'map') {
        return
      }
    }

    const onClick = (e: L.LeafletMouseEvent) => {
      const now = performance.now()
      if (now - lastOpenedAtRef.current < 800) return
      lastOpenedAtRef.current = now

      const nearest = findNearestTencentPano(index, e.latlng.lat, e.latlng.lng)
      if (!nearest) return

      onOpen(nearest)
    }

    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [enabled, index, map, transitPlannerOpen, transitPickDestinationMode, transitPickOriginMode])

  return null
}

function CompoundsLayer({ data }: { data: GeoJSON.FeatureCollection }) {
  const layers = useStore((s) => s.layers)
  const compoundColorMode = useStore((s) => s.compoundColorMode)

  const styleFunc = useCallback((feature: GeoJSON.Feature | undefined) => {
    const props = feature?.properties || {}
    const t = props.transitTime ?? -1
    const ratingAvg = props.ratingAvg ?? 0
    const ratingCount = props.ratingCount ?? 0

    if (compoundColorMode === 'transit') {
      if (t >= 0) {
        return { color: timeToColor(t), fillColor: timeToColor(t), fillOpacity: 0.5, weight: 1.5, opacity: 0.8 }
      }
      return { fillOpacity: 0.05, opacity: 0.15, weight: 0.5, color: '#999' }
    }

    if (compoundColorMode === 'ratings') {
      if (ratingCount > 0 && ratingAvg > 0) {
        const c = ratingToColor(ratingAvg)
        return { color: c, fillColor: c, fillOpacity: 0.55, weight: 1.5, opacity: 0.8 }
      }
      return { color: '#9ca3af', weight: 1, fillColor: '#f9fafb', fillOpacity: 0.4, opacity: 0.8 }
    }

    return { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 1, opacity: 0.5 }
  }, [compoundColorMode])

  if (!layers.compounds) return null

  return (
    <GeoJSON
      key={`compounds-${compoundColorMode}`}
      data={data}
      style={styleFunc}
      onEachFeature={(feature, layer) => {
        const p = feature.properties || {}
        layer.bindPopup(`<strong>${p.name || ''}</strong><br/>${p.nameEn || ''}<br/>${p.district || ''}`)
      }}
    />
  )
}

/** Mask everything outside the four core district polygons (holes = district boundaries). */
function OutsideCoreDistrictMask({ districts }: { districts: GeoJSON.FeatureCollection }) {
  /** Large outer ring so the mask always covers the viewport (lat, lng). */
  const outer: [number, number][] = [
    [18.0, 107.0],
    [29.5, 107.0],
    [29.5, 119.5],
    [18.0, 119.5],
  ]
  const holes = districts.features.map((feat) => {
    const geom = feat.geometry as GeoJSON.Polygon
    return geom.coordinates[0].map((c) => [c[1], c[0]] as [number, number])
  })

  return (
    <Polygon
      positions={[outer, ...holes]}
      pathOptions={DISTRICT_MASK_PATH_OPTIONS}
    />
  )
}

function DistrictMasks({ districts, activeDistricts }: { districts: GeoJSON.FeatureCollection; activeDistricts: Record<string, boolean> }) {
  const inactiveFeatures = districts.features.filter(f => !activeDistricts[f.properties?.name])
  if (inactiveFeatures.length === 0) return null

  return (
    <>
      {inactiveFeatures.map(feat => {
        const geom = feat.geometry as GeoJSON.Polygon
        const ring = geom.coordinates[0].map(c => [c[1], c[0]] as [number, number])
        return (
          <Polygon
            key={feat.properties?.name}
            positions={ring}
            pathOptions={DISTRICT_MASK_PATH_OPTIONS}
          />
        )
      })}
    </>
  )
}

export default function MapView() {
  const communities = useStore((s) => s.communities)
  const setCommunities = useStore((s) => s.setCommunities)
  const [stops, setStops] = useState<Stop[]>([])
  const [metroData, setMetroData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [compoundsData, setCompoundsData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [streetviewIndex, setStreetviewIndex] = useState<StreetviewIndex | null>(null)
  const [streetviewModalOpen, setStreetviewModalOpen] = useState(false)
  const [streetviewModalEntry, setStreetviewModalEntry] = useState<StreetviewIndexEntry | null>(null)
  const streetviewProvider = useStore((s) => s.streetviewProvider)
  const [heatmapBounds, setHeatmapBounds] = useState<HeatmapBounds | null>(null)
  const [scutLocation, setScutLocation] = useState<ScutLocation | null>(null)
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null)
  const activeDistricts = useStore((s) => s.activeDistricts)
  const showAreasOutsideFourDistricts = useStore((s) => s.showAreasOutsideFourDistricts)
  const appliedFilters = useStore((s) => s.appliedFilters)
  const setListingCountDisplay = useStore((s) => s.setListingCountDisplay)
  const savedMapViewActive = useStore((s) => s.savedMapViewActive)
  const savedListings = useStore((s) => s.savedListings)
  const hideOffMarket = useStore((s) => s.hideOffMarket)
  const sort = useStore((s) => s.sort)
  const selectCommunity = useStore((s) => s.selectCommunity)
  const setSavedMapViewActive = useStore((s) => s.setSavedMapViewActive)
  const streetviewPmtilesUrl = `${import.meta.env.BASE_URL}data/lines_${streetviewProvider}.pmtiles`
  const mapSnapshotRef = useRef<{ center: L.LatLngExpression; zoom: number }>({
    center: GUANGZHOU_CENTER,
    zoom: 12,
  })
  const [zoomControlsEl, setZoomControlsEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    loadCommunities().then(setCommunities)
    loadStops().then(setStops)
    loadMetroGeoJSON().then(setMetroData)
    loadCompoundsGeoJSON().then(setCompoundsData)
    loadHeatmapBounds().then(setHeatmapBounds)
    loadScutLocation().then(setScutLocation)
    loadDistricts().then(setDistricts)
  }, [])

  useEffect(() => {
    loadStreetviewIndex(streetviewProvider).then(setStreetviewIndex)
  }, [streetviewProvider])

  // Look Around navigation is handled inside the pano modal.

  const allDistrictsActive = useMemo(
    () => Object.values(activeDistricts).every(Boolean),
    [activeDistricts],
  )

  const inactivePolygons = useMemo(() => {
    if (!districts || allDistrictsActive) return []
    return districts.features
      .filter(f => !activeDistricts[f.properties?.name])
      .map(f => (f.geometry as GeoJSON.Polygon).coordinates)
  }, [districts, activeDistricts, allDistrictsActive])

  const mapFilterOpts = useMemo<MapLocationFilterOpts>(
    () => ({
      districts,
      showAreasOutsideFourDistricts,
      allDistrictsActive,
      inactivePolygons,
    }),
    [districts, showAreasOutsideFourDistricts, allDistrictsActive, inactivePolygons],
  )

  /** Stable while filter *values* are unchanged — avoids recomputing eligible list / restarting fetches on object identity churn. */
  const appliedFiltersKey = useMemo(() => JSON.stringify(appliedFilters), [appliedFilters])

  const eligibleCommunities = useMemo(() => {
    return communities.filter(
      (c) =>
        communityPassesMapFilters(c, mapFilterOpts) && communityMatchesBuildYear(c, appliedFilters),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appliedFilters aligned with appliedFiltersKey on each render
  }, [communities, mapFilterOpts, appliedFiltersKey])

  /** Total listings across eligible communities (raw counts or filtered matches). */
  useEffect(() => {
    if (streetviewModalOpen) return

    if (savedMapViewActive) {
      setListingCountDisplay(
        filteredSavedListings(savedListings, appliedFilters, sort, hideOffMarket).length,
        false,
      )
      return
    }

    const sumListingCounts = () =>
      eligibleCommunities.reduce((s, c) => s + c.listingCount, 0)

    if (!listingFiltersAreActive(appliedFilters)) {
      setListingCountDisplay(sumListingCounts(), false)
      return
    }

    let cancelled = false
    const ids = new Set(eligibleCommunities.map((c) => c.id))
    if (ids.size === 0) {
      setListingCountDisplay(0, false)
      return
    }

    /** Filters are live in the UI — metadata approach is much faster than per-community fetches. */
    const filtersSnapshot = appliedFilters
    setListingCountDisplay(0, true)

    const tid = window.setTimeout(() => {
      if (cancelled) return
      void (async () => {
        const metadata = await loadListingsMetadata()
        if (cancelled) return
        
        let sum = 0
        for (const m of metadata) {
          if (ids.has(m.c)) {
            if (listingMetadataMatchesFilters(m, filtersSnapshot)) {
              sum++
            }
          }
        }
        
        if (!cancelled) setListingCountDisplay(sum, false)
      })()
    }, 400) // Keep debounce to avoid blocking on every slider tick

    return () => {
      cancelled = true
      window.clearTimeout(tid)
    }
    // appliedFilters: omit from deps — identity churn restarts this effect; values tracked via appliedFiltersKey + eligibleCommunities
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    streetviewModalOpen,
    eligibleCommunities,
    appliedFiltersKey,
    setListingCountDisplay,
    savedMapViewActive,
    savedListings,
    hideOffMarket,
    sort,
  ])

  return (
    <div className="flex-1 relative z-0 min-w-0 isolate min-h-0">
      <style>
        {`
        /* Match tile/loading gaps so OSM doesn't flash white before overlays / while tiles load */
        .leaflet-container {
          background: #e5e7eb !important;
        }
        .leaflet-pane.leaflet-tile-pane {
          background-color: #e5e7eb;
        }
        img.leaflet-tile {
          background-color: #e5e7eb;
        }
        /* Only base map tiles — not heatmap ImageOverlay or other overlay-pane rasters */
        .grayscale-tiles .leaflet-tile-pane img { filter: grayscale(100%); }
        /* Leaflet’s default .leaflet-div-icon is white box + border — breaks our badge layout & centering */
        .leaflet-div-icon.guamap-community-marker {
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        .leaflet-div-icon.guamap-saved-star-marker {
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        /*
         * L.icon applies className on the img (no wrapper); do not use a descendant img selector.
         * High specificity so Leaflet / resets do not strip shadows.
         */
        .leaflet-container .leaflet-marker-pane img.leaflet-marker-icon.gm-scut-marker-leaflet {
          border-radius: 50% !important;
          background: #fff !important;
          object-fit: cover !important;
 
          filter: drop-shadow(0 0 8px #fff) drop-shadow(0 6px 14px rgba(0, 0, 0, 0.7)) !important;
        }
        `}
      </style>
      <div className="absolute inset-0 overflow-hidden">
        <div
          ref={setZoomControlsEl}
          className={`absolute bottom-4 right-4 z-[1000] pointer-events-auto${streetviewModalOpen ? ' hidden' : ''}`}
        />
        <div
          className="absolute"
          style={{
            top: -GCJ_MAP_OVERSCAN_PAD_PX,
            left: -GCJ_MAP_OVERSCAN_PAD_PX,
            width: `calc(100% + ${2 * GCJ_MAP_OVERSCAN_PAD_PX}px)`,
            height: `calc(100% + ${2 * GCJ_MAP_OVERSCAN_PAD_PX}px)`,
          }}
        >
          {streetviewModalOpen ? (
            <div className="w-full h-full bg-[#e5e7eb]" aria-hidden />
          ) : (
            <MapContainer
              center={mapSnapshotRef.current.center}
              zoom={Math.min(MAP_MAX_ZOOM, Math.round(mapSnapshotRef.current.zoom))}
              className="w-full h-full"
              zoomControl={false}
              preferCanvas={false}
              fadeAnimation={false}
              zoomAnimation={false}
              zoomSnap={1}
              zoomDelta={1}
              maxZoom={MAP_MAX_ZOOM}
            >
              <MapViewSnapshotSync snapshotRef={mapSnapshotRef} />
              <LeafletTunedWheelZoom />
              <TransitPlannerMapLayer />
              <MapZoomButtons portalEl={zoomControlsEl} />
              <BasemapTileLayer />

              <LeafletMoveSync />
              <BasemapGrayscaleClassSync />

              <HeatmapOverlay gridBounds={heatmapBounds} />
              {metroData && <MetroLayer data={metroData} />}
              {/* Above heatmapRaster (390) so cyan/blue lines aren’t tinted green; below districtClipMask (480) */}
              <Pane name="tencentStreetviewLines" style={{ zIndex: 430 }} />
              <TencentLinesPmtilesLayer pmtilesUrl={streetviewPmtilesUrl} />
              <TencentCoveragePaneOffset />
              <TencentStreetviewClickOpen
                index={streetviewIndex}
                onOpen={(entry) => {
                  selectCommunity(null)
                  setSavedMapViewActive(false)
                  setStreetviewModalEntry(entry)
                  setStreetviewModalOpen(true)
                }}
              />
              <TencentStreetviewHoverCursor index={streetviewIndex} />
              <Pane name="compoundsBelow" style={{ zIndex: 350 }}>
                {compoundsData && <CompoundsLayer data={compoundsData} />}
              </Pane>
              <Pane name="anjukePane" style={{ zIndex: 560 }}>
                <CommunityMarkers communities={communities} mapFilterOpts={mapFilterOpts} />
                <SavedListingStarMarkers mapFilterOpts={mapFilterOpts} />
                <MapFocusController mapFilterOpts={mapFilterOpts} />
              </Pane>
              {/* Canvas stops mount after community layer so map click hits listing pills first when overlapping. */}
              <StopMarkers stops={stops} mapFilterOpts={mapFilterOpts} />

              {scutLocation && (
                <Marker position={[scutLocation.lat, scutLocation.lon]} icon={SCUT_MAP_ICON}>
                  <Popup>{scutLocation.name}</Popup>
                </Marker>
              )}

              {/* Above heatmap / metro / compounds; below stops & community markers so markers stay visible on borders */}
              <Pane name="districtClipMask" style={{ zIndex: 480, pointerEvents: 'none' }}>
                {districts && !showAreasOutsideFourDistricts && (
                  <OutsideCoreDistrictMask districts={districts} />
                )}
                {districts && <DistrictMasks districts={districts} activeDistricts={activeDistricts} />}
              </Pane>
            </MapContainer>
          )}
        </div>

        <StreetviewModal
          open={streetviewModalOpen}
          entry={streetviewModalEntry}
          index={streetviewIndex}
          provider={streetviewProvider}
          onClose={() => {
            setStreetviewModalOpen(false)
            setStreetviewModalEntry(null)
          }}
        />

      </div>
    </div>
  )
}
