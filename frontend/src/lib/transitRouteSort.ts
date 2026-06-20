import type { TransitRoutePlan } from './transitRouteTypes'

export type TransitRouteSortMode = 'fastest' | 'leastWalking' | 'leastTransfers'

export const TRANSIT_ROUTE_SORT_OPTIONS: { id: TransitRouteSortMode; label: string }[] = [
  { id: 'fastest', label: 'Fastest' },
  { id: 'leastWalking', label: 'Less walking' },
  { id: 'leastTransfers', label: 'Fewest transfers' },
]

export function sortTransitRoutes(
  routes: TransitRoutePlan[],
  mode: TransitRouteSortMode,
): TransitRoutePlan[] {
  const copy = [...routes]
  switch (mode) {
    case 'leastWalking':
      return copy.sort(
        (a, b) =>
          a.walkingDistanceM - b.walkingDistanceM ||
          a.durationMin - b.durationMin,
      )
    case 'leastTransfers':
      return copy.sort(
        (a, b) =>
          a.numTransfers - b.numTransfers ||
          a.durationMin - b.durationMin,
      )
    case 'fastest':
    default:
      return copy.sort((a, b) => a.durationMin - b.durationMin)
  }
}

export function findTransitRoute(
  routes: TransitRoutePlan[] | null | undefined,
  routeIndex: number,
): TransitRoutePlan | null {
  if (!routes?.length) return null
  return routes.find((r) => r.index === routeIndex) ?? routes[0] ?? null
}
