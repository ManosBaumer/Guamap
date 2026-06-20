import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  fetchAmapTransitRoutes,
  type TransitRouteRequest,
  type TransitRouteResponse,
} from './amapTransit'
import { readTransitCache, writeTransitCache } from './transitCache'

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function parseRequest(body: unknown): TransitRouteRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const originLat = Number(b.originLat)
  const originLng = Number(b.originLng)
  const destLat = Number(b.destLat)
  const destLng = Number(b.destLng)
  const date = String(b.date ?? '')
  const time = String(b.time ?? '')
  if (
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng) ||
    !Number.isFinite(destLat) ||
    !Number.isFinite(destLng) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}$/.test(time)
  ) {
    return null
  }
  return { originLat, originLng, destLat, destLng, date, time }
}

export type ProcessTransitRouteOptions = {
  /** File cache under data/transit_route_cache (dev/preview only). */
  useFileCache?: boolean
}

export async function processTransitRouteBody(
  body: unknown,
  amapKey: string,
  options: ProcessTransitRouteOptions = {},
): Promise<{ status: number; payload: TransitRouteResponse | { error: string } }> {
  const parsed = parseRequest(body)
  if (!parsed) {
    return { status: 400, payload: { error: 'invalid_request' } }
  }

  const useFileCache = options.useFileCache !== false

  if (useFileCache) {
    const cached = readTransitCache(parsed)
    if (cached) {
      return { status: 200, payload: cached }
    }
  }

  const result: TransitRouteResponse = await fetchAmapTransitRoutes(amapKey, parsed)
  if (useFileCache && result.routes.length) {
    writeTransitCache(parsed, result)
  }
  return {
    status: result.error && !result.routes.length ? 502 : 200,
    payload: result,
  }
}

export async function handleTransitRouteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  amapKey: string,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'invalid_json' })
    return
  }

  const { status, payload } = await processTransitRouteBody(body, amapKey)
  sendJson(res, status, payload)
}
