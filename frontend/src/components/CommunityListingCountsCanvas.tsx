import { useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import { useMap, useMapEvent } from 'react-leaflet'
import type { Community } from '@/lib/types'
import { clearMapLayerHover, hitTestBoxes, setMapLayerHover } from '@/lib/mapPointerCursor'

/** Match former `getCommunityListingIcon` sizing in MapView (visual parity). */
function badgeLayout(count: number): { h: number; fs: number; padX: number; w: number } {
  const tier =
    count > 99
      ? { h: 30, fs: 12, padX: 8 }
      : count > 50
        ? { h: 24, fs: 11, padX: 7 }
        : count > 20
          ? { h: 20, fs: 10, padX: 6 }
          : { h: 16, fs: 9, padX: 5 }
  const { h, fs, padX } = tier
  const digits = String(count).length
  const textW = Math.ceil(fs * (0.58 * digits + 0.12))
  const w = Math.max(h + padX * 2, textW + padX * 2 + 2)
  return { h, fs, padX, w }
}

/** Match former `CircleMarker` radii from `CommunityMarkerItem`. */
function dotRadius(displayCount: number, isSelected: boolean): number {
  const r = displayCount > 99 ? 5 : displayCount > 30 ? 4 : 3
  return r + (isSelected ? 1.5 : 0)
}

type HitRegion = {
  comm: Community
  left: number
  top: number
  right: number
  bottom: number
}

export type CommunityCountCanvasItem = {
  comm: Community
  displayCount: number
  isSelected: boolean
  /** Opened this browser session while `listingCount` matched the stored snapshot (see store). */
  isSessionViewed?: boolean
}

/** Lower = drawn earlier (underneath). Selected stays on top for hit-testing. */
function communityMarkerDrawRank(it: CommunityCountCanvasItem): number {
  if (it.isSelected) return 2
  if (it.isSessionViewed) return 1
  return 0
}

export type CommunityMarkersCanvasVariant = 'dots' | 'counts'

/**
 * Draw a pill path; `roundRect` is missing in some browsers (would otherwise fail silently mid-draw).
 */
function pillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr)
    return
  }
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
}

/**
 * All Anjuke community markers on one canvas:
 * - `dots`: zoomed out — filled circles (replaces hundreds of `CircleMarker` SVG paths).
 * - `counts`: zoomed in — listing count pills.
 *
 * Attached to `map.getContainer()` so `latLngToContainerPoint` matches 1:1.
 */
export default function CommunityListingCountsCanvas({
  variant,
  items,
  onSelect,
}: {
  variant: CommunityMarkersCanvasVariant
  items: CommunityCountCanvasItem[]
  onSelect: (c: Community) => void
}) {
  const map = useMap()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Avoid resetting canvas backing store every pan frame — huge perf win. */
  const layoutRef = useRef({ cssW: -1, cssH: -1, dpr: 0 })
  const itemsRef = useRef(items)
  itemsRef.current = items
  const variantRef = useRef(variant)
  variantRef.current = variant

  const hitsRef = useRef<HitRegion[]>([])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const list = itemsRef.current
    const mode = variantRef.current
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

    const sorted = [...list].sort(
      (a, b) => communityMarkerDrawRank(a) - communityMarkerDrawRank(b),
    )

    const hits: HitRegion[] = []
    const padHit = 4

    if (mode === 'dots') {
      for (const { comm, displayCount, isSelected, isSessionViewed } of sorted) {
        const pt = map.latLngToContainerPoint(L.latLng(comm.lat, comm.lng))
        if (pt.x < -80 || pt.y < -80 || pt.x > cssW + 80 || pt.y > cssH + 80) {
          continue
        }

        const R = dotRadius(displayCount, isSelected)
        hits.push({
          comm,
          left: pt.x - R - padHit,
          top: pt.y - R - padHit,
          right: pt.x + R + padHit,
          bottom: pt.y + R + padHit,
        })

        ctx.save()
        ctx.globalAlpha = 0.92
        if (isSessionViewed && !isSelected) {
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, R + 2.2, 0, Math.PI * 2)
          ctx.strokeStyle = '#22c55e'
          ctx.lineWidth = 2
          ctx.stroke()
        }
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, R, 0, Math.PI * 2)
        ctx.fillStyle = '#000000'
        ctx.fill()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = isSelected ? 3 : 1.5
        ctx.stroke()
        ctx.restore()
      }
    } else {
      for (const { comm, displayCount, isSelected, isSessionViewed } of sorted) {
        const pt = map.latLngToContainerPoint(L.latLng(comm.lat, comm.lng))
        if (pt.x < -200 || pt.y < -200 || pt.x > cssW + 200 || pt.y > cssH + 200) {
          continue
        }

        const { w, h, fs } = badgeLayout(displayCount)
        const x = pt.x - w / 2
        const y = pt.y - h / 2
        const r = h / 2

        hits.push({
          comm,
          left: x - padHit,
          top: y - padHit,
          right: x + w + padHit,
          bottom: y + h + padHit,
        })

        ctx.save()
        ctx.globalAlpha = 0.95

        if (isSelected) {
          ctx.shadowColor = 'rgba(15, 23, 42, 0.4)'
          ctx.shadowBlur = 6
          ctx.shadowOffsetY = 2
        } else {
          ctx.shadowColor = 'rgba(15, 23, 42, 0.35)'
          ctx.shadowBlur = 2
          ctx.shadowOffsetY = 1
        }

        ctx.beginPath()
        pillPath(ctx, x, y, w, h, r)

        ctx.fillStyle = '#0f172a'
        ctx.fill()

        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetY = 0

        const viewedAccent = isSessionViewed && !isSelected
        ctx.strokeStyle = isSelected
          ? '#ffffff'
          : viewedAccent
            ? '#22c55e'
            : 'rgba(248,250,252,0.9)'
        ctx.lineWidth = isSelected ? 2 : viewedAccent ? 2 : 1
        ctx.stroke()

        ctx.fillStyle = '#f1f5f9'
        ctx.font = `700 ${fs}px "Lexend Zetta", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(displayCount), pt.x, pt.y + 0.5)

        ctx.restore()
      }
    }

    hitsRef.current = hits
  }, [map])

  useEffect(() => {
    const container = map.getContainer()
    if (!container) return

    const wrapper = document.createElement('div')
    wrapper.className = 'leaflet-layer guamap-community-counts-canvas-wrap'
    wrapper.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:620;overflow:hidden;'
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
  }, [items, variant, redraw])

  useMapEvent('click', (e) => {
    const p = e.containerPoint
    const hits = hitsRef.current
    for (let i = hits.length - 1; i >= 0; i--) {
      const r = hits[i]!
      if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) {
        L.DomEvent.stopPropagation(e.originalEvent)
        onSelect(r.comm)
        return
      }
    }
  })

  useMapEvent('mousemove', (e) => {
    const hit = hitTestBoxes(hitsRef.current, e.containerPoint.x, e.containerPoint.y)
    setMapLayerHover(map, 'community', hit != null)
  })

  useMapEvent('mouseout', () => {
    clearMapLayerHover(map, 'community')
  })

  return null
}
