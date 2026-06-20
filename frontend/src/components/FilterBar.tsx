import { ChevronDown, Star, Compass, DollarSign, Home, TrainFront, SlidersHorizontal, Ruler, Bed, Bath, Sofa, Calendar, User, LogOut, X, Sparkles, Route, Wrench } from 'lucide-react'
import NumberFlow from '@number-flow/react'
import { useShallow } from 'zustand/react/shallow'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/lib/store'
import type { Filters } from '@/lib/types'
import { METRO_LINE_OPTIONS, sortMetroSelection } from '@/lib/metroFilterOptions'
import { listingFiltersAreActive } from '@/lib/listingFilters'
import { isDevAdmin } from '@/lib/devAccess'
import { navigateTo } from '@/hooks/usePathname'
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  createContext,
  useContext,
} from 'react'

/** Button text for filter pills — fixed width labels (no dynamic selected text). */
const FILTER_PILL_LABELS = {
  orient: 'Facing',
  plot: 'Plot size',
  built: 'Built',
  rooms: 'Rooms',
  metro: 'Metro',
  price: 'Price',
  rentType: 'Type',
  amenities: 'Amenities',
} as const

function filterValueIsSet(key: keyof Filters, f: Filters): boolean {
  const v = f[key]
  if (key === 'metro' || key === 'orient' || key === 'amenities') return Array.isArray(v) && v.length > 0
  if (v === null || v === '') return false
  return true
}

const ORIENT_OPTIONS = ['', '朝南', '南北', '朝东', '朝西', '东南', '西南', '东北', '西北', '东西', '朝北']
/** Facings available for multi-select (excludes “any”). */
const ORIENT_FILTER_OPTIONS = ORIENT_OPTIONS.filter((o) => o !== '')
const ORIENT_EN: Record<string, string> = {
  '': 'Any', '朝南': 'South', '南北': 'N-S', '朝东': 'East', '朝西': 'West',
  '东南': 'SE', '西南': 'SW', '东北': 'NE', '西北': 'NW', '东西': 'E-W', '朝北': 'North',
}
const ROOM_OPTIONS = ['', '1', '2', '3', '4', '5+']

function bedroomOptionLabel(r: string): string {
  if (!r) return 'Any bedrooms'
  if (r === '5+') return '5+ bedrooms'
  return `${r} bedroom${r === '1' ? '' : 's'}`
}

function bathroomOptionLabel(r: string): string {
  if (!r) return 'Any bathrooms'
  if (r === '5+') return '5+ bathrooms'
  return `${r} bathroom${r === '1' ? '' : 's'}`
}

const RENT_OPTIONS = ['', '整租', '合租']
const RENT_EN: Record<string, string> = { '': 'Any', '整租': 'Whole', '合租': 'Shared' }
const FITMENT_OPTIONS = ['', '精装修', '简单装修', '豪华装修', '毛坯']
const FITMENT_EN: Record<string, string> = {
  '': 'Any', '精装修': 'Standard', '简单装修': 'Basic', '豪华装修': 'Luxury', '毛坯': 'Unfurnished',
}

const AMENITY_OPTIONS = [
  'ac', 'fridge', 'washing_machine', 'water_heater', 'wifi', 'tv', 'sofa',
  'wardrobe', 'bed', 'cooking_ok', 'gas_stove', 'range_hood', 'bathroom',
  'balcony', 'smart_lock', 'heating'
]
const AMENITY_EN: Record<string, string> = {
  ac: 'Air conditioning', fridge: 'Fridge', washing_machine: 'Washer',
  water_heater: 'Water heater', wifi: 'Wifi', tv: 'TV', sofa: 'Sofa',
  wardrobe: 'Wardrobe', bed: 'Bed', cooking_ok: 'Cooking ok',
  gas_stove: 'Gas stove', range_hood: 'Hood', bathroom: 'Bathroom',
  balcony: 'Balcony', smart_lock: 'Smart lock', heating: 'Heating'
}

/** Left-to-right order; first items stay visible longest as width shrinks */
const FILTER_KEYS = ['price', 'rooms', 'rentType', 'amenities', 'metro', 'built', 'plot', 'orient'] as const
type FilterBarKey = (typeof FILTER_KEYS)[number]

const FILTER_GAP_PX = 16

/** Lets DropdownItem close its parent after a single-select choice (metro/orient stay open). */
const CloseFilterDropdownContext = createContext<() => void>(() => { })

const BTN_BASE =
  'flex items-center gap-2 min-h-10 min-w-[9rem] px-3.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0'

function Dropdown({
  icon,
  label,
  children,
  isActive,
  onClear,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  isActive?: boolean
  onClear?: (e: React.MouseEvent) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])

  // Use `click` (not `mousedown`) so an outside control (e.g. Clear) still receives its
  // full click: mousedown-close was re-rendering before `click` and dropping the first press.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  return (
    <CloseFilterDropdownContext.Provider value={close}>
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`${BTN_BASE} ${isActive
              ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] border border-[var(--color-primary)]'
              : 'bg-[var(--color-bg-pill)] text-[var(--color-text)] border border-transparent hover:border-[var(--color-border)]'
            }`}
        >
          {icon}
          <span className="flex-1 text-left">{label}</span>
          {isActive && onClear ? (
            <X
              role="button"
              className="w-4 h-4 shrink-0 transition-colors hover:text-red-500 cursor-pointer opacity-70 hover:opacity-100 text-[var(--color-primary)]"
              onClick={(e) => {
                e.stopPropagation()
                onClear(e)
              }}
            />
          ) : (
            <ChevronDown className={`w-4 h-4 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
          )}
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-[var(--color-border)] rounded-xl shadow-lg z-[200] min-w-[220px] py-1">
            {children}
          </div>
        )}
      </div>
    </CloseFilterDropdownContext.Provider>
  )
}

function DropdownItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const closeParent = useContext(CloseFilterDropdownContext)
  return (
    <button
      type="button"
      onClick={() => {
        onClick()
        closeParent()
      }}
      className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer ${active ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-medium' : 'text-[var(--color-text)] hover:bg-gray-50'
        }`}
    >
      {label}
    </button>
  )
}

/** Metro multi-select row: keeps dropdown open while toggling. */
function MetroLineToggle({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 cursor-pointer transition-colors ${checked ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'text-[var(--color-text)] hover:bg-gray-50'
        }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${checked
            ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
            : 'border-[var(--color-border)] bg-white'
          }`}
        aria-hidden
      >
        {checked ? '✓' : ''}
      </span>
      <span className={checked ? 'font-medium' : ''}>{label}</span>
    </button>
  )
}

/** Same trigger styling as Dropdown, for width measurement only */
function MeasureTrigger({ icon, label, isActive }: { icon: React.ReactNode; label: string; isActive?: boolean }) {
  return (
    <button type="button" tabIndex={-1} className={`${BTN_BASE} bg-[var(--color-bg-pill)] text-[var(--color-text)] border border-transparent`}>
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {isActive ? (
        <X className="w-4 h-4 shrink-0 opacity-0" />
      ) : (
        <ChevronDown className="w-4 h-4 shrink-0" />
      )}
    </button>
  )
}

function MoreMeasureTrigger() {
  return (
    <button type="button" tabIndex={-1} className={`${BTN_BASE} bg-[var(--color-bg-pill)] text-[var(--color-text)] border border-transparent`}>
      <SlidersHorizontal className="w-4 h-4 shrink-0" />
      <span>More</span>
      <ChevronDown className="w-4 h-4 shrink-0" />
    </button>
  )
}

function overflowActive(keys: FilterBarKey[], f: Filters): boolean {
  return keys.some((k) => {
    if (k === 'orient') return f.orient.length > 0
    if (k === 'plot') return f.minArea !== null || f.maxArea !== null
    if (k === 'built') return f.minBuildYear !== null || f.maxBuildYear !== null
    if (k === 'rooms') return !!f.rooms || !!f.bathrooms
    if (k === 'metro') return f.metro.length > 0
    if (k === 'price') return f.minPrice !== null || f.maxPrice !== null
    if (k === 'rentType') return !!f.rentType
    if (k === 'amenities') return f.amenities.length > 0
    return false
  })
}

export default function FilterBar() {
  const {
    appliedFilters,
    setFilter,
    resetFilters,
    shownListingCount,
    listingsCountLoading,
    savedListings,
    savedMapViewActive,
    toggleSavedMapView,
    user,
    setAuthModalOpen,
    anjukeLayerOn,
    transitPlannerOpen,
    setTransitPlannerOpen,
  } = useStore(
    useShallow((s) => ({
      appliedFilters: s.appliedFilters,
      setFilter: s.setFilter,
      resetFilters: s.resetFilters,
      shownListingCount: s.shownListingCount,
      listingsCountLoading: s.listingsCountLoading,
      savedListings: s.savedListings,
      savedMapViewActive: s.savedMapViewActive,
      toggleSavedMapView: s.toggleSavedMapView,
      user: s.user,
      setAuthModalOpen: s.setAuthModalOpen,
      anjukeLayerOn: s.layers.anjuke,
      transitPlannerOpen: s.transitPlannerOpen,
      setTransitPlannerOpen: s.setTransitPlannerOpen,
    })),
  )

  const previousCountRef = useRef(shownListingCount)
  useEffect(() => {
    if (!listingsCountLoading) {
      previousCountRef.current = shownListingCount
    }
  }, [shownListingCount, listingsCountLoading])

  const displayCount = listingsCountLoading ? previousCountRef.current : shownListingCount

  const handleSavedClick = () => {
    if (!user) {
      setAuthModalOpen(true)
      return
    }
    toggleSavedMapView()
  }

  const hasActiveFilters = (Object.keys(appliedFilters) as (keyof Filters)[]).some((k) =>
    filterValueIsSet(k, appliedFilters),
  )

  const filtersHostRef = useRef<HTMLDivElement>(null)
  const itemMeasureRefs = useRef<(HTMLDivElement | null)[]>([])
  const moreMeasureRef = useRef<HTMLDivElement>(null)
  const clearMeasureRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState<number>(FILTER_KEYS.length)

  const toggleMetroLine = useCallback(
    (line: string) => {
      const cur = useStore.getState().appliedFilters.metro
      const has = cur.includes(line)
      const next = sortMetroSelection(has ? cur.filter((x) => x !== line) : [...cur, line])
      setFilter('metro', next)
    },
    [setFilter],
  )

  const toggleOrient = useCallback(
    (facing: string) => {
      const cur = useStore.getState().appliedFilters.orient
      const has = cur.includes(facing)
      setFilter('orient', has ? cur.filter((x) => x !== facing) : [...cur, facing])
    },
    [setFilter],
  )

  const toggleAmenity = useCallback(
    (slug: string) => {
      const cur = useStore.getState().appliedFilters.amenities
      const has = cur.includes(slug)
      setFilter('amenities', has ? cur.filter((x) => x !== slug) : [...cur, slug])
    },
    [setFilter],
  )

  const recalcVisible = useCallback(() => {
    const host = filtersHostRef.current
    if (!host) return
    const w = host.getBoundingClientRect().width
    const n = FILTER_KEYS.length
    const widths = FILTER_KEYS.map((_, i) => itemMeasureRefs.current[i]?.getBoundingClientRect().width ?? 0)
    const moreW = moreMeasureRef.current?.getBoundingClientRect().width ?? 120
    const clearW = clearMeasureRef.current?.getBoundingClientRect().width ?? 0
    // Host row = filter pills + gap + optional Clear; space for pills only:
    const availFilters = w - FILTER_GAP_PX - clearW

    /** Pixel width of first `inlineCount` filter triggers + optional More (when inlineCount < n). */
    const rowTotal = (inlineCount: number): number => {
      if (inlineCount >= n) {
        let total = 0
        for (let i = 0; i < n; i++) {
          const wi = widths[i] > 8 ? widths[i] : 140
          total += wi + (i > 0 ? FILTER_GAP_PX : 0)
        }
        return total
      }
      if (inlineCount <= 0) return moreW
      let total = 0
      for (let i = 0; i < inlineCount; i++) {
        const wi = widths[i] > 8 ? widths[i] : 140
        total += wi + (i > 0 ? FILTER_GAP_PX : 0)
      }
      total += FILTER_GAP_PX + moreW
      return total
    }

    const maxK = (avail: number) => {
      for (let k = n; k >= 0; k--) {
        if (rowTotal(k) <= avail) return k
      }
      return 0
    }

    const best = maxK(availFilters)
    setVisibleCount((c) => (c === best ? c : best))
  }, [])

  useLayoutEffect(() => {
    recalcVisible()
    const host = filtersHostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => recalcVisible())
    ro.observe(host)
    window.addEventListener('resize', recalcVisible)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recalcVisible)
    }
  }, [recalcVisible, hasActiveFilters])

  const visibleKeys = FILTER_KEYS.slice(0, visibleCount)
  const overflowKeys = FILTER_KEYS.slice(visibleCount)
  const showMore = overflowKeys.length > 0

  const renderInlineFilter = (key: FilterBarKey) => {
    const f = appliedFilters
    switch (key) {
      case 'orient':
        return (
          <Dropdown
            key={key}
            icon={<Compass className="w-4 h-4 shrink-0" />}
            label={FILTER_PILL_LABELS.orient}
            isActive={f.orient.length > 0}
            onClear={() => setFilter('orient', [])}
          >
            <div className="max-h-[min(70vh,22rem)] overflow-y-auto py-1 min-w-[240px]">
              <MetroLineToggle
                label="Any facing"
                checked={f.orient.length === 0}
                onToggle={() => setFilter('orient', [])}
              />
              {ORIENT_FILTER_OPTIONS.map((o) => (
                <MetroLineToggle
                  key={o}
                  label={`${ORIENT_EN[o]} (${o})`}
                  checked={f.orient.includes(o)}
                  onToggle={() => toggleOrient(o)}
                />
              ))}
            </div>
          </Dropdown>
        )
      case 'plot':
        return (
          <Dropdown key={key} icon={<Ruler className="w-4 h-4 shrink-0" />} label={FILTER_PILL_LABELS.plot} isActive={f.minArea !== null || f.maxArea !== null} onClear={() => { setFilter('minArea', null); setFilter('maxArea', null); }}>
            <div className="px-4 py-3 space-y-2">
              <label className="text-xs text-gray-500">Area range (m²)</label>
              <div className="flex gap-2">
                <input type="number" placeholder="Min" value={f.minArea ?? ''} onChange={(e) => setFilter('minArea', e.target.value ? Number(e.target.value) : null)} className="w-[4.5rem] px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
                <span className="text-gray-400 self-center">–</span>
                <input type="number" placeholder="Max" value={f.maxArea ?? ''} onChange={(e) => setFilter('maxArea', e.target.value ? Number(e.target.value) : null)} className="w-[4.5rem] px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
              </div>
            </div>
          </Dropdown>
        )
      case 'built':
        return (
          <Dropdown
            key={key}
            icon={<Calendar className="w-4 h-4 shrink-0" />}
            label={FILTER_PILL_LABELS.built}
            isActive={f.minBuildYear !== null || f.maxBuildYear !== null}
            onClear={() => { setFilter('minBuildYear', null); setFilter('maxBuildYear', null); }}
          >
            <div className="px-4 py-3 space-y-2">
              <div className="px-2.5 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-[10px] text-amber-700 leading-snug">
                  <span className="font-semibold">⚠ Note:</span> Not all communities have a build date filled in filtering may exclude valid matches.
                </p>
              </div>
              <label className="text-xs text-gray-500">Year built</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  placeholder="Min"
                  min={1980}
                  max={2035}
                  value={f.minBuildYear ?? ''}
                  onChange={(e) => setFilter('minBuildYear', e.target.value ? Number(e.target.value) : null)}
                  className="w-[4.5rem] px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
                <span className="text-gray-400">–</span>
                <input
                  type="number"
                  placeholder="Max"
                  min={1980}
                  max={2035}
                  value={f.maxBuildYear ?? ''}
                  onChange={(e) => setFilter('maxBuildYear', e.target.value ? Number(e.target.value) : null)}
                  className="w-[4.5rem] px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>
            </div>
          </Dropdown>
        )
      case 'rooms':
        return (
          <Dropdown
            key={key}
            icon={<Bed className="w-4 h-4 shrink-0" />}
            label={FILTER_PILL_LABELS.rooms}
            isActive={!!f.rooms || !!f.bathrooms}
            onClear={() => { setFilter('rooms', ''); setFilter('bathrooms', ''); }}
          >
            <div className="px-4 pt-2 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <Bed className="w-3.5 h-3.5" />
              Bedrooms
            </div>
            {ROOM_OPTIONS.map((r) => (
              <DropdownItem
                key={`bed-${r || 'any'}`}
                label={bedroomOptionLabel(r)}
                active={f.rooms === r}
                onClick={() => setFilter('rooms', r)}
              />
            ))}
            <div className="border-t border-[var(--color-border)] mt-1 pt-2 px-4 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <Bath className="w-3.5 h-3.5" />
              Bathrooms
            </div>
            {ROOM_OPTIONS.map((r) => (
              <DropdownItem
                key={`bath-${r || 'any'}`}
                label={bathroomOptionLabel(r)}
                active={f.bathrooms === r}
                onClick={() => setFilter('bathrooms', r)}
              />
            ))}
          </Dropdown>
        )
      case 'metro':
        return (
          <Dropdown
            key={key}
            icon={<TrainFront className="w-4 h-4 shrink-0" />}
            label={FILTER_PILL_LABELS.metro}
            isActive={f.metro.length > 0}
            onClear={() => setFilter('metro', [])}
          >
            <div className="max-h-[min(70vh,22rem)] overflow-y-auto py-1 min-w-[260px]">
              <MetroLineToggle
                label="Any line"
                checked={f.metro.length === 0}
                onToggle={() => setFilter('metro', [])}
              />
              {METRO_LINE_OPTIONS.map((opt) => (
                <MetroLineToggle
                  key={opt.value}
                  label={opt.label}
                  checked={f.metro.includes(opt.value)}
                  onToggle={() => toggleMetroLine(opt.value)}
                />
              ))}
            </div>
          </Dropdown>
        )
      case 'price':
        return (
          <Dropdown
            key={key}
            icon={<DollarSign className="w-4 h-4 shrink-0" />}
            label={FILTER_PILL_LABELS.price}
            isActive={f.minPrice !== null || f.maxPrice !== null}
            onClear={() => { setFilter('minPrice', null); setFilter('maxPrice', null); }}
          >
            <div className="px-4 py-3 space-y-2">
              <label className="text-xs text-gray-500">Price range (¥/mo)</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  placeholder="Min"
                  min={0}
                  value={f.minPrice ?? ''}
                  onChange={(e) => setFilter('minPrice', e.target.value ? Number(e.target.value) : null)}
                  className="w-[4.5rem] min-w-0 px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
                <span className="text-gray-400 shrink-0">–</span>
                <input
                  type="number"
                  placeholder="Max"
                  min={0}
                  value={f.maxPrice ?? ''}
                  onChange={(e) => setFilter('maxPrice', e.target.value ? Number(e.target.value) : null)}
                  className="w-[4.5rem] min-w-0 px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>
            </div>
          </Dropdown>
        )
      case 'rentType':
        return (
          <Dropdown key={key} icon={<Home className="w-4 h-4 shrink-0" />} label={FILTER_PILL_LABELS.rentType} isActive={!!f.rentType} onClear={() => setFilter('rentType', '')}>
            {RENT_OPTIONS.map((r) => (
              <DropdownItem key={r || 'any'} label={r ? `${RENT_EN[r]} (${r})` : 'Any type'} active={f.rentType === r} onClick={() => setFilter('rentType', r)} />
            ))}
          </Dropdown>
        )
      case 'amenities':
        return (
          <Dropdown
            key={key}
            icon={<Sparkles className="w-4 h-4 shrink-0" />}
            label={FILTER_PILL_LABELS.amenities}
            isActive={f.amenities.length > 0}
            onClear={() => setFilter('amenities', [])}
          >
            <div className="max-h-[min(70vh,22rem)] overflow-y-auto py-1 min-w-[240px]">
              <div className="mx-2 mb-2 px-2.5 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-[10px] text-amber-700 leading-snug">
                  <span className="font-semibold">⚠ Note:</span> ~50% of listings have no amenity data filled in. Using this filter shows only confirmed matches you may miss listings that do have the amenity but haven't declared it.
                </p>
              </div>
              <MetroLineToggle
                label="Any facilities"
                checked={f.amenities.length === 0}
                onToggle={() => setFilter('amenities', [])}
              />
              {AMENITY_OPTIONS.map((slug) => (
                <MetroLineToggle
                  key={slug}
                  label={AMENITY_EN[slug]}
                  checked={f.amenities.includes(slug)}
                  onToggle={() => toggleAmenity(slug)}
                />
              ))}
            </div>
          </Dropdown>
        )
      default:
        return null
    }
  }

  const renderOverflowSection = (key: FilterBarKey) => {
    const f = appliedFilters
    const title =
      key === 'orient'
        ? 'Facing'
        : key === 'plot'
          ? 'Plot size'
          : key === 'built'
            ? 'Year built (community)'
            : key === 'rooms'
              ? 'Bedrooms & bathrooms'
              : key === 'metro'
                ? 'Metro line'
                : key === 'price'
                  ? 'Price (¥/mo)'
                  : key === 'rentType'
                    ? 'Rent type'
                    : 'Fitment'

    return (
      <div key={key} className="border-b border-[var(--color-border)] pb-4 last:border-0 last:pb-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</p>
        {key === 'orient' && (
          <div className="flex flex-col max-h-64 overflow-y-auto">
            <MetroLineToggle
              label="Any facing"
              checked={f.orient.length === 0}
              onToggle={() => setFilter('orient', [])}
            />
            {ORIENT_FILTER_OPTIONS.map((o) => (
              <MetroLineToggle
                key={`ov-orient-${o}`}
                label={`${ORIENT_EN[o]} (${o})`}
                checked={f.orient.includes(o)}
                onToggle={() => toggleOrient(o)}
              />
            ))}
          </div>
        )}
        {key === 'plot' && (
          <div className="flex flex-wrap gap-2 items-center">
            <input type="number" placeholder="Min m²" value={f.minArea ?? ''} onChange={(e) => setFilter('minArea', e.target.value ? Number(e.target.value) : null)} className="w-24 px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
            <span className="text-gray-400">–</span>
            <input type="number" placeholder="Max m²" value={f.maxArea ?? ''} onChange={(e) => setFilter('maxArea', e.target.value ? Number(e.target.value) : null)} className="w-24 px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
          </div>
        )}
        {key === 'built' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">Whole community (building age).</p>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="number"
                placeholder="Min yr"
                min={1980}
                max={2035}
                value={f.minBuildYear ?? ''}
                onChange={(e) => setFilter('minBuildYear', e.target.value ? Number(e.target.value) : null)}
                className="w-24 px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm"
              />
              <span className="text-gray-400">–</span>
              <input
                type="number"
                placeholder="Max yr"
                min={1980}
                max={2035}
                value={f.maxBuildYear ?? ''}
                onChange={(e) => setFilter('maxBuildYear', e.target.value ? Number(e.target.value) : null)}
                className="w-24 px-2 py-2 border border-[var(--color-border)] rounded-lg text-sm"
              />
            </div>
          </div>
        )}
        {key === 'rooms' && (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
                <Bed className="w-3.5 h-3.5" /> Bedrooms
              </p>
              <div className="flex flex-col gap-1">
                {ROOM_OPTIONS.map((r) => (
                  <DropdownItem
                    key={`ov-bed-${r || 'any'}`}
                    label={bedroomOptionLabel(r)}
                    active={f.rooms === r}
                    onClick={() => setFilter('rooms', r)}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
                <Bath className="w-3.5 h-3.5" /> Bathrooms
              </p>
              <div className="flex flex-col gap-1">
                {ROOM_OPTIONS.map((r) => (
                  <DropdownItem
                    key={`ov-bath-${r || 'any'}`}
                    label={bathroomOptionLabel(r)}
                    active={f.bathrooms === r}
                    onClick={() => setFilter('bathrooms', r)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {key === 'metro' && (
          <div className="flex flex-col max-h-64 overflow-y-auto">
            <MetroLineToggle
              label="Any line"
              checked={f.metro.length === 0}
              onToggle={() => setFilter('metro', [])}
            />
            {METRO_LINE_OPTIONS.map((opt) => (
              <MetroLineToggle
                key={`ov-metro-${opt.value}`}
                label={opt.label}
                checked={f.metro.includes(opt.value)}
                onToggle={() => toggleMetroLine(opt.value)}
              />
            ))}
          </div>
        )}
        {key === 'price' && (
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="number"
              placeholder="Min"
              min={0}
              value={f.minPrice ?? ''}
              onChange={(e) => setFilter('minPrice', e.target.value ? Number(e.target.value) : null)}
              className="w-28 max-w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
            />
            <span className="text-gray-400">–</span>
            <input
              type="number"
              placeholder="Max"
              min={0}
              value={f.maxPrice ?? ''}
              onChange={(e) => setFilter('maxPrice', e.target.value ? Number(e.target.value) : null)}
              className="w-28 max-w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
            />
          </div>
        )}
        {key === 'rentType' && (
          <div className="flex flex-col gap-1">
            {RENT_OPTIONS.map((r) => (
              <DropdownItem key={r || 'any'} label={r ? `${RENT_EN[r]} (${r})` : 'Any type'} active={f.rentType === r} onClick={() => setFilter('rentType', r)} />
            ))}
          </div>
        )}
        {key === 'amenities' && (
          <div className="flex flex-col max-h-64 overflow-y-auto">
            <MetroLineToggle
              label="Any facilities"
              checked={f.amenities.length === 0}
              onToggle={() => setFilter('amenities', [])}
            />
            {AMENITY_OPTIONS.map((slug) => (
              <MetroLineToggle
                key={`ov-amenity-${slug}`}
                label={AMENITY_EN[slug]}
                checked={f.amenities.includes(slug)}
                onToggle={() => toggleAmenity(slug)}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <header className="relative z-50 min-h-[69px] bg-white border-b border-[var(--color-border)] flex items-center px-6 shrink-0 gap-[16px]">
      <div className="flex items-center gap-1.5 mr-2 shrink-0">
        <span className="font-['Lexend_Zetta'] text-2xl text-[var(--color-text)]">GUAMAP</span>
        <img src="/logo.png" alt="" className="w-[22px] h-[22px] object-contain ml-2.5 mr-5" />
      </div>

      {/* Off-screen measurement strip (same labels as live controls) */}
      <div className="fixed left-[120vw] top-0 flex gap-[16px] flex-nowrap pointer-events-none opacity-0 z-[-1] " aria-hidden>
        {FILTER_KEYS.map((key, i) => {
          const f = appliedFilters
          return (
            <div
              key={key}
              ref={(el) => {
                itemMeasureRefs.current[i] = el
              }}
              className="shrink-0 "
            >
              {key === 'orient' && <MeasureTrigger icon={<Compass className="w-4 h-4" />} label={FILTER_PILL_LABELS.orient} isActive={f.orient.length > 0} />}
              {key === 'plot' && <MeasureTrigger icon={<Ruler className="w-4 h-4" />} label={FILTER_PILL_LABELS.plot} isActive={f.minArea !== null || f.maxArea !== null} />}
              {key === 'built' && <MeasureTrigger icon={<Calendar className="w-4 h-4" />} label={FILTER_PILL_LABELS.built} isActive={f.minBuildYear !== null || f.maxBuildYear !== null} />}
              {key === 'rooms' && <MeasureTrigger icon={<Bed className="w-4 h-4" />} label={FILTER_PILL_LABELS.rooms} isActive={!!f.rooms || !!f.bathrooms} />}
              {key === 'metro' && <MeasureTrigger icon={<TrainFront className="w-4 h-4" />} label={FILTER_PILL_LABELS.metro} isActive={f.metro.length > 0} />}
              {key === 'price' && <MeasureTrigger icon={<DollarSign className="w-4 h-4" />} label={FILTER_PILL_LABELS.price} isActive={f.minPrice !== null || f.maxPrice !== null} />}
              {key === 'rentType' && <MeasureTrigger icon={<Home className="w-4 h-4" />} label={FILTER_PILL_LABELS.rentType} isActive={!!f.rentType} />}
              {key === 'amenities' && <MeasureTrigger icon={<Sparkles className="w-4 h-4" />} label={FILTER_PILL_LABELS.amenities} isActive={f.amenities.length > 0} />}
            </div>
          )
        })}
        <div ref={moreMeasureRef} className="shrink-0">
          <MoreMeasureTrigger />
        </div>
        <div ref={clearMeasureRef} className="shrink-0">
          {hasActiveFilters && (
            <div className="flex h-10 rounded-lg overflow-hidden bg-[var(--color-text)] text-white text-sm font-medium">
              <div className="flex items-center px-4 gap-4 whitespace-nowrap font-medium">
                <span>Clear</span>
                <span className={`bg-white/20 px-2 py-0.5 rounded-md text-[11px] tabular-nums font-brand transition-opacity ${listingsCountLoading ? 'opacity-50' : ''}`}>
                  <NumberFlow value={displayCount} />
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div ref={filtersHostRef} className="flex flex-1 min-w-0 items-center gap-[16px] min-h-10">
        {anjukeLayerOn && visibleKeys.map((key) => (
          <div key={key} className="shrink-0">
            {renderInlineFilter(key)}
          </div>
        ))}
        {anjukeLayerOn && showMore && (
          <Dropdown
            icon={<SlidersHorizontal className="w-4 h-4 shrink-0" />}
            label={overflowKeys.length > 1 ? `More (${overflowKeys.length})` : 'More'}
            isActive={overflowActive(overflowKeys, appliedFilters)}
          >
            <div className="px-4 py-3 space-y-1 max-h-[min(70vh,520px)] overflow-y-auto min-w-[260px] max-w-[320px]">
              {overflowKeys.map((k) => renderOverflowSection(k))}
            </div>
          </Dropdown>
        )}
        {/* Above open filter panels (z-200) so Clear stays clickable over dropdowns */}
        {anjukeLayerOn && hasActiveFilters && (
          <div className="relative z-[220] flex shrink-0 h-10 rounded-lg overflow-hidden bg-[var(--color-text)] text-white text-sm font-medium">
            <button
              type="button"
              onClick={resetFilters}
              title="Clear all filters"
              className="px-4 flex items-center gap-4 font-medium text-white/95 hover:bg-black/80 transition-colors cursor-pointer whitespace-nowrap border-0 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <span>Clear</span>
              <span className={`bg-white/20 px-2 py-0.5 rounded-md text-[11px] tabular-nums font-brand transition-opacity ${listingsCountLoading ? 'opacity-50' : ''}`}>
                <NumberFlow value={displayCount} />
              </span>
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-[16px] shrink-0">
        <button
          type="button"
          onClick={() => setTransitPlannerOpen(!transitPlannerOpen)}
          className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer shrink-0 ${
            transitPlannerOpen ? 'bg-[var(--color-primary-light)]' : 'hover:bg-gray-100'
          }`}
          title={transitPlannerOpen ? 'Close transit planner' : 'Plan public transit route'}
          aria-pressed={transitPlannerOpen}
          aria-label="Transit route planner"
        >
          <Route
            className={`w-5 h-5 ${
              transitPlannerOpen
                ? 'text-[var(--color-primary)]'
                : 'text-[var(--color-text)]'
            }`}
          />
        </button>
        <button
          type="button"
          onClick={handleSavedClick}
          className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer shrink-0 ${savedMapViewActive ? 'bg-[var(--color-primary-light)]' : 'hover:bg-gray-100'
            }`}
          title={
            transitPlannerOpen
              ? savedMapViewActive
                ? 'Show communities on map (transit planner stays open)'
                : 'Show saved listings on map (transit planner stays open)'
              : savedMapViewActive
                ? 'Exit saved listings view'
                : 'Show saved listings on map'
          }
          aria-pressed={savedMapViewActive}
          aria-label={
            savedMapViewActive
              ? 'Exit saved listings view'
              : savedListings.length
                ? `Show ${savedListings.length} saved listings on the map`
                : 'Saved listings (none saved yet)'
          }
        >
          <Star
            className={`w-5 h-5 ${savedMapViewActive
                ? 'text-[var(--color-primary)] fill-[var(--color-primary)]'
                : 'text-[var(--color-text)]'
              }`}
          />
          {savedListings.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-bold flex items-center justify-center tabular-nums leading-none">
              {savedListings.length > 99 ? '99+' : savedListings.length}
            </span>
          )}
        </button>

        {isDevAdmin(user) && (
          <button
            type="button"
            onClick={() => navigateTo('/dev')}
            className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer shrink-0 hover:bg-gray-100"
            title="Listing refresh"
          >
            <Wrench className="w-5 h-5 text-[var(--color-text)]" />
          </button>
        )}

        <button
          type="button"
          onClick={async () => {
            if (user) {
              await supabase.auth.signOut()
            } else {
              setAuthModalOpen(true)
            }
          }}
          className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer shrink-0 hover:bg-gray-100"
          title={user ? 'Logout' : 'Login / Register'}
        >
          {user ? <LogOut className="w-5 h-5 " /> : <User className="w-5 h-5 " />}
        </button>
      </div>
    </header>
  )
}
