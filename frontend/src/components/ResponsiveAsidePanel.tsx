import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { mapStageHeight } from '@/hooks/useTopChromeHeight'

/** Panel height bounds as a fraction of the map stage (not full viewport). */
const SNAP_PEEK = 0.1
const SNAP_EXPANDED = 1
/** Default height when a panel opens — not a drag snap point. */
const DEFAULT_HEIGHT = 0.75

/** Snap only when released near min/max; otherwise keep the exact drag position. */
const EDGE_SNAP_THRESHOLD = 0.04

function clampWithEdgeSnap(ratio: number): number {
  const clamped = Math.max(SNAP_PEEK, Math.min(SNAP_EXPANDED, ratio))
  if (clamped <= SNAP_PEEK + EDGE_SNAP_THRESHOLD) return SNAP_PEEK
  if (clamped >= SNAP_EXPANDED - EDGE_SNAP_THRESHOLD) return SNAP_EXPANDED
  return clamped
}

function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const onChange = () => setCompact(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return compact
}

/**
 * Shared shell for the right-hand panel (community / saved listings / transit planner).
 *
 * - `lg` and up: normal sidebar, in flex flow next to the map (unchanged desktop layout).
 * - below `lg` (phones + tablets): bottom sheet within the map area (never overlaps the top bar).
 */
export default function ResponsiveAsidePanel({
  children,
  className = '',
  panelKey,
}: {
  children: ReactNode
  className?: string
  panelKey?: string | number | null
}) {
  const compact = useCompactLayout()
  const [heightRatio, setHeightRatio] = useState(DEFAULT_HEIGHT)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startRatio: number
  } | null>(null)
  const movedRef = useRef(false)

  useEffect(() => {
    setHeightRatio(DEFAULT_HEIGHT)
  }, [panelKey])

  const finishDrag = useCallback((clientY: number) => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)

    if (!drag) return

    const stageH = mapStageHeight()
    const deltaY = drag.startY - clientY
    const deltaRatio = stageH > 0 ? deltaY / stageH : 0
    const finalRatio = Math.max(SNAP_PEEK, Math.min(SNAP_EXPANDED, drag.startRatio + deltaRatio))

    setHeightRatio(clampWithEdgeSnap(finalRatio))
    window.setTimeout(() => {
      movedRef.current = false
    }, 0)
  }, [])

  const onDragPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!compact) return
      if (e.button !== 0) return

      movedRef.current = false
      dragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startRatio: heightRatio,
      }
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [compact, heightRatio],
  )

  const onDragPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return

    const deltaY = drag.startY - e.clientY
    if (Math.abs(deltaY) > 6) movedRef.current = true

    e.preventDefault()
    const stageH = mapStageHeight()
    const deltaRatio = stageH > 0 ? deltaY / stageH : 0
    const next = Math.max(SNAP_PEEK, Math.min(SNAP_EXPANDED, drag.startRatio + deltaRatio))
    setHeightRatio(next)
  }, [])

  const onDragPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      e.currentTarget.releasePointerCapture(e.pointerId)
      finishDrag(e.clientY)
    },
    [finishDrag],
  )

  const onDragPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      finishDrag(e.clientY)
    },
    [finishDrag],
  )

  const onHandleTap = useCallback(() => {
    if (!compact || dragging || movedRef.current) return
    setHeightRatio((r) => (r >= SNAP_EXPANDED - EDGE_SNAP_THRESHOLD ? SNAP_PEEK : SNAP_EXPANDED))
  }, [compact, dragging])

  return (
    <aside
      className={`
        absolute inset-x-0 bottom-0 z-[1200] bg-white flex flex-col overflow-hidden pointer-events-auto
        rounded-t-[28px] border-t border-[var(--color-border)] shadow-2xl
        lg:static lg:inset-auto lg:w-[383px] lg:max-w-none lg:h-full lg:shrink-0
        lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none lg:z-auto
        ${dragging ? '' : 'transition-[height] duration-300 ease-out'}
        ${className}
      `}
      style={compact ? { height: `${heightRatio * 100}%` } : undefined}
    >
      <div className="lg:hidden relative shrink-0 flex items-center justify-center py-3">
        <div
          role="button"
          tabIndex={0}
          aria-label="Drag or tap to resize panel"
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-14 touch-none select-none cursor-grab active:cursor-grabbing z-10"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerCancel}
          onClick={onHandleTap}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onHandleTap()
            }
          }}
        />
        <span className="w-12 h-1.5 rounded-full bg-gray-300 pointer-events-none" aria-hidden />
      </div>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden pointer-events-auto">{children}</div>
    </aside>
  )
}
