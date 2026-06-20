export type StopLinesResult = {
  lines: string[]
  cached?: boolean
  error?: string
}

const clientCache = new Map<string, string[]>()

export function parseStopLinesField(lines: string | undefined): string[] {
  if (!lines?.trim()) return []
  return lines
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function fetchStopLines(stopName: string): Promise<StopLinesResult> {
  const cached = clientCache.get(stopName)
  if (cached) return { lines: cached, cached: true }

  const params = new URLSearchParams({ name: stopName })
  const res = await fetch(`/api/stop-lines?${params}`)
  const body = (await res.json()) as StopLinesResult
  if (body.lines?.length) {
    clientCache.set(stopName, body.lines)
  }
  return body
}
