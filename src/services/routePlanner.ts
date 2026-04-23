/**
 * Tourist route planner.
 *
 * Selects and orders POIs from a candidate list under a time budget so the
 * resulting walking tour:
 *   1. Maximizes total tourist relevance (score from overpass/wikigeo).
 *   2. Fits inside `budgetMinutes` (visit time + walking time).
 *   3. Keeps category diversity (no more than ⅓ of stops in the same family).
 *   4. Walks a short, non-zigzagging path (greedy + 2-opt optimisation).
 *
 * Why a custom planner instead of the previous "top-N + nearest-neighbour":
 * the previous approach often produced routes whose total walking time alone
 * exceeded the budget, or that missed an emblematic stop only because it sat
 * 100 m further away than a less interesting one.
 *
 * Algorithm (greedy with backtracking-light):
 *   • Anchor at the highest-scoring POI ("must include").
 *   • Repeatedly add the POI that maximises score / (visit_time + walk_time
 *     from the closest anchor in the current set), while respecting the budget
 *     and the diversity cap.
 *   • Once the set is fixed, run 2-opt swaps over the ordering to cut crossings.
 *
 * This is a coarse approximation to Knapsack + TSP — exact solvers are O(2^n)
 * and overkill for n ≤ 25.
 */

import type { POI } from '../types'
import { calculateDistance } from './routing'

const WALK_SPEED_M_PER_MIN = 75 // ~4.5 km/h, comfortable tourist pace

/** A POI annotated with its planner score. */
export interface ScoredPOI extends POI {
  _plannerScore: number
}

export interface PlannerOptions {
  /** Total available time, including walking, in minutes. */
  budgetMinutes: number
  /** Optional starting coordinate (e.g. user GPS). When omitted, anchors at the highest-scored POI. */
  startLat?: number
  startLon?: number
  /** Min number of stops we should aim for, even if it eats into the budget. */
  minStops?: number
  /** Hard cap on stops, even with budget left. */
  maxStops?: number
  /** Cap of POIs from the same category family, default ⌈stops/3⌉. */
  diversityCap?: number
}

/** Coarse category family for diversity capping. */
function familyOf(category: string): string {
  const c = (category || '').toLowerCase()
  if (/(catedral|basílica|iglesia|capilla|mezquita|sinagoga|convento|monasterio|cathedral|church|chapel|mosque|synagogue)/.test(c)) return 'religious'
  if (/(museo|museum|galería|gallery)/.test(c)) return 'museum'
  if (/(palacio|palace|castillo|castle|alcázar|alhambra|fortaleza|fort)/.test(c)) return 'palace'
  if (/(plaza|square)/.test(c)) return 'square'
  if (/(mercado|market)/.test(c)) return 'market'
  if (/(jardín|garden|parque|park)/.test(c)) return 'garden'
  if (/(mirador|viewpoint|torre|tower)/.test(c)) return 'viewpoint'
  if (/(monumento|monument|memorial|estatua|statue|fuente|fountain|puente|bridge)/.test(c)) return 'monument'
  if (/(restaurante|restaurant|bar|cafetería|cafe|bakery|food)/.test(c)) return 'food'
  return 'other'
}

/**
 * Compute the relevance score for a candidate POI.
 *
 * Order of preference:
 *  1. `_score` previously stashed in tags by wikigeo (Wikipedia-derived signal).
 *  2. Overpass-style heuristic (presence of wikipedia/wikidata/heritage/etc.).
 *  3. Fallback: 1 so the POI is at least considered.
 */
export function plannerScore(poi: POI): number {
  const stashed = poi.tags?._score
  if (stashed !== undefined) {
    const n = parseFloat(stashed)
    if (!isNaN(n)) return Math.max(1, n + 5) // +5 baseline so even low Wikipedia matches beat plain OSM nodes
  }

  const tags = poi.tags || {}
  let s = 1
  if (tags.wikipedia || poi.wikipediaTitle) s += 10
  if (tags.wikidata) s += 6
  if (tags.heritage) s += 8
  if (tags['heritage:operator'] === 'unesco' || tags['ref:whc']) s += 25
  if (tags.tourism === 'museum') s += 8
  if (tags.tourism === 'attraction') s += 5
  if (tags.image || tags.wikimedia_commons) s += 3
  if (tags.description) s += 3
  if (tags.architect || tags['architecture:style']) s += 4

  const cat = (poi.category || '').toLowerCase()
  if (/(catedral|cathedral|basílica|alhambra|alcázar)/.test(cat)) s += 22
  else if (/(palacio|palace|castle|castillo)/.test(cat)) s += 16
  else if (/(museo|museum)/.test(cat)) s += 12
  else if (/(monumento|monument|ruins)/.test(cat)) s += 10
  else if (/(plaza|square|mercado|market)/.test(cat)) s += 6
  else if (/(iglesia|church)/.test(cat)) s += 4

  return s
}

/** Estimated walking time in minutes between two coordinates. */
function walkMinutes(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const m = calculateDistance(a.lat, a.lon, b.lat, b.lon)
  return m / WALK_SPEED_M_PER_MIN
}

/** Visit time fallback when the POI has none. */
function visitMins(poi: POI): number {
  if (poi.estimatedVisitMinutes && poi.estimatedVisitMinutes > 0) return poi.estimatedVisitMinutes
  // Sensible default by category
  const cat = (poi.category || '').toLowerCase()
  if (/museo|museum/.test(cat)) return 60
  if (/catedral|cathedral|palace|palacio|castle|castillo/.test(cat)) return 30
  if (/restaurante|restaurant|bar|mercado|market/.test(cat)) return 45
  return 20
}

/** Distance from candidate POI to the nearest POI in the picked set. */
function nearestPickedDistance(
  candidate: POI,
  picked: POI[],
  startLat?: number,
  startLon?: number
): number {
  let best = Infinity
  if (startLat !== undefined && startLon !== undefined) {
    best = walkMinutes({ lat: startLat, lon: startLon }, candidate)
  }
  for (const p of picked) {
    const d = walkMinutes(p, candidate)
    if (d < best) best = d
  }
  return best === Infinity ? 0 : best
}

/**
 * Select POIs that fit the budget and maximise total relevance.
 *
 * The picker iterates: at each step it considers every still-available candidate
 * and computes its marginal "value" as score / (visit + walk_to_nearest_picked).
 * The candidate with the best ratio is added if it still fits the budget.
 *
 * Diversity is enforced by capping how many POIs of the same family we accept.
 */
export function selectPOIsForBudget(
  candidates: POI[],
  options: PlannerOptions
): POI[] {
  if (candidates.length === 0) return []

  const budget = Math.max(30, options.budgetMinutes)
  const minStops = options.minStops ?? 3
  const maxStops = options.maxStops ?? Math.max(minStops, Math.floor(budget / 18))
  const diversityCap = options.diversityCap ?? Math.max(2, Math.ceil(maxStops / 3))

  // Pre-score everything once
  const scored: ScoredPOI[] = candidates.map(p => ({ ...p, _plannerScore: plannerScore(p) }))

  // Anchor: the highest-scoring POI. If a startLat/startLon is given, prefer the
  // POI that maximises score / (1 + walk_from_start_min) so we don't anchor 5km away.
  let anchor: ScoredPOI | null = null
  if (options.startLat !== undefined && options.startLon !== undefined) {
    anchor = scored.reduce((best, p) => {
      const d = walkMinutes({ lat: options.startLat!, lon: options.startLon! }, p)
      const ratio = p._plannerScore / (1 + d * 0.3)
      const bestRatio = best ? best._plannerScore / (1 + walkMinutes({ lat: options.startLat!, lon: options.startLon! }, best) * 0.3) : -Infinity
      return ratio > bestRatio ? p : best
    }, null as ScoredPOI | null)
  } else {
    anchor = scored.reduce((best, p) => (!best || p._plannerScore > best._plannerScore ? p : best), null as ScoredPOI | null)
  }
  if (!anchor) return []

  const picked: ScoredPOI[] = [anchor]
  const familyCount = new Map<string, number>([[familyOf(anchor.category), 1]])
  let timeUsed = visitMins(anchor)
  if (options.startLat !== undefined && options.startLon !== undefined) {
    timeUsed += walkMinutes({ lat: options.startLat, lon: options.startLon }, anchor)
  }
  const remaining: ScoredPOI[] = scored.filter(p => p.id !== anchor!.id)

  while (picked.length < maxStops && remaining.length > 0) {
    let bestCandidate: ScoredPOI | null = null
    let bestRatio = -Infinity
    let bestCost = 0

    for (const candidate of remaining) {
      const fam = familyOf(candidate.category)
      const used = familyCount.get(fam) || 0
      // Diversity cap — but relax it if we still don't have enough stops to meet minStops
      if (used >= diversityCap && picked.length >= minStops) continue

      const walkCost = nearestPickedDistance(candidate, picked, options.startLat, options.startLon)
      const visitCost = visitMins(candidate)
      const totalCost = walkCost + visitCost
      // Predicted budget hit if added (we approximate added time as walkCost+visitCost,
      // which is generous because new POIs may share existing walks).
      if (timeUsed + totalCost > budget && picked.length >= minStops) continue

      // Marginal value = score per minute spent (with small distance regularizer)
      const ratio = candidate._plannerScore / (1 + totalCost * 0.6)
      if (ratio > bestRatio) {
        bestRatio = ratio
        bestCandidate = candidate
        bestCost = totalCost
      }
    }

    if (!bestCandidate) break

    picked.push(bestCandidate)
    familyCount.set(familyOf(bestCandidate.category), (familyCount.get(familyOf(bestCandidate.category)) || 0) + 1)
    timeUsed += bestCost
    remaining.splice(remaining.findIndex(p => p.id === bestCandidate!.id), 1)
  }

  // Strip planner score before returning
  return picked.map(({ _plannerScore: _ignored, ...p }) => p)
}

/**
 * Order POIs into a near-optimal walking sequence.
 *
 * Strategy:
 *  1. Greedy nearest-neighbour seed (anchored at startLat/startLon if given,
 *     otherwise at the first POI).
 *  2. 2-opt local search: repeatedly reverses sub-tours that reduce total path
 *     length. Bounded to 200 iterations and 50ms wall-clock to keep UI snappy.
 *
 * Walking-only paths are rarely directional (no one-way streets to worry about),
 * so 2-opt converges very quickly to within ~5% of optimal for n ≤ 20.
 */
export function orderForWalking<T extends { lat: number; lon: number }>(
  pois: T[],
  startLat?: number,
  startLon?: number
): T[] {
  if (pois.length <= 2) return [...pois]

  // Step 1: nearest-neighbour seed
  const ordered: T[] = []
  const remaining = [...pois]
  let curLat = startLat ?? remaining[0].lat
  let curLon = startLon ?? remaining[0].lon

  if (startLat === undefined || startLon === undefined) {
    const first = remaining.shift()!
    ordered.push(first)
    curLat = first.lat
    curLon = first.lon
  }

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = calculateDistance(curLat, curLon, remaining[i].lat, remaining[i].lon)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]
    ordered.push(next)
    curLat = next.lat
    curLon = next.lon
  }

  // Step 2: 2-opt refinement
  return twoOpt(ordered, startLat, startLon)
}

function pathLength<T extends { lat: number; lon: number }>(
  path: T[],
  startLat?: number,
  startLon?: number
): number {
  if (path.length < 2) return 0
  let total = 0
  if (startLat !== undefined && startLon !== undefined) {
    total += calculateDistance(startLat, startLon, path[0].lat, path[0].lon)
  }
  for (let i = 0; i < path.length - 1; i++) {
    total += calculateDistance(path[i].lat, path[i].lon, path[i + 1].lat, path[i + 1].lon)
  }
  return total
}

/**
 * 2-opt optimisation: try reversing every sub-tour [i..j]; keep the swap if the
 * new path is shorter. Repeats until no improvement found or we hit the budget.
 *
 * Note: when a fixed start point is given we never move position 0 — the first
 * POI must remain the closest one to the user.
 */
function twoOpt<T extends { lat: number; lon: number }>(
  path: T[],
  startLat?: number,
  startLon?: number
): T[] {
  const start = performance.now()
  const fixFirst = startLat !== undefined && startLon !== undefined
  let best = [...path]
  let bestLen = pathLength(best, startLat, startLon)
  let improved = true
  let iterations = 0
  const maxIterations = 200
  const maxMs = 50

  while (improved && iterations < maxIterations && performance.now() - start < maxMs) {
    improved = false
    iterations++
    const startI = fixFirst ? 1 : 0
    for (let i = startI; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        const candLen = pathLength(candidate, startLat, startLon)
        if (candLen + 1 < bestLen) {  // +1m epsilon to avoid floating noise
          best = candidate
          bestLen = candLen
          improved = true
        }
      }
    }
  }

  return best
}

/**
 * Convenience: full pipeline = score + budget-fit + 2-opt order.
 * Use this from RouteSetupPage as the single entry point for route planning.
 */
export function planRoute(
  candidates: POI[],
  options: PlannerOptions
): POI[] {
  const selected = selectPOIsForBudget(candidates, options)
  return orderForWalking(selected, options.startLat, options.startLon)
}
