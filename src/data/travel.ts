import type { Mode } from './places'

/** Rough minutes from Pike Place Market. These are planning estimates, not live traffic. */
export function travelMinutes(miles: number, mode: Mode): number {
  if (mode === 'walk') return Math.max(5, Math.round((miles / 3) * 60))
  if (mode === 'bike') return Math.max(3, Math.round((miles / 10) * 60))
  return Math.max(6, Math.round((miles / 15) * 60) + 4)
}

export function formatMiles(miles: number): string {
  const rounded = Math.round(miles * 10) / 10
  return `${rounded} mi`
}
