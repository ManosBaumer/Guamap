import type { TransitRoutePlan, TransitRouteSegment } from './transitRouteTypes'
import { segmentKindLabel } from './transitRouteTypes'

export function formatTransitSegmentText(seg: TransitRouteSegment): string {
  if (seg.kind === 'walking') {
    const dist = seg.distanceM ? `${seg.distanceM} m` : ''
    return `${seg.durationMin} min walk${dist ? ` (${dist})` : ''}`
  }
  const line = seg.line ?? segmentKindLabel(seg.kind)
  const stops = seg.stops ? `, ${seg.stops} stops` : ''
  const ends = seg.from && seg.to ? ` — ${seg.from} → ${seg.to}` : ''
  return `${seg.durationMin} min ${line}${ends}${stops}`
}

export function segmentTextsForRoute(route: TransitRoutePlan): string[] {
  return route.segments.map(formatTransitSegmentText)
}

export function routeBreakdownHasChinese(route: TransitRoutePlan): boolean {
  return segmentTextsForRoute(route).some((t) => /[\u4e00-\u9fff]/.test(t))
}
