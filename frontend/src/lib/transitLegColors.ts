import type { TransitRouteLeg, TransitRoutePlan } from './transitRouteTypes'
import { TRANSIT_LEG_STYLES } from './transitRouteTypes'
import { colorForMetroLineName } from './guangzhouMetroLineColors'

export function transitLegStrokeColor(leg: TransitRouteLeg): string {
  if (leg.kind === 'metro') {
    return colorForMetroLineName(leg.line)
  }
  return TRANSIT_LEG_STYLES[leg.kind].color
}

/** Darken a #RRGGBB color for route line outlines. */
export function darkenHexColor(hex: string, amount = 0.38): string {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return hex
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  const scale = 1 - amount
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n * scale))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export const TRANSIT_LEG_INNER_WEIGHT = 9
export const TRANSIT_LEG_OUTLINE_EXTRA = 5

export function isTransitLegKind(kind: TransitRouteLeg['kind']): boolean {
  return kind !== 'walking'
}

/** Backfill `line` on legs from matching segments (older cached routes). */
export function enrichRouteLegLines(route: TransitRoutePlan): TransitRouteLeg[] {
  let segIdx = 0
  return route.legs.map((leg) => {
    if (leg.line) return leg
    while (segIdx < route.segments.length && route.segments[segIdx]!.kind === 'walking') {
      segIdx++
    }
    const seg = route.segments[segIdx]
    if (seg && seg.kind === leg.kind) {
      segIdx++
      return seg.line ? { ...leg, line: seg.line } : leg
    }
    return leg
  })
}
