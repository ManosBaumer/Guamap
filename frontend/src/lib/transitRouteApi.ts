import type { TransitRoutePlan, TransitRouteResponse } from './transitRouteTypes'
import { countRouteTransfers } from './transitRouteMetrics'

export type FetchTransitRoutesParams = {
  originLat: number
  originLng: number
  destLat: number
  destLng: number
  date: string
  time: string
}

function normalizeRoute(route: TransitRoutePlan): TransitRoutePlan {
  return {
    ...route,
    numTransfers: countRouteTransfers(route.segments),
  }
}

export async function fetchTransitRoutes(
  params: FetchTransitRoutesParams,
): Promise<TransitRouteResponse> {
  const res = await fetch('/api/transit-route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const body = (await res.json()) as TransitRouteResponse
  if (!res.ok && !body.routes?.length) {
    return {
      cached: false,
      routes: [],
      error: body.error ?? `Request failed (${res.status})`,
    }
  }
  return {
    ...body,
    routes: body.routes?.map(normalizeRoute) ?? [],
  }
}
