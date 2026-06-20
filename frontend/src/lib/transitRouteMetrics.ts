import type { TransitRouteSegment } from './transitRouteTypes'

/** Transfers = vehicle legs only; walking between lines is not a transfer. */
export function countRouteTransfers(segments: Pick<TransitRouteSegment, 'kind'>[]): number {
  const vehicleLegs = segments.filter((s) => s.kind !== 'walking').length
  return Math.max(0, vehicleLegs - 1)
}
