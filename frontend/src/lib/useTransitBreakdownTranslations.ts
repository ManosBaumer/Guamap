import { useEffect, useState } from 'react'
import { translateText } from '@/lib/data'
import type { TransitRoutePlan } from '@/lib/transitRouteTypes'
import { routeBreakdownHasChinese, segmentTextsForRoute } from '@/lib/transitSegmentText'

const CJK_RE = /[\u4e00-\u9fff]/

async function translateSegmentLine(text: string): Promise<string> {
  if (!CJK_RE.test(text)) return text
  const out = await translateText(text)
  return out.startsWith('(') ? text : out
}

/** Auto-translate route breakdown lines when routes change; keyed by route.index. */
export function useTransitBreakdownTranslations(routes: TransitRoutePlan[] | null) {
  const [translatedByRoute, setTranslatedByRoute] = useState<Record<number, string[]>>({})
  const [translating, setTranslating] = useState(false)

  useEffect(() => {
    if (!routes?.length) {
      setTranslatedByRoute({})
      setTranslating(false)
      return
    }

    let cancelled = false
    setTranslating(true)

    void (async () => {
      const entries = await Promise.all(
        routes.map(async (route) => {
          if (!routeBreakdownHasChinese(route)) {
            return [route.index, segmentTextsForRoute(route)] as const
          }
          const originals = segmentTextsForRoute(route)
          const translated = await Promise.all(originals.map(translateSegmentLine))
          return [route.index, translated] as const
        }),
      )

      if (cancelled) return
      const next: Record<number, string[]> = {}
      for (const [idx, lines] of entries) next[idx] = lines
      setTranslatedByRoute(next)
      setTranslating(false)
    })()

    return () => {
      cancelled = true
    }
  }, [routes])

  return { translatedByRoute, translating }
}
