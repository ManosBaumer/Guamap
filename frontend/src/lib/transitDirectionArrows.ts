import type { TransitRouteLeg } from './transitRouteTypes'
import type { Map as LeafletMap } from 'leaflet'

export type DirectionArrowPlacement = {
  key: string
  lat: number
  lng: number
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const φ1 = (a[0] * Math.PI) / 180
  const φ2 = (b[0] * Math.PI) / 180
  const Δφ = ((b[0] - a[0]) * Math.PI) / 180
  const Δλ = ((b[1] - a[1]) * Math.PI) / 180
  const x =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/** Screen-space bearing (deg) so arrows align with the map at the current zoom. */
export function screenBearingDeg(
  map: LeafletMap,
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const p1 = map.latLngToContainerPoint([fromLat, fromLng])
  const p2 = map.latLngToContainerPoint([toLat, toLng])
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  if (dx * dx + dy * dy < 0.25) return 0
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

function sampleAlongPolyline(
  coords: [number, number][],
  maxArrows: number,
): DirectionArrowPlacement[] {
  if (coords.length < 2) return []

  const segLens: number[] = []
  let total = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const len = haversineM(coords[i]!, coords[i + 1]!)
    segLens.push(len)
    total += len
  }

  if (total < 80) return []

  const count = Math.min(maxArrows, Math.max(2, Math.floor(total / 250)))
  const placements: DirectionArrowPlacement[] = []

  for (let a = 1; a <= count; a++) {
    const target = (a / (count + 1)) * total
    let acc = 0
    for (let i = 0; i < segLens.length; i++) {
      const segLen = segLens[i]!
      if (segLen < 8) {
        acc += segLen
        continue
      }
      if (acc + segLen >= target) {
        const t = Math.max(0.15, Math.min(0.85, (target - acc) / segLen))
        const [lat1, lng1] = coords[i]!
        const [lat2, lng2] = coords[i + 1]!
        placements.push({
          key: `s-${a}`,
          lat: lat1 + (lat2 - lat1) * t,
          lng: lng1 + (lng2 - lng1) * t,
          fromLat: lat1,
          fromLng: lng1,
          toLat: lat2,
          toLng: lng2,
        })
        break
      }
      acc += segLen
    }
  }

  return placements
}

export function directionArrowPlacementsForLeg(
  leg: TransitRouteLeg,
  legKey: string,
): DirectionArrowPlacement[] {
  if (leg.kind === 'walking') return []
  return sampleAlongPolyline(leg.coordinates, 6).map((p) => ({
    ...p,
    key: `${legKey}-${p.key}`,
  }))
}
