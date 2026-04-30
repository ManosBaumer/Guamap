import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import * as protomapsL from 'protomaps-leaflet'
import { Viewer } from '@photo-sphere-viewer/core'
import { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter'
import '@photo-sphere-viewer/core/index.css'
import 'leaflet/dist/leaflet.css'
import { gcjBasemapShiftLayerPixelsAt } from '@/lib/gcj'
import type { StreetviewIndex, StreetviewIndexEntry, StreetviewProvider } from '@/lib/types'

const SV_THUMB_BASE = 'https://sv1.map.qq.com/thumb'

type PanoMeta = {
  levels: Array<{ width: number; cols: number; rows: number }>
  baseUrl: string
  tileUrl: (col: number, row: number, level: number) => string
}

function buildTencentTilesPanorama(svid: string): PanoMeta {
  const levels = [
    { width: 512 * 8, cols: 8, rows: 4 },
    { width: 512 * 16, cols: 16, rows: 8 },
  ]

  const baseUrl = `${SV_THUMB_BASE}?from=web&svid=${encodeURIComponent(svid)}&level=0&x=0&y=0`

  const tileUrl = (col: number, row: number, level: number) => {
    return `https://sv1.map.qq.com/tile?from=web&svid=${encodeURIComponent(svid)}&level=${level}&x=${col}&y=${row}`
  }

  return { levels, baseUrl, tileUrl }
}

function buildBaiduTilesPanorama(svid: string): PanoMeta {
  // Baidu z-levels start from 1. 
  // level 1: 1x1 tile (256x256 total or 512x256)
  // level 2: 2x1 tiles (512x256 total)
  // level 3: 4x2 tiles (1024x512 total)
  // level 4: 8x4 tiles (2048x1024 total)
  // level 5: 16x8 tiles (4096x2048 total)
  
  // Note: These dimensions might need tuning depending on the actual Baidu tile dimensions (usually 512px).
  const levels = [
    { width: 512 * 8, cols: 8, rows: 4 }, // Maps to Baidu z=4
    { width: 512 * 16, cols: 16, rows: 8 }, // Maps to Baidu z=5
  ]

  const baseUrl = `https://mapsv0.bdimg.com/?qt=pdata&sid=${encodeURIComponent(svid)}&pos=0_0&z=1`

  const tileUrl = (col: number, row: number, level: number) => {
    // Map PhotoSphereViewer level (0, 1) to Baidu's z (4, 5)
    const baiduZ = level + 4
    return `https://mapsv0.bdimg.com/?qt=pdata&sid=${encodeURIComponent(svid)}&pos=${row}_${col}&z=${baiduZ}`
  }

  return { levels, baseUrl, tileUrl }
}

function approxDistanceSqMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  // Equirectangular approximation is enough for “nearest pano” in a small cell.
  const R = 111_320.0
  const midLat = (lat1 + lat2) / 2.0
  const dlat = (lat2 - lat1) * R
  const dlng = (lng2 - lng1) * R * Math.cos((midLat * Math.PI) / 180.0)
  return dlat * dlat + dlng * dlng
}

function normalizeDeg(value: number): number {
  return ((value % 360) + 360) % 360
}

/**
 * PSV `Position.yaw` / `pitch` are always radians (yaw is wrapped to [0, 2π)).
 * Never use a “is this radians?” heuristic on yaw: values in (≈216°, 360°) are > π×1.2 rad
 * and were misread as degrees, so NW/W/SW broke on the compass and pegman.
 */
function psvRadiansToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

function psvYawToCompassDeg(yawRad: number): number {
  return normalizeDeg(psvRadiansToDeg(yawRad))
}

function parseCaptureDateFromSvid(svid?: string): string | undefined {
  if (!svid || svid.length < 14) return undefined
  // qq-map derives capture date from svid (YYMMDD at positions 8..13).
  const yy = svid.slice(8, 10)
  const mm = svid.slice(10, 12)
  const dd = svid.slice(12, 14)
  const y = Number(yy)
  const m = Number(mm)
  const d = Number(dd)
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return undefined
  return `${2000 + y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function formatCaptureDate(raw?: string): string {
  const s = raw?.trim() || ''
  if (!s) return 'Unknown'
  // Common raw format: YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  return s
}

/**
 * `lat`/`lng` are WGS84 (OSM / Leaflet). `streetview_tencent_index.json` is also WGS84 — see
 * `process_coverage.py` `panos_to_spatial_index` (`gcj02_to_wgs84` before gridding).
 */
function findNearestTencentPano(index: StreetviewIndex, lat: number, lng: number): StreetviewIndexEntry | null {
  const { cellSize, cells } = index
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

/** Imperative pegman + `setView` whenever lat/lng/icon change (react-leaflet Marker uses ref equality on `position`). */
function MinimapPegmanPaneSetup() {
  const map = useMap()
  useEffect(() => {
    let pane = map.getPane('miniPegman')
    if (!pane) pane = map.createPane('miniPegman')
    pane.style.zIndex = '700'
  }, [map])
  return null
}

function MinimapPegmanAndFollowCenter({ lat, lng, icon }: { lat: number; lng: number; icon: L.DivIcon }) {
  const map = useMap()
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    const ll = L.latLng(lat, lng)
    map.setView(ll, map.getZoom(), { animate: false })

    if (!markerRef.current) {
      markerRef.current = L.marker(ll, { icon, interactive: false, pane: 'miniPegman' }).addTo(map)
    } else {
      markerRef.current.setLatLng(ll)
      markerRef.current.setIcon(icon)
    }
  }, [icon, lat, lng, map])

  useEffect(() => {
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
    }
  }, [map])

  return null
}

function buildPegmanIconHtml(viewYawDeg: number): string {
  const rot = normalizeDeg(viewYawDeg)
  // Compact pegman; iconAnchor targets feet at bottom center. Wedge scaled up for visibility.
  return `
<div style="width:32px;height:46px;position:relative;pointer-events:none;-webkit-user-select:none;user-select:none">
  <div style="position:absolute;left:50%;bottom:5px;width:32px;height:32px;margin-left:-16px;border-radius:50%;background:rgba(75,78,82,0.42);box-shadow:0 1px 3px rgba(0,0,0,0.35);overflow:visible">
    <svg width="32" height="32" viewBox="0 0 54 54" style="position:absolute;left:0;top:0;overflow:visible">
      <g transform="translate(27,27) rotate(${rot}) scale(0.78)">
        <path d="M 0 0 L 0 -22 A 22 22 0 0 1 19 -11 Z" fill="rgba(25,32,38,0.78)" stroke="rgba(0,0,0,0.22)" stroke-width="1.1"/>
      </g>
    </svg>
  </div>
  <div style="position:absolute;left:50%;bottom:17px;transform:translateX(-50%);width:13px;height:19px;background:linear-gradient(100deg,#f7e040 0%,#ffd52e 45%,#d4a800 100%);border-radius:5px 5px 3px 3px;box-shadow:0 2px 5px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.45);"></div>
  <div style="position:absolute;left:50%;bottom:34px;transform:translateX(-50%);width:10px;height:10px;background:radial-gradient(circle at 32% 28%, #fff6a8,#f0c400 55%,#c9a000);border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.35);"></div>
</div>`
}

const MINI_TENCENT_PANE = 'miniTencentSvLines'
/** Minimap zoom range: default is closer in; user can still zoom out to min or in to max. */
const MINIMAP_MIN_ZOOM = 13
const MINIMAP_DEFAULT_ZOOM = 16
const MINIMAP_MAX_ZOOM = 18
/**
 * PSV texture “north” vs cone mesh: pegman often reads slightly clockwise vs the SVG compass — nudge CCW (negative).
 * Tune if your tiles differ.
 */
const MINIMAP_PEGMAN_HEADING_BIAS_DEG = -11
/** Fixed gutter so the minimap size does not change on zoom (avoids overlay “jump” from invalidateSize). */
const MINIMAP_GCJ_OVERSCAN_PAD = 960
/**
 * Protomaps `View.queryFeatures` scales brush by 1 / 2^(zoom - dataZ). These must match
 * `MiniTencentPmtilesLayer`: default levelDiff 1, maxDataZoom 11.
 */
const MINI_PMTILES_LEVEL_DIFF = 1
const MINI_PMTILES_MAX_DATA_Z = 11
const MINI_PMTILES_HIT_RADIUS_TILE_PX = 24

function minimapPmtilesQueryBrushSize(mapZoom: number): number {
  const z = Math.round(mapZoom)
  const dataZ = Math.min(z - MINI_PMTILES_LEVEL_DIFF, MINI_PMTILES_MAX_DATA_Z)
  const factor = Math.max(1, 1 << Math.max(0, z - dataZ))
  return MINI_PMTILES_HIT_RADIUS_TILE_PX * factor
}

/** Map click (WGS) → lat/lng the PMTiles renderer used before the GCJ pane translate. */
function minimapQueryLatLngForSvHitTest(
  map: L.Map,
  lat: number,
  lng: number,
  anchorLat: number,
  anchorLng: number,
): L.LatLng {
  const { dx, dy } = gcjBasemapShiftLayerPixelsAt(map, anchorLat, anchorLng)
  const p = map.latLngToLayerPoint(L.latLng(lat, lng))
  return map.layerPointToLatLng(L.point(p.x - dx, p.y - dy))
}

/** Protomaps leaflet layer instance — used for line-hit testing on click. */
type MinimapPmtilesApi = {
  queryTileFeaturesDebug: (lng: number, lat: number, brushSize?: number) => Map<string, unknown[]>
}

function MiniTencentCoveragePaneSetup() {
  const map = useMap()
  useEffect(() => {
    let pane = map.getPane(MINI_TENCENT_PANE)
    if (!pane) {
      pane = map.createPane(MINI_TENCENT_PANE)
    }
    pane.style.zIndex = '450'
    pane.style.pointerEvents = 'none'
  }, [map])
  return null
}

function MiniTencentCoveragePaneOffset({
  anchorLat,
  anchorLng,
}: {
  anchorLat: number
  anchorLng: number
}) {
  const map = useMap()
  useEffect(() => {
    const pane = map.getPane(MINI_TENCENT_PANE)
    if (!pane) return

    const applyOffset = () => {
      // Anchor = current pano WGS, not viewport center — wheel-zoom moves center and would change
      // dx/dy every step, making coverage lines slide vs the basemap.
      const { dx, dy } = gcjBasemapShiftLayerPixelsAt(map, anchorLat, anchorLng)
      pane.style.transform = `translate(${dx}px, ${dy}px)`
    }

    applyOffset()
    map.on('zoom move', applyOffset)
    return () => {
      map.off('zoom move', applyOffset)
      pane.style.transform = ''
    }
  }, [anchorLat, anchorLng, map])
  return null
}

function MiniTencentPmtilesLayer({
  pmtilesUrl,
  apiRef,
}: {
  pmtilesUrl: string
  apiRef: MutableRefObject<MinimapPmtilesApi | null>
}) {
  const map = useMap()
  const layerRef = useRef<L.Layer | null>(null)

  useEffect(() => {
    if (layerRef.current) return

    const LineSymbolizer = (protomapsL as unknown as { LineSymbolizer: new (o: object) => object }).LineSymbolizer
    const leafletLayer = (protomapsL as unknown as { leafletLayer: (o: object) => L.Layer }).leafletLayer

    // Match MapView `TencentLinesPmtilesLayer` paint rules (qq-map / ReAnna style).
    const lineWide = new LineSymbolizer({ width: 5, color: '#99e9f2', opacity: 0.95 })
    const lineMid = new LineSymbolizer({ width: 3, color: '#99e9f2', opacity: 0.95 })
    const lineThin = new LineSymbolizer({ width: 1, color: '#1098ad', opacity: 0.95 })

    const layer = leafletLayer({
      url: pmtilesUrl,
      pane: MINI_TENCENT_PANE,
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
    apiRef.current = layer as unknown as MinimapPmtilesApi

    const refresh = () => {
      map.invalidateSize({ animate: false })
      const proto = layer as unknown as { rerenderTiles?: () => void }
      proto.rerenderTiles?.()
    }

    map.whenReady(() => {
      refresh()
      requestAnimationFrame(refresh)
    })

    return () => {
      apiRef.current = null
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [apiRef, map, pmtilesUrl])

  return null
}

function MinimapInvalidateSize() {
  const map = useMap()
  useEffect(() => {
    let n = 0
    const run = () => {
      map.invalidateSize({ animate: false })
      if (n < 2) {
        n += 1
        requestAnimationFrame(run)
      }
    }
    requestAnimationFrame(run)
    const onResize = () => {
      map.invalidateSize({ animate: false })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [map])
  return null
}

const MINIMAP_MAX_JUMP_M = 420

function minimapClickHitsSvLine(
  api: MinimapPmtilesApi | null,
  lat: number,
  lng: number,
  brush: number,
): boolean {
  if (!api?.queryTileFeaturesDebug) return false
  const picks = api.queryTileFeaturesDebug(lng, lat, brush)
  if (!picks || picks.size === 0) return false
  for (const [, arr] of picks) {
    if (!Array.isArray(arr)) continue
    for (const raw of arr) {
      const p = raw as { layerName?: string }
      if (p.layerName === 'sv') return true
    }
  }
  return false
}

function MinimapClickToPano({
  index,
  selectedId,
  onPick,
  pmtilesApiRef,
  anchorLat,
  anchorLng,
}: {
  index: StreetviewIndex | null
  selectedId: string
  onPick: (e: StreetviewIndexEntry) => void
  pmtilesApiRef: MutableRefObject<MinimapPmtilesApi | null>
  anchorLat: number
  anchorLng: number
}) {
  const map = useMap()

  useEffect(() => {
    if (!index) return

    const handler = (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      const q = minimapQueryLatLngForSvHitTest(map, lat, lng, anchorLat, anchorLng)
      const brush = minimapPmtilesQueryBrushSize(map.getZoom())
      if (!minimapClickHitsSvLine(pmtilesApiRef.current, q.lat, q.lng, brush)) return

      const next = findNearestTencentPano(index, lat, lng)
      if (!next || next.id === selectedId) return
      const d = Math.sqrt(approxDistanceSqMeters(lat, lng, next.lat, next.lng))
      if (d > MINIMAP_MAX_JUMP_M) return
      onPick(next)
    }

    map.on('click', handler)
    return () => {
      map.off('click', handler)
    }
  }, [anchorLat, anchorLng, index, map, onPick, pmtilesApiRef, selectedId])

  return null
}

function StreetviewMinimap({
  center,
  viewYawDeg,
  index,
  selectedId,
  provider,
  onPickPano,
}: {
  /** WGS84 — matches OSM tiles / Leaflet (pano rows in index are GCJ-02, converted in parent). */
  center: { lat: number; lng: number }
  viewYawDeg: number
  index: StreetviewIndex | null
  selectedId: string
  provider: StreetviewProvider
  onPickPano: (e: StreetviewIndexEntry) => void
}) {
  const pmtilesUrl = `${import.meta.env.BASE_URL}data/lines_${provider}.pmtiles`
  const pmtilesApiRef = useRef<MinimapPmtilesApi | null>(null)

  const pegIcon = useMemo(
    () =>
      L.divIcon({
        className: 'tencent-sv-pegman-icon',
        html: buildPegmanIconHtml(normalizeDeg(viewYawDeg + MINIMAP_PEGMAN_HEADING_BIAS_DEG)),
        iconSize: [32, 46],
        iconAnchor: [16, 42],
      }),
    [viewYawDeg],
  )

  const pad = MINIMAP_GCJ_OVERSCAN_PAD

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute"
        style={{
          top: -pad,
          left: -pad,
          width: `calc(100% + ${2 * pad}px)`,
          height: `calc(100% + ${2 * pad}px)`,
        }}
      >
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={MINIMAP_DEFAULT_ZOOM}
          minZoom={MINIMAP_MIN_ZOOM}
          maxZoom={MINIMAP_MAX_ZOOM}
          zoomSnap={1}
          zoomDelta={1}
          zoomAnimation={false}
          fadeAnimation={false}
          zoomControl={false}
          attributionControl={false}
          scrollWheelZoom
          touchZoom
          boxZoom
          keyboard
          dragging
          doubleClickZoom
          className="h-full w-full rounded overflow-hidden"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MinimapInvalidateSize />
          <MiniTencentCoveragePaneSetup />
          <MiniTencentPmtilesLayer pmtilesUrl={pmtilesUrl} apiRef={pmtilesApiRef} />
          <MiniTencentCoveragePaneOffset anchorLat={center.lat} anchorLng={center.lng} />
          <MinimapPegmanPaneSetup />
          <MinimapPegmanAndFollowCenter lat={center.lat} lng={center.lng} icon={pegIcon} />
          <MinimapClickToPano
            index={index}
            selectedId={selectedId}
            onPick={onPickPano}
            pmtilesApiRef={pmtilesApiRef}
            anchorLat={center.lat}
            anchorLng={center.lng}
          />
        </MapContainer>
      </div>
    </div>
  )
}

export default function StreetviewModal({
  open,
  entry,
  index,
  provider,
  onClose,
}: {
  open: boolean
  entry: StreetviewIndexEntry | null
  index: StreetviewIndex | null
  provider: StreetviewProvider
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const viewRef = useRef<{ yaw: number; pitch: number } | null>(null)

  const [selectedEntry, setSelectedEntry] = useState<StreetviewIndexEntry | null>(entry)
  const [captureDate, setCaptureDate] = useState<string>('Unknown')
  const [viewYaw, setViewYaw] = useState<number>(entry?.h ?? 0)

  useEffect(() => {
    if (!open) return
    if (!entry) return
    const id = window.requestAnimationFrame(() => {
      const derived = entry.d || parseCaptureDateFromSvid(entry.id)
      setSelectedEntry({ ...entry, d: derived })
      setCaptureDate(formatCaptureDate(derived))
      // Always sync heading when opening / changing `entry` — don’t skip if viewRef was left from a prior session.
      viewRef.current = { yaw: entry.h ?? 0, pitch: 0 }
      setViewYaw(entry.h ?? 0)
    })
    return () => window.cancelAnimationFrame(id)
  }, [entry?.id, open])

  const adapterTuple = useMemo(
    () =>
      EquirectangularTilesAdapter.withConfig({
        showErrorTile: true,
        baseBlur: true,
        antialias: true,
      }),
    [],
  )

  // Create viewer once, then update panorama on entry/meta changes.
  useEffect(() => {
    if (!open || !selectedEntry) return
    if (!containerRef.current) return

    const pano = provider === 'baidu' ? buildBaiduTilesPanorama(selectedEntry.id) : buildTencentTilesPanorama(selectedEntry.id)
    const yaw = viewRef.current?.yaw ?? (selectedEntry.h ?? 0)
    const pitch = viewRef.current?.pitch ?? 0

    if (!viewerRef.current) {
      viewerRef.current = new Viewer({
        container: containerRef.current,
        panorama: pano,
        adapter: adapterTuple,
        navbar: false,
        keyboard: false,
        defaultYaw: `${yaw}deg`,
        defaultPitch: `${pitch}deg`,
        defaultZoomLvl: 0,
        size: { width: '100%', height: '100%' },
        // Disable transitions to avoid huge loads on navigation.
        defaultTransition: { speed: 0, rotation: false, effect: 'fade' },
      })
      const onPos = (evt: Event) => {
        const position = (evt as { position?: { yaw: number; pitch: number } }).position
        if (!position) return
        const yawDeg = psvYawToCompassDeg(position.yaw)
        const pitchDeg = psvRadiansToDeg(position.pitch)
        viewRef.current = { yaw: yawDeg, pitch: pitchDeg }
        setViewYaw(yawDeg)
      }
      viewerRef.current.addEventListener('position-updated', onPos)
    } else {
      void viewerRef.current
        .setPanorama(pano as unknown as Parameters<Viewer['setPanorama']>[0], {
          position: { yaw: `${yaw}deg`, pitch: `${pitch}deg` },
          transition: false,
          showLoader: true,
        })
        .catch(() => { })
    }
  }, [open, selectedEntry, adapterTuple])

  const onMinimapPick = useCallback((next: StreetviewIndexEntry) => {
    const date = next.d || parseCaptureDateFromSvid(next.id)
    setSelectedEntry({ ...next, d: date })
    setCaptureDate(formatCaptureDate(date))
  }, [])

  // Keep Esc to close.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Cleanup viewer on modal close/unmount.
  useEffect(() => {
    if (open) return
    if (viewerRef.current) {
      viewerRef.current.destroy()
      viewerRef.current = null
    }
    return
  }, [open])

  if (!open || !entry) return null

  return (
    <div
      className="absolute inset-0 z-1100 bg-black overflow-hidden border border-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
      role="dialog"
      aria-modal="true"
      aria-label={`${provider} street view`}
    >
      <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between gap-3 pointer-events-none">
        <div className="pointer-events-none text-xs text-white/80 bg-black/40 px-2 py-1 rounded max-w-[min(92vw,28rem)] leading-snug">
          Esc: close · Minimap: click a coverage line to jump
        </div>
        <button
          type="button"
          className="pointer-events-auto text-sm px-3 py-1 rounded bg-white/10 hover:bg-white/15 text-white/90 border border-white/15"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="absolute left-3 bottom-3 z-30 flex flex-col gap-2 pointer-events-none">
        <div className="text-[11px] text-white/90 bg-black/45 px-2 py-1 rounded pointer-events-none">
          Capture date: {captureDate}
        </div>
        <div className="pointer-events-auto relative w-[min(92vw,22rem)] h-60 rounded overflow-hidden border border-white/25 shadow-lg bg-black/50 ring-1 ring-black/30">
          {selectedEntry || entry ? (
            <StreetviewMinimap
              center={{
                lat: (selectedEntry ?? entry)!.lat,
                lng: (selectedEntry ?? entry)!.lng,
              }}
              viewYawDeg={viewYaw}
              index={index}
              selectedId={(selectedEntry ?? entry)!.id}
              provider={provider}
              onPickPano={onMinimapPick}
            />
          ) : null}
        </div>
      </div>

      <div className="absolute left-3 top-12 z-30 pointer-events-none">
        <div className="relative w-20 h-20 rounded-full border-2 border-white/65 bg-black/25">
          <div className="absolute left-1/2 top-1 -translate-x-1/2 text-white/85 text-sm font-semibold z-10">N</div>
          {/* SVG: pivot = hub (40,40) so needle stays centered on the dot; border-triangle on 0×0 box was off-center */}
          <svg className="absolute inset-0 size-full" viewBox="0 0 80 80" aria-hidden>
            <g transform={`rotate(${viewYaw} 40 40)`}>
              {/* Apex at hub; wide opening toward heading — flip of “tip at rim” so the point isn’t at the edge. */}
              <polygon points="40,40 27,11 53,11" fill="rgba(255,255,255,0.72)" />
            </g>
            <circle cx="40" cy="40" r="5" fill="rgba(255,255,255,0.65)" />
          </svg>
        </div>
      </div>
      <div ref={containerRef} className="absolute inset-0 z-0 min-h-0" />
    </div>
  )
}

