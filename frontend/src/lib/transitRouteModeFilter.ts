import type { TransitLegKind, TransitRoutePlan } from './transitRouteTypes'

export type TransitModeFilter = 'metro' | 'bus' | 'tram'

export const TRANSIT_MODE_FILTER_OPTIONS: { id: TransitModeFilter; label: string }[] = [
  { id: 'metro', label: 'Metro' },
  { id: 'bus', label: 'Bus' },
  { id: 'tram', label: 'Tram' },
]

const MODE_TO_KINDS: Record<TransitModeFilter, TransitLegKind[]> = {
  metro: ['metro'],
  bus: ['bus'],
  tram: ['tram'],
}

export function routeUsesTransitMode(route: TransitRoutePlan, mode: TransitModeFilter): boolean {
  const kinds = new Set(route.segments.map((s) => s.kind))
  return MODE_TO_KINDS[mode].some((k) => kinds.has(k))
}

/** Drop routes that use any excluded mode (walking is never filtered). */
export function filterRoutesByExcludedModes(
  routes: TransitRoutePlan[],
  excluded: ReadonlySet<TransitModeFilter>,
): TransitRoutePlan[] {
  if (excluded.size === 0) return routes
  return routes.filter(
    (route) => !Array.from(excluded).some((mode) => routeUsesTransitMode(route, mode)),
  )
}
