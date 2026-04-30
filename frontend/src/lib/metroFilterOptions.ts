/**
 * Metro line filter: UI labels (English) map to Anjuke `metro_info` tokens (Chinese).
 * Token parsing matches `scripts/unique_metro_info.py` (split on "/", digit-only → N号线).
 */

export interface MetroLineOption {
  /** Stored in `Filters.metro`; must match normalized tokens from listing `metro` field. */
  value: string
  label: string
}

/** Order and copy as specified for the filter UI. */
export const METRO_LINE_OPTIONS: MetroLineOption[] = [
  { value: '1号线', label: 'Line 1' },
  { value: '2号线', label: 'Line 2' },
  { value: '3号线', label: 'Line 3' },
  { value: '3号线(北延段)', label: 'Line 3 (northern extension)' },
  { value: '4号线', label: 'Line 4' },
  { value: '5号线', label: 'Line 5' },
  { value: '6号线', label: 'Line 6' },
  { value: '7号线', label: 'Line 7' },
  { value: '8号线', label: 'Line 8' },
  { value: '9号线', label: 'Line 9' },
  { value: '10号线', label: 'Line 10' },
  { value: '11号线', label: 'Line 11' },
  { value: '12号线', label: 'Line 12' },
  { value: '13号线', label: 'Line 13' },
  { value: '14号线', label: 'Line 14' },
  { value: '18号线', label: 'Line 18' },
  { value: '21号线', label: 'Line 21' },
  { value: '22号线', label: 'Line 22' },
  { value: 'APM线', label: 'APM line' },
  { value: '广佛线', label: 'Guangfo Line' },
]

const DIGITS_ONLY = /^\d+$/

/** One segment from metro_info after trim; bare line numbers become N号线. */
export function normalizeMetroToken(part: string): string {
  const t = part.trim()
  if (!t) return ''
  if (DIGITS_ONLY.test(t)) return `${t}号线`
  return t
}

/** All normalized line tokens for a listing's `metro` field (from metro_info). */
export function metroTokensFromRaw(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return []
  const tokens: string[] = []
  for (const part of raw.split('/')) {
    const n = normalizeMetroToken(part)
    if (n) tokens.push(n)
  }
  return tokens
}

/** Stable order for metro multi-select (same as METRO_LINE_OPTIONS). */
const METRO_VALUE_ORDER = new Map(METRO_LINE_OPTIONS.map((o, i) => [o.value, i]))

export function sortMetroSelection(values: string[]): string[] {
  return [...values].sort((a, b) => (METRO_VALUE_ORDER.get(a) ?? 999) - (METRO_VALUE_ORDER.get(b) ?? 999))
}
