import fs from 'node:fs'
import path from 'node:path'
import type { TransitRouteRequest, TransitRouteResponse } from './amapTransit'
import { buildCacheKey } from './amapTransit'

const CACHE_DIR = path.resolve(import.meta.dirname, '../../data/transit_route_cache')

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

export function readTransitCache(req: TransitRouteRequest): TransitRouteResponse | null {
  ensureCacheDir()
  const key = buildCacheKey(req)
  const file = path.join(CACHE_DIR, `${key}.json`)
  if (!fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TransitRouteResponse
    if (!parsed?.routes?.length) return null
    return { ...parsed, cached: true }
  } catch {
    return null
  }
}

export function writeTransitCache(req: TransitRouteRequest, response: TransitRouteResponse) {
  if (!response.routes.length || response.error) return
  ensureCacheDir()
  const key = buildCacheKey(req)
  const file = path.join(CACHE_DIR, `${key}.json`)
  const payload: TransitRouteResponse = { cached: false, routes: response.routes }
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`, 'utf8')
}
