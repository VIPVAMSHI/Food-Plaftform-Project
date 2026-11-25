import { places } from '../../src/data/places.js'
import type { PlaceRecord } from '../../shared/types.js'

/**
 * The 68 places are fixed sample data, bundled with the server (the browser bundles the same file).
 * Serving them from memory means places, search and the assistant keep working when the database is down.
 */
export const PLACES: readonly PlaceRecord[] = places.map((place) => ({ ...place }))
export const PLACE_COUNT = PLACES.length

const byId = new Map(PLACES.map((place) => [place.id, place]))

export function getPlace(id: string): PlaceRecord | null {
  return byId.get(id) ?? null
}

export type PlaceFilters = { q?: string; neighborhood?: string; cuisine?: string; maxPrice?: number }

/** Case-insensitive filters. `q` is plain text matched anywhere in the name, cuisine, area, address, note or dishes. */
export function listPlaces(filters: PlaceFilters = {}): PlaceRecord[] {
  const neighborhood = filters.neighborhood?.toLowerCase()
  const cuisine = filters.cuisine?.toLowerCase()
  const q = filters.q?.toLowerCase()
  return PLACES.filter(
    (place) =>
      (!neighborhood || place.neighborhood.toLowerCase() === neighborhood) &&
      (!cuisine || place.cuisine.toLowerCase() === cuisine) &&
      (filters.maxPrice == null || place.serving <= filters.maxPrice) &&
      (!q || [place.name, place.cuisine, place.neighborhood, place.address, place.note, ...place.dishes].join(' ').toLowerCase().includes(q)),
  )
}
