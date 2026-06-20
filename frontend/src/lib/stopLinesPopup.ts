import { colorForMetroLineName } from '@/lib/guangzhouMetroLineColors'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function displayStopName(name: string): string {
  return name
    .replace(/\(地铁站\)$/, '')
    .replace(/\(公交站\)$/, '')
    .replace(/地铁站$/, '')
    .replace(/公交站$/, '')
    .trim()
}

function lineBadgeHtml(line: string, isMetro: boolean): string {
  const color = isMetro ? colorForMetroLineName(line.includes('号线') ? `地铁${line}` : line) : '#2563eb'
  const label = escapeHtml(line)
  return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style="background:${color}">${label}</span>`
}

export function stopPopupLoadingHtml(stopName: string, isMetro: boolean): string {
  const title = escapeHtml(displayStopName(stopName))
  const kind = isMetro ? 'Metro' : 'Bus'
  return `<div class="guamap-stop-popup text-xs max-w-[240px] leading-snug">
    <div class="font-semibold text-[var(--color-text)] mb-1">${title}</div>
    <div class="text-gray-500">${kind} stop · loading lines…</div>
  </div>`
}

export function stopPopupLinesHtml(
  stopName: string,
  lines: string[] | null,
  isMetro: boolean,
  error?: string,
): string {
  const title = escapeHtml(displayStopName(stopName))
  const kind = isMetro ? 'Metro' : 'Bus'

  if (error) {
    return `<div class="guamap-stop-popup text-xs max-w-[240px] leading-snug">
      <div class="font-semibold text-[var(--color-text)] mb-1">${title}</div>
      <div class="text-gray-500">${kind} stop</div>
      <div class="text-gray-400 mt-1">${escapeHtml(error)}</div>
    </div>`
  }

  if (!lines?.length) {
    return `<div class="guamap-stop-popup text-xs max-w-[240px] leading-snug">
      <div class="font-semibold text-[var(--color-text)] mb-1">${title}</div>
      <div class="text-gray-500">${kind} stop</div>
      <div class="text-gray-400 mt-1">No line data found.</div>
    </div>`
  }

  const badges = lines.map((line) => lineBadgeHtml(line, isMetro)).join('')
  return `<div class="guamap-stop-popup text-xs max-w-[240px] leading-snug">
    <div class="font-semibold text-[var(--color-text)] mb-1">${title}</div>
    <div class="text-gray-500 mb-1.5">${kind} · ${lines.length} line${lines.length === 1 ? '' : 's'}</div>
    <div class="flex flex-wrap gap-1">${badges}</div>
  </div>`
}
