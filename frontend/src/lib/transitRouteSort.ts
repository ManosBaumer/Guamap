import type { TransitRoutePlan } from './transitRouteTypes'

export type TransitRouteSortMode =
  | 'recommended'
  | 'fastest'
  | 'cheapest'
  | 'leastWalking'
  | 'leastTransfers'

export const TRANSIT_ROUTE_SORT_OPTIONS: { id: TransitRouteSortMode; label: string }[] = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'leastWalking', label: 'Less walking' },
  { id: 'leastTransfers', label: 'Fewest transfers' },
]

type RouteNormStats = {
  minDuration: number
  maxDuration: number
  minCost: number
  maxCost: number
  minWalking: number
  maxWalking: number
  minTransfers: number
  maxTransfers: number
}

function routeNormStats(routes: TransitRoutePlan[]): RouteNormStats {
  return {
    minDuration: Math.min(...routes.map((r) => r.durationMin)),
    maxDuration: Math.max(...routes.map((r) => r.durationMin)),
    minCost: Math.min(...routes.map((r) => r.cost)),
    maxCost: Math.max(...routes.map((r) => r.cost)),
    minWalking: Math.min(...routes.map((r) => r.walkingDistanceM)),
    maxWalking: Math.max(...routes.map((r) => r.walkingDistanceM)),
    minTransfers: Math.min(...routes.map((r) => r.numTransfers)),
    maxTransfers: Math.max(...routes.map((r) => r.numTransfers)),
  }
}

function norm(value: number, min: number, max: number): number {
  const range = max - min
  return range > 0 ? (value - min) / range : 0
}

/** Lower is better — balances time, transfers, walking, and cost within a route set. */
export function recommendationScore(route: TransitRoutePlan, stats: RouteNormStats): number {
  return (
    norm(route.durationMin, stats.minDuration, stats.maxDuration) * 0.4 +
    norm(route.numTransfers, stats.minTransfers, stats.maxTransfers) * 0.25 +
    norm(route.walkingDistanceM, stats.minWalking, stats.maxWalking) * 0.2 +
    norm(route.cost, stats.minCost, stats.maxCost) * 0.15
  )
}

export function pickRecommendedRoute(routes: TransitRoutePlan[]): TransitRoutePlan {
  if (!routes.length) throw new Error('pickRecommendedRoute requires at least one route')
  if (routes.length === 1) return routes[0]

  const stats = routeNormStats(routes)
  return [...routes].sort((a, b) => {
    const diff = recommendationScore(a, stats) - recommendationScore(b, stats)
    return diff !== 0 ? diff : a.durationMin - b.durationMin || a.index - b.index
  })[0]
}

function compareRecommended(a: TransitRoutePlan, b: TransitRoutePlan, stats: RouteNormStats): number {
  const diff = recommendationScore(a, stats) - recommendationScore(b, stats)
  return diff !== 0 ? diff : a.durationMin - b.durationMin || a.index - b.index
}

export function sortTransitRoutes(
  routes: TransitRoutePlan[],
  mode: TransitRouteSortMode,
): TransitRoutePlan[] {
  const copy = [...routes]
  switch (mode) {
    case 'recommended': {
      const stats = routeNormStats(copy)
      return copy.sort((a, b) => compareRecommended(a, b, stats))
    }
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
    case 'cheapest':
      return copy.sort(
        (a, b) =>
          a.cost - b.cost ||
          a.durationMin - b.durationMin,
      )
    case 'fastest':
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
