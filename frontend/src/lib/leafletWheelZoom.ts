import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

/**
 * Longer debounce merges a trackpad flick into one burst (Leaflet default 40ms fires many).
 * Native wheelPxPerZoomLevel / sigmoid trigger sensitivity stay default.
 */
const WHEEL_DEBOUNCE_MS = 220
/** Max integer zoom levels per debounced burst (sigmoid alone can apply ~4). */
const WHEEL_MAX_LEVELS_PER_BURST = 1

type ScrollWheelHandler = L.Handler & {
  _delta: number
  _lastMousePos: L.Point
  _startTime: number | null
  _performZoom: () => void
  _tunedBurstCap?: boolean
}

/**
 * Integer-zoom-safe wheel tuning: native trigger/debounce timing (extended debounce only),
 * capped distance per burst. Requires zoomSnap=1 on the map for clean raster tiles.
 */
export function LeafletTunedWheelZoom() {
  const map = useMap()

  useEffect(() => {
    map.options.wheelDebounceTime = WHEEL_DEBOUNCE_MS

    const handler = map.scrollWheelZoom as ScrollWheelHandler
    if (handler._tunedBurstCap) return

    handler._performZoom = function () {
      const h = this as ScrollWheelHandler
      const zoom = map.getZoom()
      const snap = map.options.zoomSnap || 0

      map.stop()

      const d2 = h._delta / ((map.options.wheelPxPerZoomLevel ?? 60) * 4)
      const d3 = (4 * Math.log(2 / (1 + Math.exp(-Math.abs(d2)))) / Math.LN2)
      const cappedD3 = Math.min(d3, WHEEL_MAX_LEVELS_PER_BURST)
      const d4 = snap ? Math.ceil(cappedD3 / snap) * snap : cappedD3
      const target = Math.min(
        map.getMaxZoom(),
        Math.max(map.getMinZoom(), zoom + (h._delta > 0 ? d4 : -d4)),
      )
      const delta = target - zoom

      h._delta = 0
      h._startTime = null

      if (!delta) return

      if (map.options.scrollWheelZoom === 'center') {
        map.setZoom(zoom + delta)
      } else {
        map.setZoomAround(h._lastMousePos, zoom + delta)
      }
    }

    handler._tunedBurstCap = true
  }, [map])

  return null
}
