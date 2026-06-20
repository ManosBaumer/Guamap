import { useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import { useMap, useMapEvent } from 'react-leaflet'
import type { Stop } from '@/lib/types'
import { parseStopLinesField } from '@/lib/stopLinesApi'
import { stopPopupLinesHtml } from '@/lib/stopLinesPopup'
import {
  closeStopMapPopup,
  openStopMapPopup,
} from '@/lib/stopMapPopup'
import { clearMapLayerHover, hitTestBoxes, setMapLayerHover } from '@/lib/mapPointerCursor'

/** Match former `emojiStopDivIcon`: 26×26, 17px emoji. */
const STOP_ICON_PX = 26
const STOP_FONT_PX = 17
const HIT_HALF = STOP_ICON_PX / 2

const METRO_GLYPH = 'Ⓜ️'
const BUS_GLYPH = '🚌'

/**
 * Canvas layer for metro/bus stops — same emoji look as DivIcon markers, one draw pass.
 * Attached to `map.getContainer()` so coordinates match `latLngToContainerPoint`.
 * z-index below community count canvas (620) so listing pills stay clickable on top.
 */
export default function TransitStopsCanvas({ stops }: { stops: Stop[] }) {
  const map = useMap()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layoutRef = useRef({ cssW: -1, cssH: -1, dpr: 0 })
  const stopsRef = useRef(stops)
  stopsRef.current = stops

  type Hit = { stop: Stop; left: number; top: number; right: number; bottom: number }
  const hitsRef = useRef<Hit[]>([])

  useEffect(() => () => closeStopMapPopup(), [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const list = stopsRef.current
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    const cssW = size.x
    const cssH = size.y
    const lay = layoutRef.current
    if (lay.cssW !== cssW || lay.cssH !== cssH || lay.dpr !== dpr) {
      lay.cssW = cssW
      lay.cssH = cssH
      lay.dpr = dpr
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      canvas.width = Math.max(1, Math.floor(cssW * dpr))
      canvas.height = Math.max(1, Math.floor(cssH * dpr))
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, cssW, cssH)

    ctx.font = `${STOP_FONT_PX}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const hits: Hit[] = []

    for (const stop of list) {
      const pt = map.latLngToContainerPoint(L.latLng(stop.lat, stop.lon))
      if (pt.x < -40 || pt.y < -40 || pt.x > cssW + 40 || pt.y > cssH + 40) continue

      const glyph = stop.type === 'metro' ? METRO_GLYPH : BUS_GLYPH

      hits.push({
        stop,
        left: pt.x - HIT_HALF,
        top: pt.y - HIT_HALF,
        right: pt.x + HIT_HALF,
        bottom: pt.y + HIT_HALF,
      })

      ctx.save()
      if (stop.type === 'metro') {
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = 2
        ctx.shadowOffsetY = 1
      }
      ctx.fillText(glyph, pt.x, pt.y + 0.5)
      ctx.restore()
    }

    hitsRef.current = hits
  }, [map])

  useEffect(() => {
    const container = map.getContainer()
    if (!container) return

    const wrapper = document.createElement('div')
    wrapper.className = 'leaflet-layer guamap-transit-stops-canvas-wrap'
    wrapper.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:580;overflow:hidden;'
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;pointer-events:none;width:100%;height:100%;'
    wrapper.appendChild(canvas)
    container.appendChild(wrapper)

    canvasRef.current = canvas

    const onChange = () => redraw()
    let moveRaf = 0
    const onMove = () => {
      if (moveRaf) return
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0
        redraw()
      })
    }

    map.on('moveend zoomend resize viewreset', onChange)
    map.on('move zoom', onMove)
    redraw()

    return () => {
      map.off('moveend zoomend resize viewreset', onChange)
      map.off('move zoom', onMove)
      if (moveRaf) cancelAnimationFrame(moveRaf)
      container.removeChild(wrapper)
      canvasRef.current = null
      hitsRef.current = []
      layoutRef.current = { cssW: -1, cssH: -1, dpr: 0 }
    }
  }, [map, redraw])

  useEffect(() => {
    redraw()
  }, [stops, redraw])

  useMapEvent('click', (e) => {
    const p = e.containerPoint
    const hits = hitsRef.current
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i]!
      if (p.x >= h.left && p.x <= h.right && p.y >= h.top && p.y <= h.bottom) {
        L.DomEvent.stopPropagation(e.originalEvent)
        const stop = h.stop
        const isMetro = stop.type === 'metro'
        const lines = parseStopLinesField(stop.lines)

        openStopMapPopup(
          map,
          stop.lat,
          stop.lon,
          stopPopupLinesHtml(
            stop.name,
            lines.length ? lines : null,
            isMetro,
            lines.length ? undefined : 'Line data currently unavailable.',
          ),
        )
        return
      }
    }
  })

  useMapEvent('mousemove', (e) => {
    const hit = hitTestBoxes(hitsRef.current, e.containerPoint.x, e.containerPoint.y)
    setMapLayerHover(map, 'stop', hit != null)
  })

  useMapEvent('mouseout', () => {
    clearMapLayerHover(map, 'stop')
  })

  return null
}
