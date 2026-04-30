/**
 * English display strings for listing cards (raw data stays Chinese for filtering).
 */

import { metroTokensFromRaw } from './metroFilterOptions'

export const ORIENT_EN: Record<string, string> = {
  朝南: 'South',
  南北: 'North–south',
  朝东: 'East',
  朝西: 'West',
  东南: 'Southeast',
  西南: 'Southwest',
  东北: 'Northeast',
  西北: 'Northwest',
  东西: 'East–west',
  朝北: 'North',
}

export const FITMENT_EN: Record<string, string> = {
  精装修: 'Furnished (standard)',
  简单装修: 'Furnished (basic)',
  豪华装修: 'Furnished (luxury)',
  毛坯: 'Unfurnished',
}

export const RENT_TYPE_EN: Record<string, string> = {
  整租: 'Whole unit',
  合租: 'Shared',
}

export function orientLabelEn(zh: string | null | undefined): string {
  if (!zh || !zh.trim()) return ''
  return ORIENT_EN[zh] ?? zh
}

export function fitmentLabelEn(zh: string | null | undefined): string {
  if (!zh || !zh.trim()) return ''
  return FITMENT_EN[zh] ?? zh
}

export function rentTypeLabelEn(zh: string | null | undefined): string {
  if (!zh || !zh.trim()) return ''
  return RENT_TYPE_EN[zh] ?? zh
}

/**
 * One metro token → short Latin label: line number, APM, Guangfo, or 3 (N) for north extension.
 */
export function metroTokenToShortEn(token: string): string {
  if (token === 'APM线') return 'APM'
  if (token === '广佛线') return 'Guangfo'
  if (token === '3号线(北延段)') return '3 (N)'
  const m = token.match(/^(\d+)号线$/)
  if (m) return m[1]
  const digits = token.match(/^(\d+)/)
  if (digits && token.includes('号线')) return digits[1]
  return token.replace(/号线/g, '').trim() || token
}

/** Listing `metro` field → e.g. "5 · 6 · 11" or "8" or "APM · Guangfo". */
export function metroLinesDisplayEn(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return ''
  const tokens = metroTokensFromRaw(raw)
  if (tokens.length === 0) return ''
  return tokens.map(metroTokenToShortEn).join(' / ')
}

/**
 * Parse Chinese layout like "4室2厅2卫" → English fragment for fallback display.
 */
export function roomsLayoutDisplayEn(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return ''
  const parts: string[] = []
  const br = raw.match(/(\d+)\s*室/)
  if (br) {
    const n = br[1]
    parts.push(`${n} bedroom${n === '1' ? '' : 's'}`)
  }
  const lr = raw.match(/(\d+)\s*厅/)
  if (lr) {
    const n = lr[1]
    parts.push(`${n} living area${n === '1' ? '' : 's'}`)
  }
  const bt = raw.match(/(\d+)\s*卫/)
  if (bt) {
    const n = bt[1]
    parts.push(`${n} bathroom${n === '1' ? '' : 's'}`)
  }
  return parts.length > 0 ? parts.join(' · ') : raw.trim()
}
