import { useEffect, useState } from 'react'

export const TOP_CHROME_ID = 'guamap-top-chrome'
export const MAP_STAGE_ID = 'guamap-map-stage'

/** Height of the filter bar header — used to position overlays below it. */
export function useTopChromeHeight(): number {
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const el = document.getElementById(TOP_CHROME_ID)
    if (!el) return

    const measure = () => setHeight(el.getBoundingClientRect().height)
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return height
}

export function mapStageHeight(): number {
  const stage = document.getElementById(MAP_STAGE_ID)
  return stage?.clientHeight ?? window.innerHeight
}
