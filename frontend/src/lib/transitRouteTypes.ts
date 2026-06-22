export type TransitLegKind = 'walking' | 'bus' | 'metro' | 'railway' | 'tram'

export type TransitRouteLeg = {
  kind: TransitLegKind
  coordinates: [number, number][]
  /** Amap buslines[].name (e.g. 地铁3号线) — used for metro line colors. */
  line?: string
}

export type TransitRouteSegment = {
  kind: TransitLegKind
  durationMin: number
  line?: string
  from?: string
  to?: string
  stops?: number
  distanceM?: number
}

export type TransitRoutePlan = {
  index: number
  durationMin: number
  cost: number
  walkingDistanceM: number
  numTransfers: number
  segments: TransitRouteSegment[]
  legs: TransitRouteLeg[]
}

export type TransitRouteResponse = {
  cached: boolean
  routes: TransitRoutePlan[]
  error?: string
}

export type TransitMapPoint = {
  lat: number
  lng: number
  label: string
}

export const TRANSIT_LEG_STYLES: Record<
  TransitLegKind,
  { color: string; weight: number; opacity: number; dashArray?: string; outlineColor?: string }
> = {
  walking: {
    color: '#67e8f9',
    outlineColor: '#0e7490',
    weight: 5,
    opacity: 0.92,
    dashArray: '8 6',
  },
  bus: { color: '#2563eb', weight: 5, opacity: 0.92 },
  metro: { color: '#ea580c', weight: 6, opacity: 0.95 },
  railway: { color: '#7c3aed', weight: 5, opacity: 0.92 },
  tram: { color: '#0d9488', weight: 5, opacity: 0.92 },
}

export function defaultDepartDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function defaultDepartTime(): string {
  return '10:00'
}

export function segmentKindLabel(kind: TransitLegKind): string {
  switch (kind) {
    case 'walking':
      return 'Walk'
    case 'bus':
      return 'Bus'
    case 'metro':
      return 'Metro'
    case 'railway':
      return 'Train'
    case 'tram':
      return 'Tram'
  }
}

export function segmentKindEmoji(kind: TransitLegKind): string {
  switch (kind) {
    case 'walking':
      return '🚶'
    case 'bus':
      return '🚌'
    case 'metro':
      return '🚇'
    case 'railway':
      return '🚆'
    case 'tram':
      return '🚊'
  }
}
