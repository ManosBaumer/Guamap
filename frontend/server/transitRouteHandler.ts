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

  const parsed = parseRequest(body)
  if (!parsed) {
    sendJson(res, 400, { error: 'invalid_request' })
    return
  }

  const cached = readTransitCache(parsed)
  if (cached) {
    sendJson(res, 200, cached)
    return
  }

  const result: TransitRouteResponse = await fetchAmapTransitRoutes(amapKey, parsed)
  if (result.routes.length) {
    writeTransitCache(parsed, result)
  }
  sendJson(res, result.error && !result.routes.length ? 502 : 200, result)
}
