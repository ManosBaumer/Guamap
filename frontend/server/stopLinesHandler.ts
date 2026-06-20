import type { IncomingMessage, ServerResponse } from 'node:http'
import { fetchAmapStopLines } from './amapStopLines'

const memoryCache = new Map<string, { lines: string[]; at: number }>()
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export async function handleStopLinesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  amapKey: string,
): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  const url = new URL(req.url ?? '', 'http://localhost')
  const name = (url.searchParams.get('name') ?? '').trim()
  if (!name) {
    sendJson(res, 400, { error: 'missing_name' })
    return
  }

  const cached = memoryCache.get(name)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    sendJson(res, 200, { lines: cached.lines, cached: true })
    return
  }

  const result = await fetchAmapStopLines(amapKey, name)
  if (result.lines.length) {
    memoryCache.set(name, { lines: result.lines, at: Date.now() })
  }

  sendJson(res, result.error && !result.lines.length ? 502 : 200, {
    lines: result.lines,
    cached: false,
    error: result.error,
  })
}
