import type { Map as LeafletMap } from 'leaflet'

/** Higher index = wins when multiple layers hover. */
const LAYER_PRIORITY = ['streetview', 'saved', 'stop', 'community'] as const

export type MapHoverLayer = (typeof LAYER_PRIORITY)[number]

const hoverByLayer = new Map<MapHoverLayer, boolean>()
let cursorOverride: string | null = null

export function setMapCursorOverride(cursor: string | null) {
  cursorOverride = cursor
}

export function setMapLayerHover(map: LeafletMap, layer: MapHoverLayer, active: boolean) {
  if (active) {
    hoverByLayer.set(layer, true)
  } else {
    hoverByLayer.delete(layer)
  }
  applyMapContainerCursor(map)
}

export function clearMapLayerHover(map: LeafletMap, layer: MapHoverLayer) {
  hoverByLayer.delete(layer)
  applyMapContainerCursor(map)
}

export function syncMapContainerCursor(map: LeafletMap) {
  applyMapContainerCursor(map)
}

function applyMapContainerCursor(map: LeafletMap) {
  const container = map.getContainer()
  if (cursorOverride) {
    container.style.cursor = cursorOverride
    return
  }
  for (let i = LAYER_PRIORITY.length - 1; i >= 0; i--) {
    const layer = LAYER_PRIORITY[i]!
    if (hoverByLayer.get(layer)) {
      container.style.cursor = 'pointer'
      return
    }
  }
  container.style.cursor = ''
}

export type HitBox = {
  left: number
  top: number
  right: number
  bottom: number
}

export function hitTestBoxes<T extends HitBox>(boxes: T[], x: number, y: number): T | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return b
  }
  return null
}
