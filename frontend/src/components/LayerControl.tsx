import { useEffect, useState, useMemo } from 'react'
import { Map, Flame, TrainFront, Layers, Home, Building, Camera } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/lib/store'
import { loadDistricts } from '@/lib/data'
import type { LayerName, CompoundColorMode, BaseMapStyle } from '@/lib/types'

const LAYERS: { id: LayerName; label: string; icon: React.ReactNode }[] = [
  { id: 'anjuke', label: 'Listings', icon: <Home className="w-5 h-5" /> },
  { id: 'streetview', label: 'Street View', icon: <Camera className="w-5 h-5" /> },
  { id: 'metro', label: 'Metro', icon: <TrainFront className="w-5 h-5" /> },
  { id: 'stops', label: 'Metro stops', icon: <Map className="w-5 h-5" /> },
  { id: 'compounds', label: 'Residential areas', icon: <Building className="w-5 h-5" /> },
  { id: 'heatmap', label: 'Isochrone', icon: <Flame className="w-5 h-5" /> },
  { id: 'baseMap', label: 'Base map', icon: <Layers className="w-5 h-5" /> },
]

const BASE_MAP_STYLES: { id: BaseMapStyle; label: string; hint: string }[] = [
  { id: 'satellite', label: 'Satellite', hint: 'Esri imagery' },
  { id: 'grayscale', label: 'Grayscale', hint: 'OSM + desaturate' },
  { id: 'dark', label: 'Dark', hint: 'Carto dark' },
  { id: 'positron', label: 'Light', hint: 'Carto Positron' },
  { id: 'voyager', label: 'Voyager', hint: 'Carto color roads' },
  { id: 'topo', label: 'Terrain', hint: 'OpenTopoMap' },
]

function LayerCard({ id, label, icon }: { id: LayerName; label: string; icon: React.ReactNode }) {
  const active = useStore((s) => s.layers[id])
  const toggleLayer = useStore((s) => s.toggleLayer)

  return (
    <button
      onClick={() => toggleLayer(id)}
      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-[14px] text-left transition-all cursor-pointer ${
        active
          ? 'bg-[var(--color-primary-light)] border-2 border-[var(--color-primary)] text-[var(--color-primary)]'
          : 'bg-white border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-gray-300'
      }`}
    >
      {icon}
      <span className="font-medium text-base">{label}</span>
    </button>
  )
}

/** One continuous border around the layer row + sub-options when the layer is on. */
function LayerCardWithOptions({
  id,
  label,
  icon,
  children,
}: {
  id: LayerName
  label: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const { layers, toggleLayer } = useStore()
  const active = layers[id]

  if (!active) {
    return <LayerCard id={id} label={label} icon={icon} />
  }

  return (
    <div className="rounded-[14px] overflow-hidden border-2 border-[var(--color-primary)] bg-[var(--color-primary-light)]">
      <button
        type="button"
        onClick={() => toggleLayer(id)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-all cursor-pointer bg-transparent text-[var(--color-primary)] border-0 rounded-none"
      >
        {icon}
        <span className="font-medium text-base">{label}</span>
      </button>
      <div className="bg-white px-3.5 py-3 space-y-2 border-t border-[var(--color-primary)]/25">{children}</div>
    </div>
  )
}


function BaseMapOptionsInner() {
  const { baseMapStyle, setBaseMapStyle } = useStore()

  return (
    <div className="space-y-1.5">
      {BASE_MAP_STYLES.map(({ id, label, hint }) => {
        const active = baseMapStyle === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => setBaseMapStyle(id)}
            className="flex items-center gap-3 cursor-pointer w-full text-left rounded-lg px-1 py-1 -mx-1 hover:bg-gray-50 transition-colors"
          >
            <span
              className={`w-[17px] h-[17px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                active ? 'border-[var(--color-primary)]' : 'border-gray-300'
              }`}
            >
              {active && <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" />}
            </span>
            <span className="flex flex-col min-w-0">
              <span className="text-base text-[var(--color-text)] font-medium leading-tight">{label}</span>
              <span className="text-xs text-gray-400 leading-tight">{hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function CompoundOptionsInner() {
  const compoundColorMode = useStore((s) => s.compoundColorMode)
  const setCompoundColorMode = useStore((s) => s.setCompoundColorMode)

  const options: { mode: CompoundColorMode; label: string }[] = [
    { mode: 'transit', label: 'Show by transit time' },
    { mode: 'ratings', label: 'Show by ratings' },
  ]

  return (
    <>
      {options.map(({ mode, label }) => {
        const active = compoundColorMode === mode
        return (
          <button
            key={mode}
            type="button"
            onClick={() => setCompoundColorMode(active ? 'none' : mode)}
            className="flex items-center gap-3 cursor-pointer w-full text-left"
          >
            <span
              className={`w-[17px] h-[17px] rounded-full border-2 flex items-center justify-center transition-colors ${
                active ? 'border-[var(--color-primary)]' : 'border-gray-300'
              }`}
            >
              {active && <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" />}
            </span>
            <span className="text-base text-[var(--color-text-muted)] font-medium">{label}</span>
          </button>
        )
      })}
    </>
  )
}

function StreetviewOptionsInner() {
  const provider = useStore((s) => s.streetviewProvider)
  const setProvider = useStore((s) => s.setStreetviewProvider)

  const options: { id: typeof provider; label: string }[] = [
    { id: 'tencent', label: 'Tencent Maps' },
    { id: 'baidu', label: 'Baidu Maps' },
  ]

  return (
    <>
      {options.map(({ id, label }) => {
        const active = provider === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => setProvider(id)}
            className="flex items-center gap-3 cursor-pointer w-full text-left"
          >
            <span
              className={`w-[17px] h-[17px] rounded-full border-2 flex items-center justify-center transition-colors ${
                active ? 'border-[var(--color-primary)]' : 'border-gray-300'
              }`}
            >
              {active && <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" />}
            </span>
            <span className="text-base text-[var(--color-text-muted)] font-medium">{label}</span>
          </button>
        )
      })}
    </>
  )
}

const DISTRICT_COLORS: Record<string, string> = {
  '天河区': '#6366f1',
  '越秀区': '#f59e0b',
  '海珠区': '#10b981',
  '荔湾区': '#ef4444',
}

function districtToSvgPath(coords: number[][], bbox: { minX: number; maxX: number; minY: number; maxY: number }, w: number, h: number): string {
  const rangeX = bbox.maxX - bbox.minX
  const rangeY = bbox.maxY - bbox.minY
  const scaleX = w / rangeX
  const scaleY = h / rangeY
  const scale = Math.min(scaleX, scaleY) * 0.9
  const offsetX = (w - rangeX * scale) / 2
  const offsetY = (h - rangeY * scale) / 2

  return coords.map((c, i) => {
    const x = (c[0] - bbox.minX) * scale + offsetX
    const y = h - ((c[1] - bbox.minY) * scale + offsetY)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ') + ' Z'
}

function DistrictSelector() {
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null)
  const { activeDistricts, toggleDistrict, showAreasOutsideFourDistricts, toggleShowAreasOutsideFourDistricts } =
    useStore(
      useShallow((s) => ({
        activeDistricts: s.activeDistricts,
        toggleDistrict: s.toggleDistrict,
        showAreasOutsideFourDistricts: s.showAreasOutsideFourDistricts,
        toggleShowAreasOutsideFourDistricts: s.toggleShowAreasOutsideFourDistricts,
      })),
    )

  useEffect(() => {
    loadDistricts().then(setDistricts)
  }, [])

  const svgData = useMemo(() => {
    if (!districts) return []
    const allCoords: number[][] = []
    for (const f of districts.features) {
      const geom = f.geometry as GeoJSON.Polygon
      for (const c of geom.coordinates[0]) allCoords.push(c)
    }
    if (!allCoords.length) return []

    const bbox = {
      minX: Math.min(...allCoords.map(c => c[0])),
      maxX: Math.max(...allCoords.map(c => c[0])),
      minY: Math.min(...allCoords.map(c => c[1])),
      maxY: Math.max(...allCoords.map(c => c[1])),
    }

    return districts.features.map(f => {
      const props = f.properties as { name: string; nameEn: string }
      const geom = f.geometry as GeoJSON.Polygon
      const ring = geom.coordinates[0]
      const path = districtToSvgPath(ring, bbox, 200, 160)
      return { name: props.name, nameEn: props.nameEn, path }
    })
  }, [districts])

  if (!svgData.length) return null

  return (
    <div className="px-4 pb-2">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">Districts</h3>
      <div className="bg-white border border-[var(--color-border)] rounded-xl p-3">
        <svg viewBox="0 0 200 160" className="w-full block">
          {/* Hit target for “outside” the district shapes (rendered under paths). */}
          <rect
            x={0}
            y={0}
            width={200}
            height={160}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => toggleShowAreasOutsideFourDistricts()}
          />
          {svgData.map(d => {
            const isActive = activeDistricts[d.name]
            const color = DISTRICT_COLORS[d.name] || '#6366f1'
            return (
              <path
                key={d.name}
                d={d.path}
                fill={isActive ? `${color}40` : '#e5e7eb'}
                stroke={isActive ? color : '#9ca3af'}
                strokeWidth={isActive ? 1.5 : 0.5}
                strokeLinejoin="round"
                className="cursor-pointer transition-all"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleDistrict(d.name)
                }}
              />
            )
          })}
        </svg>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
          {svgData.map(d => {
            const isActive = activeDistricts[d.name]
            const color = DISTRICT_COLORS[d.name] || '#6366f1'
            return (
              <button
                type="button"
                key={d.name}
                onClick={() => toggleDistrict(d.name)}
                className="flex items-center gap-1 cursor-pointer"
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm inline-block"
                  style={{ background: isActive ? color : '#d1d5db' }}
                />
                <span className={`text-[10px] font-medium ${isActive ? 'text-[var(--color-text)]' : 'text-gray-400'}`}>
                  {d.nameEn}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => toggleShowAreasOutsideFourDistricts()}
            className="flex items-center gap-1 cursor-pointer ml-1"
            title="Toggle map areas outside the four districts"
          >
            <span
              className="w-2.5 h-2.5 rounded-sm inline-block border border-dashed border-gray-400"
              style={{ background: showAreasOutsideFourDistricts ? 'transparent' : '#9ca3af' }}
            />
            <span className={`text-[10px] font-medium ${showAreasOutsideFourDistricts ? 'text-gray-500' : 'text-[var(--color-text)]'}`}>
              Outside
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LayerControl() {
  return (
    <aside className="w-64 bg-white border-r border-[var(--color-border)] flex flex-col h-full overflow-hidden shrink-0">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">Map Layers</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-2">
          {LAYERS.map((layer) => (
            <div key={layer.id}>
              {layer.id === 'baseMap' ? (
                <LayerCardWithOptions id="baseMap" label={layer.label} icon={layer.icon}>
                  <BaseMapOptionsInner />
                </LayerCardWithOptions>
              ) : layer.id === 'compounds' ? (
                <LayerCardWithOptions id="compounds" label={layer.label} icon={layer.icon}>
                  <CompoundOptionsInner />
                </LayerCardWithOptions>
              ) : layer.id === 'streetview' ? (
                <LayerCardWithOptions id="streetview" label={layer.label} icon={layer.icon}>
                  <StreetviewOptionsInner />
                </LayerCardWithOptions>
              ) : (
                <LayerCard {...layer} />
              )}
            </div>
          ))}
        </div>

        <div className="my-4 border-t border-[var(--color-border)]" />

        <DistrictSelector />
      </div>
    </aside>
  )
}
