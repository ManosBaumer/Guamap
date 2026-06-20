export const GUANGZHOU_CITY = '广州'
export const BUS_STOPNAME_URL = 'https://restapi.amap.com/v3/bus/stopname'

export type StopLinesResponse = {
  lines: string[]
  cached: boolean
  error?: string
}

function queryVariants(name: string): string[] {
  let base = name.trim()
  for (const suffix of ['(公交站)', '(地铁站)', '公交站', '地铁站']) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length).trim()
      break
    }
  }
  const variants = [base]
  if (base && !base.endsWith('站')) variants.push(`${base}站`)
  return variants
}

function lineShortName(fullName: string): string {
  const s = fullName.trim()
  if (!s) return ''

  const metro = s.match(/地铁\s*(\d+号线)/)
  if (metro?.[1]) return metro[1]

  const light = s.match(/(?:轻轨|有轨)\s*(\d+号线)/)
  if (light?.[1]) return light[1]

  if (/APM/i.test(s) || s.includes('旅客自动输送')) return 'APM'
  if (s.includes('广佛') || s.includes('广州地铁广佛线')) return 'GF'

  return s
}

export async function fetchAmapStopLines(
  amapKey: string,
  stopName: string,
): Promise<StopLinesResponse> {
  if (!amapKey) {
    return { lines: [], cached: false, error: 'Stop lines lookup is not configured (missing AMAP_KEY).' }
  }
  if (!stopName.trim()) {
    return { lines: [], cached: false, error: 'Missing stop name.' }
  }

  for (const keywords of queryVariants(stopName)) {
    const params = new URLSearchParams({
      key: amapKey,
      keywords,
      city: GUANGZHOU_CITY,
      output: 'json',
    })

    let body: Record<string, unknown>
    try {
      const resp = await fetch(`${BUS_STOPNAME_URL}?${params}`)
      body = (await resp.json()) as Record<string, unknown>
    } catch {
      return { lines: [], cached: false, error: 'Could not reach Amap stop lookup service.' }
    }

    if (body.status !== '1') {
      continue
    }

    const busstops = (body.busstops as Record<string, unknown>[] | undefined) ?? []
    if (!busstops.length) continue

    const stop = busstops[0]
    const buslines = (stop.buslines as Record<string, unknown>[] | undefined) ?? []
    const seenFull = new Set<string>()
    const seenShort = new Set<string>()
    const lines: string[] = []

    for (const bl of buslines) {
      const full = String(bl.name ?? '').trim()
      if (!full || seenFull.has(full)) continue
      seenFull.add(full)
      const short = lineShortName(full)
      if (short && !seenShort.has(short)) {
        seenShort.add(short)
        lines.push(short)
      }
    }

    if (lines.length) {
      return { lines, cached: false }
    }
  }

  return { lines: [], cached: false }
}
