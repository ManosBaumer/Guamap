import L from 'leaflet'

/** Above community count canvas (620). */
const POPUP_Z_INDEX = 680

type ActivePopup = {
  wrap: HTMLDivElement
  onMapChange: () => void
  onKeyDown: (ev: KeyboardEvent) => void
}

let active: ActivePopup | null = null

function repositionPopup(map: L.Map, lat: number, lon: number, wrap: HTMLDivElement) {
  const pt = map.latLngToContainerPoint(L.latLng(lat, lon))
  wrap.style.left = `${pt.x}px`
  wrap.style.top = `${pt.y - 14}px`
}

export function closeStopMapPopup() {
  if (!active) return
  const { wrap, onMapChange, onKeyDown } = active
  const map = (wrap as HTMLDivElement & { _guamapMap?: L.Map })._guamapMap
  if (map) {
    map.off('move zoom resize viewreset', onMapChange)
  }
  document.removeEventListener('keydown', onKeyDown)
  wrap.remove()
  active = null
}

export function openStopMapPopup(
  map: L.Map,
  lat: number,
  lon: number,
  html: string,
): void {
  closeStopMapPopup()

  const container = map.getContainer()
  const wrap = document.createElement('div')
  wrap.className = 'guamap-stop-map-popup-wrap'
  wrap.style.cssText = `position:absolute;z-index:${POPUP_Z_INDEX};pointer-events:auto;transform:translate(-50%,-100%);`
  ;(wrap as HTMLDivElement & { _guamapMap?: L.Map })._guamapMap = map

  wrap.innerHTML = `
    <div class="guamap-stop-map-popup relative rounded-lg border border-[var(--color-border)] bg-white shadow-lg overflow-hidden">
      <button type="button" class="guamap-stop-map-popup-close absolute top-1.5 right-1.5 w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-500 cursor-pointer text-base leading-none" aria-label="Close">×</button>
      <div class="guamap-stop-map-popup-body px-3 py-2.5 pr-8">${html}</div>
    </div>
  `

  const closeBtn = wrap.querySelector('.guamap-stop-map-popup-close')
  closeBtn?.addEventListener('click', (ev) => {
    L.DomEvent.stopPropagation(ev)
    closeStopMapPopup()
  })

  container.appendChild(wrap)

  const onMapChange = () => repositionPopup(map, lat, lon, wrap)
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeStopMapPopup()
  }
  map.on('move zoom resize viewreset', onMapChange)
  document.addEventListener('keydown', onKeyDown)
  repositionPopup(map, lat, lon, wrap)

  active = { wrap, onMapChange, onKeyDown }
}

export function setStopMapPopupHtml(html: string) {
  if (!active) return
  const body = active.wrap.querySelector('.guamap-stop-map-popup-body')
  if (body) body.innerHTML = html
}
