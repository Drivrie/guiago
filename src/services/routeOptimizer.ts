import { calculateDistance } from './routing'
import type { POI } from '../types'

// Average pedestrian walking speed
const WALK_SPEED_MPM = 84 // meters per minute (1.4 m/s)
// Fixed per-leg overhead: traffic lights, crossing, orientation
const WALK_BUFFER_MIN = 2

export interface OptimizedRouteResult {
  pois: POI[]
  totalVisitMinutes: number
  totalWalkMinutes: number
  totalMinutes: number
}

/**
 * Greedy time-budget knapsack optimizer with category diversity scoring.
 *
 * At each step selects the candidate POI that maximises:
 *   score = importance - distance_penalty - category_repeat_penalty
 * subject to the constraint that adding it does not exceed timeBudgetMinutes.
 *
 * "importance" is derived from the pre-sorted candidate order (index 0 = best).
 * This means callers should pass candidates already sorted by relevance.
 *
 * For a dense tourist city (Paris, Tokyo) with avg 400 m between POIs:
 *   walk ≈ 7 min, visit ≈ 12 min → ~5 min/POI cycle → 8-9 POIs in 2 h
 * For a smaller city with avg 700 m between POIs:
 *   walk ≈ 10 min, visit ≈ 12 min → ~22 min/POI cycle → 5-6 POIs in 2 h
 */
export function optimizeRouteByTimeBudget(
  candidates: POI[],
  timeBudgetMinutes: number,
  startLat?: number,
  startLon?: number
): OptimizedRouteResult {
  if (candidates.length === 0) {
    return { pois: [], totalVisitMinutes: 0, totalWalkMinutes: 0, totalMinutes: 0 }
  }

  const importanceScore = new Map<string, number>(
    candidates.map((poi, idx) => [poi.id, candidates.length - idx])
  )

  const selected: POI[] = []
  const remaining = [...candidates]
  let usedMinutes = 0
  let currentLat = startLat ?? candidates[0].lat
  let currentLon = startLon ?? candidates[0].lon
  let totalWalkMinutes = 0

  while (remaining.length > 0) {
    let bestIdx = -1
    let bestScore = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const poi = remaining[i]
      const distM = calculateDistance(currentLat, currentLon, poi.lat, poi.lon)
      const walkMin = selected.length === 0
        ? 0
        : Math.ceil(distM / WALK_SPEED_MPM) + WALK_BUFFER_MIN
      const visitMin = poi.estimatedVisitMinutes ?? 15

      if (usedMinutes + walkMin + visitMin > timeBudgetMinutes) continue

      const importance = importanceScore.get(poi.id) ?? 1
      // Penalise distance to keep the route geographically tight
      const distancePenalty = distM / 350
      // Penalise same-category repeats to improve diversity
      const catRepeats = selected.filter(p => p.category === poi.category).length
      const diversityPenalty = catRepeats * 2

      const score = importance - distancePenalty - diversityPenalty
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestIdx === -1) break

    const chosen = remaining.splice(bestIdx, 1)[0]
    const distM = calculateDistance(currentLat, currentLon, chosen.lat, chosen.lon)
    const walkMin = selected.length === 0
      ? 0
      : Math.ceil(distM / WALK_SPEED_MPM) + WALK_BUFFER_MIN

    chosen.walkingTimeFromPrev = walkMin
    chosen.distanceFromPrev = distM
    usedMinutes += walkMin + (chosen.estimatedVisitMinutes ?? 15)
    totalWalkMinutes += walkMin
    selected.push(chosen)
    currentLat = chosen.lat
    currentLon = chosen.lon
  }

  const totalVisitMinutes = selected.reduce((s, p) => s + (p.estimatedVisitMinutes ?? 15), 0)
  return { pois: selected, totalVisitMinutes, totalWalkMinutes, totalMinutes: usedMinutes }
}

/**
 * Estimate realistic visit duration (minutes) for a walking-tour stop.
 * These are exterior/brief visit times — suitable for city walk routes.
 */
export function estimateVisitMinutesForCategory(category: string, routeType: string): number {
  const cat = category.toLowerCase()

  // Quick exterior views — just a look and photo
  if (/statue|fountain|memorial|milestone|wayside|fuente|estatua|escultura/.test(cat)) return 8
  if (/viewpoint|mirador/.test(cat)) return 10
  if (/artwork|mural|obra de arte|installation|mosaic/.test(cat)) return 8
  if (/monument|monumento/.test(cat)) return 12

  // Medium stops
  if (/church|iglesia|chapel|capilla/.test(cat)) return 15
  if (/cathedral|catedral|basílica|basilica/.test(cat)) return 20
  if (/palace|palacio|castle|castillo/.test(cat)) return 20
  if (/ruins|ruinas|archaeological/.test(cat)) return 15
  if (/park|parque/.test(cat)) return 18
  if (/garden|jardín/.test(cat)) return 15
  if (/market|mercado/.test(cat)) return 25
  if (/theatre|teatro/.test(cat)) return 12
  if (/bridge|puente/.test(cat)) return 8
  if (/square|plaza/.test(cat)) return 10
  if (/cemetery|cementerio/.test(cat)) return 12
  if (/university|universidad/.test(cat)) return 10

  // Longer interior visits
  if (/museum|museo/.test(cat)) return 40
  if (/restaurant|restaurante/.test(cat)) return 45
  if (/bar|cafe|cafetería/.test(cat)) return 35

  // Defaults per route type
  const defaults: Record<string, number> = {
    imprescindibles: 15,
    secretos_locales: 10,
    monumental: 15,
    historia_negra: 10,
    curiosidades: 8,
    gastronomia: 30,
    arquitectura: 12,
    naturaleza: 15,
  }
  return defaults[routeType] ?? 15
}
