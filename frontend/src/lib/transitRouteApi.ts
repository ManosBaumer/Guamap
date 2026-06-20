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

function transitRouteApiUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}api/transit-route`
}

export async function fetchTransitRoutes(
  params: FetchTransitRoutesParams,
): Promise<TransitRouteResponse> {
  const res = await fetch(transitRouteApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return {
      cached: false,
      routes: [],
      error: 'Transit API unavailable. On Netlify, set AMAP_KEY in site environment variables and redeploy.',
    }
  }

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
