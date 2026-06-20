/**
 * Official-ish Guangzhou Metro line colors (matches map metro layer / OSM pipeline).
 * Keys are normalized line ids used when parsing Amap `buslines[].name`.
 */
export const GUANGZHOU_METRO_LINE_COLORS: Record<string, string> = {
  '1': '#F3D03E',
  '2': '#0066B3',
  '3': '#E86E22',
  '4': '#00A651',
  '5': '#C5003E',
  '6': '#80225F',
  '7': '#97D077',
  '8': '#008C49',
  '9': '#73C0D8',
  '10': '#168EEA',
  '11': '#F5DA2D',
  '12': '#80965A',
  '13': '#C5003E',
  '14': '#81312F',
  '18': '#0066B3',
  '21': '#211645',
  '22': '#DB70A2',
  APM: '#0099CC',
  GF: '#C4D600',
}

const DEFAULT_METRO_COLOR = '#ea580c'

/** Parse Amap line name → color key (e.g. "地铁3号线(…)" → "3", "APM线" → "APM"). */
export function parseGuangzhouMetroLineKey(lineName: string): string | null {
  const name = lineName.trim()
  if (!name) return null

  if (/APM/i.test(name) || name.includes('旅客自动输送')) return 'APM'
  if (name.includes('广佛') || name.includes('广州地铁广佛线')) return 'GF'

  const numbered =
    name.match(/(?:地铁)?(\d+)号线(?:\s*\(?北延段\)?)?/) ??
    name.match(/(\d+)号线(?:\s*\(?北延段\)?)?/)
  if (numbered?.[1]) return numbered[1]

  return null
}

export function colorForMetroLineName(lineName: string | undefined): string {
  if (!lineName) return DEFAULT_METRO_COLOR
  const key = parseGuangzhouMetroLineKey(lineName)
  if (key && GUANGZHOU_METRO_LINE_COLORS[key]) {
    return GUANGZHOU_METRO_LINE_COLORS[key]
  }
  return DEFAULT_METRO_COLOR
}
