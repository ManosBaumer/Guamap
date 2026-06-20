import { useCallback, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useStore } from '@/lib/store'

/** Above community count canvas (620) — same container stacking as listing pills. */
const Z_INDEX = 650
const DOT_R = 7

type Endpoint = { lat: number; lng: number }

function drawEndpoint(ctx: CanvasRenderingContext2D, pt: L.Point, fill: string) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1
  ctx.beginPath()
  ctx.arc(pt.x, pt.y, DOT_R, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

export function TransitRouteEndpointCanvas() {
  const map = useMap()
  const origin = useStore((s) => s.transitOrigin)
  const destination = useStore((s) => s.transitDestination)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layoutRef = useRef({ cssW: -1, cssH: -1, dpr: 0 })
  const endpointsRef = useRef<{ origin: Endpoint | null; destination: Endpoint | null }>({
    origin: null,
    destination: null,
  })
  endpointsRef.current = { origin, destination }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { origin: o, destination: d } = endpointsRef.current
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

    if (o) {
      const pt = map.latLngToContainerPoint(L.latLng(o.lat, o.lng))
      if (pt.x >= -20 && pt.y >= -20 && pt.x <= cssW + 20 && pt.y <= cssH + 20) {
        drawEndpoint(ctx, pt, '#059669')
      }
    }
    if (d) {
      const pt = map.latLngToContainerPoint(L.latLng(d.lat, d.lng))
      if (pt.x >= -20 && pt.y >= -20 && pt.x <= cssW + 20 && pt.y <= cssH + 20) {
        drawEndpoint(ctx, pt, '#e11d48')
      }
    }
  }, [map])

  useEffect(() => {
    const container = map.getContainer()
    if (!container) return

    const wrapper = document.createElement('div')
    wrapper.className = 'leaflet-layer guamap-transit-endpoints-canvas-wrap'
    wrapper.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${Z_INDEX};overflow:hidden;`
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
      layoutRef.current = { cssW: -1, cssH: -1, dpr: 0 }
    }
  }, [map, redraw])

  useEffect(() => {
    redraw()
  }, [origin, destination, redraw])

  return null
}
