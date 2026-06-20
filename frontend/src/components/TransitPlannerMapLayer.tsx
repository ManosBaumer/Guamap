import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Marker, Pane, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useStore } from '@/lib/store'
import { TRANSIT_LEG_STYLES, type TransitRouteLeg } from '@/lib/transitRouteTypes'
import {
  darkenHexColor,
  enrichRouteLegLines,
  isTransitLegKind,
  transitLegStrokeColor,
  TRANSIT_LEG_INNER_WEIGHT,
  TRANSIT_LEG_OUTLINE_EXTRA,
} from '@/lib/transitLegColors'
import {
  directionArrowPlacementsForLeg,
  screenBearingDeg,
  type DirectionArrowPlacement,
} from '@/lib/transitDirectionArrows'
import { findTransitRoute } from '@/lib/transitRouteSort'
import { TransitRouteEndpointCanvas } from '@/components/TransitRouteEndpointCanvas'
import {
  setMapCursorOverride,
  syncMapContainerCursor,
} from '@/lib/mapPointerCursor'

const ARROW_COLOR = '#ffffff'

/** Above default overlay (400) so dashed walk segments sit on top of metro/bus/tram lines. */
const TRANSIT_WALKING_PANE = 'transitWalking'

function DirectionArrow({
  placement,
}: {
  placement: DirectionArrowPlacement
}) {
  const map = useMap()
  const [bearing, setBearing] = useState(0)

  const updateBearing = useCallback(() => {
    setBearing(
      screenBearingDeg(
        map,
        placement.fromLat,
        placement.fromLng,
        placement.toLat,
        placement.toLng,
      ),
    )
  }, [map, placement.fromLat, placement.fromLng, placement.toLat, placement.toLng])

  useEffect(() => {
    updateBearing()
    map.on('move zoom zoomend moveend viewreset', updateBearing)
    return () => {
      map.off('move zoom zoomend moveend viewreset', updateBearing)
    }
  }, [map, updateBearing])

  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'guamap-transit-direction-arrow',
        html: `<div style="width:0;height:0;border-left:3.5px solid transparent;border-right:3.5px solid transparent;border-bottom:6px solid ${ARROW_COLOR};transform:rotate(${bearing}deg);transform-origin:50% 55%;filter:drop-shadow(0 0 0.5px rgba(0,0,0,.45))"></div>`,
        iconSize: [7, 7],
        iconAnchor: [3.5, 3.5],
      }),
    [bearing],
  )

  return (
    <Marker
      position={[placement.lat, placement.lng]}
      icon={icon}
      interactive={false}
      zIndexOffset={600}
    />
  )
}

function RouteLegPolylines({
  leg,
  legKey,
  pane,
}: {
  leg: TransitRouteLeg
  legKey: string
  pane?: string
}) {
  const style = TRANSIT_LEG_STYLES[leg.kind]
  const color = transitLegStrokeColor(leg)
  const shared = {
    positions: leg.coordinates,
    pathOptions: {
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
    },
  }

  if (!isTransitLegKind(leg.kind)) {
    return (
      <Polyline
        key={legKey}
        pane={pane}
        {...shared}
        pathOptions={{
          ...shared.pathOptions,
          color: style.color,
          weight: style.weight,
          opacity: style.opacity,
          dashArray: style.dashArray,
        }}
      />
    )
  }

  const outlineColor = darkenHexColor(color)
  const innerWeight = TRANSIT_LEG_INNER_WEIGHT
  const outlineWeight = innerWeight + TRANSIT_LEG_OUTLINE_EXTRA

  return (
    <>
      <Polyline
        key={`${legKey}-outline`}
        pane={pane}
        {...shared}
        pathOptions={{
          ...shared.pathOptions,
          color: outlineColor,
          weight: outlineWeight,
          opacity: 1,
        }}
      />
      <Polyline
        key={`${legKey}-fill`}
        pane={pane}
        {...shared}
        pathOptions={{
          ...shared.pathOptions,
          color,
          weight: innerWeight,
          opacity: style.opacity,
        }}
      />
    </>
  )
}

export function TransitPlannerMapLayer() {
  const map = useMap()
  const open = useStore((s) => s.transitPlannerOpen)
  const pickOriginMode = useStore((s) => s.transitPickOriginMode)
  const pickDestinationMode = useStore((s) => s.transitPickDestinationMode)
  const destination = useStore((s) => s.transitDestination)
  const origin = useStore((s) => s.transitOrigin)
  const routes = useStore((s) => s.transitRoutes)
  const selectedIndex = useStore((s) => s.transitSelectedRouteIndex)
  const setOrigin = useStore((s) => s.setTransitOrigin)
  const setDestination = useStore((s) => s.setTransitDestination)
  const requestRoutes = useStore((s) => s.requestTransitRoutes)

  const activeRoute = findTransitRoute(routes, selectedIndex)
  const pickingOnMap = pickOriginMode === 'map' || pickDestinationMode === 'map'

  useEffect(() => {
    if (!open) {
      setMapCursorOverride(null)
      syncMapContainerCursor(map)
      return
    }
    setMapCursorOverride(pickingOnMap ? 'crosshair' : null)
    syncMapContainerCursor(map)
    return () => {
      setMapCursorOverride(null)
      syncMapContainerCursor(map)
    }
  }, [map, open, pickingOnMap])

  useEffect(() => {
    if (!open) return

    const onClick = (e: L.LeafletMouseEvent) => {
      if (pickOriginMode === 'map') {
        L.DomEvent.stopPropagation(e)
        const label = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`
        setOrigin({ lat: e.latlng.lat, lng: e.latlng.lng, label })
        const state = useStore.getState()
        if (state.transitDestination) {
          void state.requestTransitRoutes()
        }
        return
      }

      if (pickDestinationMode === 'map') {
        L.DomEvent.stopPropagation(e)
        const label = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`
        setDestination({ lat: e.latlng.lat, lng: e.latlng.lng, label })
        const state = useStore.getState()
        if (state.transitOrigin) {
          void state.requestTransitRoutes()
        }
      }
    }

    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [
    map,
    open,
    pickOriginMode,
    pickDestinationMode,
    setOrigin,
    setDestination,
    requestRoutes,
  ])

  const enrichedLegs = useMemo(
    () => (activeRoute ? enrichRouteLegLines(activeRoute) : []),
    [activeRoute],
  )

  const { transitLegElements, walkingLegElements } = useMemo(() => {
    if (!enrichedLegs.length) {
      return { transitLegElements: null, walkingLegElements: null }
    }
    const transit: ReactNode[] = []
    const walking: ReactNode[] = []
    enrichedLegs.forEach((leg, i) => {
      const legKey = `${selectedIndex}-${i}-${leg.kind}-${leg.line ?? ''}`
      const el = (
        <RouteLegPolylines
          key={legKey}
          leg={leg}
          legKey={legKey}
          pane={leg.kind === 'walking' ? TRANSIT_WALKING_PANE : undefined}
        />
      )
      if (leg.kind === 'walking') walking.push(el)
      else transit.push(el)
    })
    return {
      transitLegElements: transit.length ? transit : null,
      walkingLegElements: walking.length ? walking : null,
    }
  }, [enrichedLegs, selectedIndex])

  const arrowPlacements = useMemo(() => {
    if (!enrichedLegs.length) return []
    return enrichedLegs.flatMap((leg, i) =>
      directionArrowPlacementsForLeg(leg, `${selectedIndex}-${i}`),
    )
  }, [enrichedLegs, selectedIndex])

  if (!open) return null

  return (
    <>
      {transitLegElements}
      <Pane name={TRANSIT_WALKING_PANE} style={{ zIndex: 445 }}>
        {walkingLegElements}
      </Pane>
      <TransitRouteEndpointCanvas />
      {arrowPlacements.map((p) => (
        <DirectionArrow key={p.key} placement={p} />
      ))}
    </>
  )
}
