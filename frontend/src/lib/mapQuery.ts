import { pointInPolygon } from '@/lib/data'
import type { Community, Stop } from '@/lib/types'
import type { FeatureCollection, Polygon } from 'geojson'

export type MapLocationFilterOpts = {
  districts: FeatureCollection | null
  /** When false, only points inside the union of all district polygons are kept. */
  showAreasOutsideFourDistricts: boolean
  allDistrictsActive: boolean
  inactivePolygons: number[][][][]
}

function insideCoreFootprint(lat: number, lng: number, districts: FeatureCollection): boolean {
  return districts.features.some((f) => {
    const geom = f.geometry as Polygon
    return pointInPolygon(lat, lng, geom.coordinates)
  })
}

function insideInactiveDistrict(lat: number, lng: number, inactivePolygons: number[][][][]): boolean {
  for (const poly of inactivePolygons) {
    if (pointInPolygon(lat, lng, poly)) return true
  }
  return false
}

export function communityPassesMapFilters(c: Community, opts: MapLocationFilterOpts): boolean {
  if (opts.districts && !opts.showAreasOutsideFourDistricts) {
    if (!insideCoreFootprint(c.lat, c.lng, opts.districts)) return false
  }
  if (!opts.allDistrictsActive && insideInactiveDistrict(c.lat, c.lng, opts.inactivePolygons)) {
    return false
  }
  return true
}

export function stopPassesMapFilters(s: Stop, opts: MapLocationFilterOpts): boolean {
  if (opts.districts && !opts.showAreasOutsideFourDistricts) {
    if (!insideCoreFootprint(s.lat, s.lon, opts.districts)) return false
  }
  if (!opts.allDistrictsActive && insideInactiveDistrict(s.lat, s.lon, opts.inactivePolygons)) {
    return false
  }
  return true
}
