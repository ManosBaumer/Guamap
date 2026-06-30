/** JSON listing ids may be number or string — normalize for comparisons. */
export function listingIdNumber(id: unknown): number | null {
  if (typeof id === 'number' && Number.isFinite(id)) return id
  if (typeof id === 'string') {
    const trimmed = id.trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function listingIdsEqual(a: unknown, b: unknown): boolean {
  const na = listingIdNumber(a)
  const nb = listingIdNumber(b)
  return na != null && nb != null && na === nb
}
