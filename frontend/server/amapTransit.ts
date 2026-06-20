import { gcj02ToWgs84, wgs84ToGcj02 } from './gcj'
import { countRouteTransfers } from '../src/lib/transitRouteMetrics'

export const GUANGZHOU_CITYCODE = '020'
export const TRANSIT_URL = 'https://restapi.amap.com/v3/direction/transit/integrated'
export const MAX_ALTERNATE_ROUTES = 5

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

export type TransitRouteRequest = {
  originLat: number
  originLng: number
  destLat: number
  destLng: number
  date: string
  time: string
}

export type TransitRouteResponse = {
  cached: boolean
  routes: TransitRoutePlan[]
  error?: string
}

function intVal(value: unknown): number {
  if (value == null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : 0
}

function isMetroLineName(name: string): boolean {
  return name.includes('地铁') || name.includes('轻轨')
}

function isTramLine(name: string, typeHint: string): boolean {
  return (
    typeHint.includes('有轨') ||
    typeHint.toLowerCase().includes('tram') ||
    name.includes('有轨')
  )
}

function transitLegKindFromLine(name: string, typeHint?: string): TransitLegKind {
  const t = typeHint ?? ''
  if (isTramLine(name, t)) return 'tram'
  if (t.includes('地铁') || isMetroLineName(name)) return 'metro'
  return 'bus'
}

/** Amap polyline is GCJ "lng,lat;lng,lat" → Leaflet [lat,lng][] in WGS84. */
export function parseAmapPolyline(polyline: string | undefined): [number, number][] {
  if (!polyline) return []
  const out: [number, number][] = []
  for (const pair of polyline.split(';')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const parts = trimmed.split(',')
    if (parts.length < 2) continue
    const lng = parseFloat(parts[0])
    const lat = parseFloat(parts[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const wgs = gcj02ToWgs84(lat, lng)
    out.push([wgs.lat, wgs.lng])
  }
  return out
}

function mergeLegCoordinates(chunks: [number, number][][]): [number, number][] {
  const merged: [number, number][] = []
  for (const chunk of chunks) {
    for (const pt of chunk) {
      const prev = merged[merged.length - 1]
      if (prev && prev[0] === pt[0] && prev[1] === pt[1]) continue
      merged.push(pt)
    }
  }
  return merged
}

function parseWalkingSegment(walking: Record<string, unknown>): {
  segments: TransitRouteSegment[]
  legs: TransitRouteLeg[]
} {
  const segments: TransitRouteSegment[] = []
  const legs: TransitRouteLeg[] = []
  const durSec = intVal(walking.duration)
  const distM = intVal(walking.distance)
  const steps = (walking.steps as Record<string, unknown>[] | undefined) ?? []
  const coordChunks: [number, number][][] = []

  for (const step of steps) {
    const pts = parseAmapPolyline(step.polyline as string | undefined)
    if (pts.length) coordChunks.push(pts)
  }

  if (durSec >= 30 || distM > 0 || coordChunks.length) {
    segments.push({
      kind: 'walking',
      durationMin: Math.max(1, Math.round(durSec / 60)),
      distanceM: distM || undefined,
    })
    const coords = mergeLegCoordinates(coordChunks)
    if (coords.length >= 2) {
      legs.push({ kind: 'walking', coordinates: coords })
    }
  }

  return { segments, legs }
}

function parseBusSegment(busInfo: Record<string, unknown>): {
  segments: TransitRouteSegment[]
  legs: TransitRouteLeg[]
} {
  const segments: TransitRouteSegment[] = []
  const legs: TransitRouteLeg[] = []
  const buslines = (busInfo.buslines as Record<string, unknown>[] | undefined) ?? []
  if (!buslines.length) return { segments, legs }

  const bl = buslines.reduce((best, cur) => {
    const bd = intVal(cur.duration)
    const ad = intVal(best.duration)
    if (!ad) return cur
    if (!bd) return best
    return bd < ad ? cur : best
  })

  const durSec = intVal(bl.duration)
  const name = String(bl.name ?? '').split('(')[0].trim()
  const typeHint = String(bl.type ?? '')
  const kind = transitLegKindFromLine(name, typeHint)
  const dep = bl.departure_stop as Record<string, unknown> | undefined
  const arr = bl.arrival_stop as Record<string, unknown> | undefined
  const via = intVal(bl.via_num)
  const coords = parseAmapPolyline(bl.polyline as string | undefined)

  if (durSec > 0 || coords.length >= 2) {
    segments.push({
      kind,
      durationMin: Math.max(1, Math.round(durSec / 60)),
      line: name || undefined,
      from: dep?.name ? String(dep.name) : undefined,
      to: arr?.name ? String(arr.name) : undefined,
      stops: via || undefined,
    })
    if (coords.length >= 2) {
      legs.push({ kind, coordinates: coords, line: name || undefined })
    }
  }

  return { segments, legs }
}

function parseRailwaySegment(railway: Record<string, unknown>): {
  segments: TransitRouteSegment[]
  legs: TransitRouteLeg[]
} {
  const segments: TransitRouteSegment[] = []
  const legs: TransitRouteLeg[] = []
  const durSec = intVal(railway.time)
  const name = String(railway.name ?? 'train')
  const coords = parseAmapPolyline(railway.polyline as string | undefined)

  if (durSec >= 60 || coords.length >= 2) {
    segments.push({
      kind: 'railway',
      durationMin: Math.max(1, Math.round(durSec / 60)),
      line: name,
    })
    if (coords.length >= 2) {
      legs.push({ kind: 'railway', coordinates: coords })
    }
  }

  return { segments, legs }
}

function parseTransitPlan(transit: Record<string, unknown>, index: number): TransitRoutePlan | null {
  const durSec = intVal(transit.duration)
  if (durSec <= 0) return null

  const segments: TransitRouteSegment[] = []
  const legs: TransitRouteLeg[] = []
  const rawSegments = (transit.segments as Record<string, unknown>[] | undefined) ?? []

  for (const seg of rawSegments) {
    const walking = seg.walking as Record<string, unknown> | undefined
    if (walking && Object.keys(walking).length) {
      const parsed = parseWalkingSegment(walking)
      segments.push(...parsed.segments)
      legs.push(...parsed.legs)
    }

    const bus = seg.bus as Record<string, unknown> | undefined
    if (bus && (bus.buslines as unknown[] | undefined)?.length) {
      const parsed = parseBusSegment(bus)
      segments.push(...parsed.segments)
      legs.push(...parsed.legs)
    }

    const railway = seg.railway as Record<string, unknown> | undefined
    if (railway && Object.keys(railway).length) {
      const parsed = parseRailwaySegment(railway)
      segments.push(...parsed.segments)
      legs.push(...parsed.legs)
    }
  }

  return {
    index,
    durationMin: Math.round((durSec / 60) * 10) / 10,
    cost: Number(transit.cost) || 0,
    walkingDistanceM: intVal(transit.walking_distance),
    numTransfers: countRouteTransfers(segments),
    segments,
    legs,
  }
}

export function buildCacheKey(req: TransitRouteRequest): string {
  const r = (n: number) => n.toFixed(5)
  const time = req.time.replace(':', '')
  return `${r(req.originLat)}_${r(req.originLng)}_${r(req.destLat)}_${r(req.destLng)}_${req.date}_${time}`
}

export async function fetchAmapTransitRoutes(
  amapKey: string,
  req: TransitRouteRequest,
  maxRoutes = MAX_ALTERNATE_ROUTES,
): Promise<TransitRouteResponse> {
  if (!amapKey) {
    return { cached: false, routes: [], error: 'Transit routing is not configured (missing AMAP_KEY).' }
  }

  const origin = wgs84ToGcj02(req.originLat, req.originLng)
  const dest = wgs84ToGcj02(req.destLat, req.destLng)

  const params = new URLSearchParams({
    key: amapKey,
    origin: `${origin.lng},${origin.lat}`,
    destination: `${dest.lng},${dest.lat}`,
    city: GUANGZHOU_CITYCODE,
    date: req.date,
    time: req.time,
    output: 'json',
    strategy: '0',
  })

  let body: Record<string, unknown>
  try {
    const resp = await fetch(`${TRANSIT_URL}?${params}`)
    body = (await resp.json()) as Record<string, unknown>
  } catch {
    return { cached: false, routes: [], error: 'Could not reach Amap routing service.' }
  }

  if (body.status !== '1') {
    const info = String(body.info ?? 'Unknown error')
    return { cached: false, routes: [], error: info }
  }

  const route = (body.route as Record<string, unknown> | undefined) ?? {}
  const transits = (route.transits as Record<string, unknown>[] | undefined) ?? []
  if (!transits.length) {
    return { cached: false, routes: [], error: 'No public transit route found.' }
  }

  const sorted = [...transits].sort(
    (a, b) => intVal(a.duration) - intVal(b.duration),
  )

  const routes: TransitRoutePlan[] = []
  for (let i = 0; i < Math.min(maxRoutes, sorted.length); i++) {
    const plan = parseTransitPlan(sorted[i], i)
    if (plan && plan.legs.length) routes.push(plan)
  }

  if (!routes.length) {
    return { cached: false, routes: [], error: 'No drawable route geometry returned.' }
  }

  return { cached: false, routes }
}
