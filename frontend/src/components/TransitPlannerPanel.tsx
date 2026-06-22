import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  MapPin,
  Clock,
  Loader2,
  GraduationCap,
  MousePointerClick,
  Languages,
  Building2,
  ChevronDown,
  SlidersHorizontal,
  ChevronLeft,
  Star,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/lib/store'
import { segmentKindEmoji } from '@/lib/transitRouteTypes'
import { colorForMetroLineName } from '@/lib/guangzhouMetroLineColors'
import {
  findTransitRoute,
  sortTransitRoutes,
  TRANSIT_ROUTE_SORT_OPTIONS,
  type TransitRouteSortMode,
} from '@/lib/transitRouteSort'
import {
  filterRoutesByExcludedModes,
  TRANSIT_MODE_FILTER_OPTIONS,
  type TransitModeFilter,
} from '@/lib/transitRouteModeFilter'
import {
  formatTransitSegmentText,
  routeBreakdownHasChinese,
  segmentTextsForRoute,
} from '@/lib/transitSegmentText'
import { useTransitBreakdownTranslations } from '@/lib/useTransitBreakdownTranslations'
import { loadScutLocation } from '@/lib/data'

type PickMode = 'none' | 'community' | 'map'

function EndpointPickers({
  pickMode,
  onPickModeChange,
  onScut,
  savedMapActive,
}: {
  pickMode: PickMode
  onPickModeChange: (mode: PickMode) => void
  onScut: () => void
  savedMapActive: boolean
}) {
  const toggle = (mode: Exclude<PickMode, 'none'>) =>
    onPickModeChange(pickMode === mode ? 'none' : mode)

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => toggle('community')}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
          pickMode === 'community'
            ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] border border-[var(--color-primary)]'
            : 'bg-white border border-[var(--color-border)] text-[var(--color-text)] hover:bg-gray-50'
        }`}
      >
        {savedMapActive ? (
          <Star className="w-3.5 h-3.5" aria-hidden />
        ) : (
          <Building2 className="w-3.5 h-3.5" aria-hidden />
        )}
        {savedMapActive ? 'Saved' : 'Communities'}
      </button>
      <button
        type="button"
        onClick={() => toggle('map')}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
          pickMode === 'map'
            ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] border border-[var(--color-primary)]'
            : 'bg-white border border-[var(--color-border)] text-[var(--color-text)] hover:bg-gray-50'
        }`}
      >
        <MousePointerClick className="w-3.5 h-3.5" aria-hidden />
        Pick on map
      </button>
      <button
        type="button"
        onClick={onScut}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer bg-white border border-[var(--color-border)] text-[var(--color-text)] hover:bg-gray-50"
      >
        <GraduationCap className="w-3.5 h-3.5" aria-hidden />
        SCUT
      </button>
    </div>
  )
}

function ExcludeModesDropdown({
  excludedModes,
  onToggle,
  onClear,
}: {
  excludedModes: Set<TransitModeFilter>
  onToggle: (mode: TransitModeFilter) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = excludedModes.size > 0

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors border ${
          active
            ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] border-[var(--color-primary)]'
            : 'bg-white text-gray-600 border-[var(--color-border)] hover:border-gray-300'
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <SlidersHorizontal className="w-3 h-3 shrink-0" aria-hidden />
        Modes
        {active ? (
          <X
            role="button"
            className="w-3 h-3 shrink-0 opacity-70 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            aria-label="Clear mode filters"
          />
        ) : (
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        )}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 min-w-[10.5rem] rounded-xl border border-[var(--color-border)] bg-white shadow-lg z-[200] py-1"
          role="listbox"
          aria-label="Exclude transit modes"
        >
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Exclude modes
          </p>
          {TRANSIT_MODE_FILTER_OPTIONS.map(({ id, label }) => {
            const excluded = excludedModes.has(id)
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={excluded}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(id)
                }}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-xs cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                    excluded
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
                      : 'border-gray-300 bg-white'
                  }`}
                  aria-hidden
                >
                  {excluded && <span className="w-1.5 h-1.5 rounded-sm bg-white" />}
                </span>
                <span className={excluded ? 'text-[var(--color-primary)] font-medium' : 'text-[var(--color-text)]'}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function TransitPlannerPanel() {
  const [routeSort, setRouteSort] = useState<TransitRouteSortMode>('fastest')
  const [showOriginalBreakdown, setShowOriginalBreakdown] = useState(false)
  const [excludedModes, setExcludedModes] = useState<Set<TransitModeFilter>>(() => new Set())

  const {
    setOpen,
    returnPanel,
    selectedCommunity,
    savedMapViewActive,
    origin,
    destination,
    pickOriginMode,
    setPickOriginMode,
    pickDestinationMode,
    setPickDestinationMode,
    setOrigin,
    setDestination,
    clearOrigin,
    clearDestination,
    departDate,
    departTime,
    setDepartDate,
    setDepartTime,
    routes,
    selectedIndex,
    setSelectedIndex,
    loading,
    error,
    cached,
    requestRoutes,
  } = useStore(
    useShallow((s) => ({
      setOpen: s.setTransitPlannerOpen,
      returnPanel: s.transitReturnPanel,
      selectedCommunity: s.selectedCommunity,
      savedMapViewActive: s.savedMapViewActive,
      origin: s.transitOrigin,
      destination: s.transitDestination,
      pickOriginMode: s.transitPickOriginMode,
      setPickOriginMode: s.setTransitPickOriginMode,
      pickDestinationMode: s.transitPickDestinationMode,
      setPickDestinationMode: s.setTransitPickDestinationMode,
      setOrigin: s.setTransitOrigin,
      setDestination: s.setTransitDestination,
      clearOrigin: s.clearTransitOrigin,
      clearDestination: s.clearTransitDestination,
      departDate: s.transitDepartDate,
      departTime: s.transitDepartTime,
      setDepartDate: s.setTransitDepartDate,
      setDepartTime: s.setTransitDepartTime,
      routes: s.transitRoutes,
      selectedIndex: s.transitSelectedRouteIndex,
      setSelectedIndex: s.setTransitSelectedRouteIndex,
      loading: s.transitLoading,
      error: s.transitError,
      cached: s.transitCached,
      requestRoutes: s.requestTransitRoutes,
    })),
  )

  const filteredRoutes = useMemo(
    () => (routes ? filterRoutesByExcludedModes(routes, excludedModes) : null),
    [routes, excludedModes],
  )

  const displayRoutes = useMemo(
    () => (filteredRoutes ? sortTransitRoutes(filteredRoutes, routeSort) : null),
    [filteredRoutes, routeSort],
  )

  const selectedRoute = useMemo(
    () => findTransitRoute(filteredRoutes, selectedIndex),
    [filteredRoutes, selectedIndex],
  )

  const { translatedByRoute, translating } = useTransitBreakdownTranslations(routes)

  const applyScutToOrigin = useCallback(async () => {
    const scut = await loadScutLocation()
    if (!scut) return
    setOrigin({ lat: scut.lat, lng: scut.lon, label: scut.name })
    if (useStore.getState().transitDestination) {
      void useStore.getState().requestTransitRoutes()
    }
  }, [setOrigin])

  const applyScutToDestination = useCallback(async () => {
    const scut = await loadScutLocation()
    if (!scut) return
    setDestination({ lat: scut.lat, lng: scut.lon, label: scut.name })
    if (useStore.getState().transitOrigin) {
      void useStore.getState().requestTransitRoutes()
    }
  }, [setDestination])

  const toggleExcludedMode = (mode: TransitModeFilter) => {
    setExcludedModes((prev) => {
      const next = new Set(prev)
      if (next.has(mode)) next.delete(mode)
      else next.add(mode)
      return next
    })
  }

  const clearExcludedModes = () => setExcludedModes(new Set())

  useEffect(() => {
    setShowOriginalBreakdown(false)
  }, [routes])

  useEffect(() => {
    if (!displayRoutes?.length) return
    if (!displayRoutes.some((r) => r.index === selectedIndex)) {
      setSelectedIndex(displayRoutes[0].index)
    }
  }, [displayRoutes, selectedIndex, setSelectedIndex])

  const backLabel =
    returnPanel === 'saved'
      ? 'To saved listings'
      : returnPanel === 'community' && selectedCommunity
        ? `Back to ${selectedCommunity.name}`
        : savedMapViewActive
          ? 'To saved listings'
          : 'Close planner'

  const emptyEndpointHint = savedMapViewActive
    ? 'Tap a saved listing on the map'
    : 'Choose a community or map point'

  const canSearch = Boolean(origin && destination && !loading)
  const breakdownOriginals = selectedRoute ? segmentTextsForRoute(selectedRoute) : []
  const breakdownLines =
    selectedRoute && !showOriginalBreakdown && translatedByRoute[selectedRoute.index]
      ? translatedByRoute[selectedRoute.index]
      : breakdownOriginals
  const canToggleOriginal =
    selectedRoute &&
    routeBreakdownHasChinese(selectedRoute) &&
    translatedByRoute[selectedRoute.index] &&
    !translating

  return (
    <aside className="w-[383px] bg-white border-l border-[var(--color-border)] flex flex-col h-full overflow-hidden shrink-0">
      <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-primary)] hover:underline cursor-pointer mb-3"
        >
          <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden />
          <span className="text-left leading-snug">{backLabel}</span>
        </button>
        <h2 className="text-2xl font-medium text-[var(--color-text)] leading-snug">Transit planner</h2>
        <p className="text-xs text-gray-500 mt-1">
          Plan public transit between a start point and destination (Amap).
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-[var(--color-bg-card)]">
        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">From</label>
          <div className="relative flex items-center gap-2 text-sm text-[var(--color-text)] rounded-xl bg-white px-3 py-2.5 pr-10">
            <MapPin className="w-4 h-4 shrink-0 text-emerald-600" aria-hidden />
            <div className="min-w-0 flex-1">
              {origin ? (
                <p className="font-medium leading-snug">{origin.label}</p>
              ) : (
                <p className="text-gray-500 leading-snug">{emptyEndpointHint}</p>
              )}
            </div>
            {origin && (
              <button
                type="button"
                onClick={clearOrigin}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer shrink-0"
                aria-label="Clear from"
              >
                <X className="w-3.5 h-3.5 text-gray-500" />
              </button>
            )}
          </div>
          {!origin && (
            <EndpointPickers
              pickMode={pickOriginMode}
              onPickModeChange={setPickOriginMode}
              onScut={() => void applyScutToOrigin()}
              savedMapActive={savedMapViewActive}
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">To</label>
          <div className="relative flex items-center gap-2 text-sm text-[var(--color-text)] rounded-xl bg-white px-3 py-2.5 pr-10">
            <MapPin className="w-4 h-4 shrink-0 text-rose-600" aria-hidden />
            <div className="min-w-0 flex-1">
              {destination ? (
                <p className="font-medium leading-snug truncate">{destination.label}</p>
              ) : (
                <p className="text-gray-500 leading-snug">{emptyEndpointHint}</p>
              )}
            </div>
            {destination && (
              <button
                type="button"
                onClick={clearDestination}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer shrink-0"
                aria-label="Clear to"
              >
                <X className="w-3.5 h-3.5 text-gray-500" />
              </button>
            )}
          </div>
          {!destination && (
            <EndpointPickers
              pickMode={pickDestinationMode}
              onPickModeChange={setPickDestinationMode}
              onScut={() => void applyScutToDestination()}
              savedMapActive={savedMapViewActive}
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" aria-hidden />
            Departure
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              value={departDate}
              onChange={(e) => setDepartDate(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-sm bg-white"
            />
            <input
              type="time"
              value={departTime}
              onChange={(e) => setDepartTime(e.target.value)}
              className="w-[7.5rem] rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-sm bg-white"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={!canSearch}
          onClick={() => void requestRoutes()}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-text)] text-white py-2.5 text-sm font-medium cursor-pointer hover:bg-black/85 disabled:opacity-45 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              Finding routes…
            </>
          ) : (
            'Find routes'
          )}
        </button>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
        )}

        {routes && routes.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Routes ({displayRoutes?.length ?? 0}
                {filteredRoutes && filteredRoutes.length < routes.length
                  ? ` of ${routes.length}`
                  : ''}
                )
              </p>
              {cached && (
                <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  Cached
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 items-center">
              {TRANSIT_ROUTE_SORT_OPTIONS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRouteSort(id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors border ${
                    routeSort === id
                      ? 'bg-[var(--color-text)] text-white border-[var(--color-text)]'
                      : 'bg-white text-gray-600 border-[var(--color-border)] hover:border-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
              <ExcludeModesDropdown
                excludedModes={excludedModes}
                onToggle={toggleExcludedMode}
                onClear={clearExcludedModes}
              />
            </div>

            {displayRoutes && displayRoutes.length > 0 ? (
              <>
            <div className="flex flex-col gap-2">
              {displayRoutes.map((route) => {
                const active = route.index === selectedIndex
                return (
                  <button
                    key={route.index}
                    type="button"
                    onClick={() => setSelectedIndex(route.index)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors cursor-pointer ${
                      active
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                        : 'border-[var(--color-border)] bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-lg font-semibold text-[var(--color-text)] tabular-nums">
                        {route.durationMin} min
                      </span>
                      {route.cost > 0 && <span className="text-xs text-gray-500">¥{route.cost}</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {route.numTransfers === 0
                        ? 'Direct'
                        : `${route.numTransfers} transfer${route.numTransfers === 1 ? '' : 's'}`}
                      {route.walkingDistanceM > 0 && ` · ${Math.round(route.walkingDistanceM)} m walk`}
                    </p>
                  </button>
                )
              })}
            </div>

            {selectedRoute && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Route breakdown
                  </p>
                  {translating && (
                    <span className="text-[10px] text-gray-400 inline-flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                      Translating…
                    </span>
                  )}
                  {canToggleOriginal && (
                    <button
                      type="button"
                      onClick={() => setShowOriginalBreakdown((v) => !v)}
                      className="text-[10px] font-medium text-[var(--color-primary)] hover:underline cursor-pointer inline-flex items-center gap-1"
                    >
                      <Languages className="w-3 h-3" aria-hidden />
                      {showOriginalBreakdown ? 'See translation' : 'See original'}
                    </button>
                  )}
                </div>
                <ol className="space-y-2">
                  {selectedRoute.segments.map((seg, i) => (
                    <li key={i} className="flex gap-2 text-xs text-[var(--color-text)]">
                      <span className="shrink-0" aria-hidden>
                        {segmentKindEmoji(seg.kind)}
                      </span>
                      {seg.kind === 'metro' && seg.line && (
                        <span
                          className="shrink-0 w-3 h-3 rounded-sm mt-0.5 border border-black/10"
                          style={{ background: colorForMetroLineName(seg.line) }}
                          title={seg.line}
                          aria-hidden
                        />
                      )}
                      <span>{breakdownLines[i] ?? formatTransitSegmentText(seg)}</span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-3 pt-1 text-[10px] text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-1 rounded bg-cyan-300 opacity-90" /> Walk
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-1 rounded bg-blue-600" /> Bus
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-1 rounded bg-teal-600" /> Tram
                  </span>
                </div>
              </div>
            )}
              </>
            ) : (
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                No routes match the selected mode filters. Adjust the Modes filter above.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
