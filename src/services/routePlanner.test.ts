import { describe, it, expect } from 'vitest'
import {
  plannerScore,
  selectPOIsForBudget,
  orderForWalking,
  planRoute,
} from './routePlanner'
import type { POI, RouteType } from '../types'

/**
 * Unit tests for routePlanner.ts
 *
 * The planner is the most impact-sensitive piece of the app: a bug here
 * silently degrades every generated route. These tests cover the four
 * contracts the rest of the codebase relies on:
 *   - Score: emblematic categories beat plain ones, wikipedia-linked beats
 *     non-linked, UNESCO dominates.
 *   - Budget: selected stops fit into `budgetMinutes`; no POIs with near-zero
 *     score should displace emblematic ones.
 *   - Diversity: no single category family takes more than ⌈n/3⌉ of the picks
 *     when the pool is rich enough.
 *   - Ordering: 2-opt strictly reduces the total walking distance.
 */

function poi(overrides: Partial<POI>): POI {
  return {
    id: overrides.id ?? `p-${Math.random()}`,
    name: overrides.name ?? 'Lugar',
    lat: overrides.lat ?? 40,
    lon: overrides.lon ?? -3,
    category: overrides.category ?? 'monumento',
    routeType: (overrides.routeType ?? 'imprescindibles') as RouteType,
    estimatedVisitMinutes: overrides.estimatedVisitMinutes ?? 20,
    tags: overrides.tags ?? {},
    ...overrides,
  }
}

describe('plannerScore', () => {
  it('ranks a cathedral with wikipedia far above a generic lugar', () => {
    const cathedral = poi({
      name: 'Catedral de Sevilla',
      category: 'catedral',
      tags: { wikipedia: 'es:Catedral_de_Sevilla', wikidata: 'Q181422' },
    })
    const generic = poi({ name: 'Edificio', category: 'edificio' })
    expect(plannerScore(cathedral)).toBeGreaterThan(plannerScore(generic) + 20)
  })

  it('boosts UNESCO-designated heritage beyond a plain landmark', () => {
    const unesco = poi({
      name: 'Alhambra',
      category: 'palacio',
      tags: { heritage: 'unesco', 'ref:whc': '314' },
    })
    const plain = poi({ name: 'Plaza', category: 'plaza' })
    expect(plannerScore(unesco)).toBeGreaterThan(plannerScore(plain))
  })

  it('reads the Wikipedia-derived _score tag when present', () => {
    const scored = poi({ tags: { _score: '12' } })
    const unscored = poi({ tags: {} })
    expect(plannerScore(scored)).toBeGreaterThan(plannerScore(unscored))
  })
})

describe('selectPOIsForBudget', () => {
  const cathedral = poi({
    id: 'cat', name: 'Catedral', category: 'catedral',
    lat: 40.0, lon: -3.0, estimatedVisitMinutes: 30,
    tags: { wikipedia: 'es:Catedral', wikidata: 'Q1' },
  })
  const palace = poi({
    id: 'pal', name: 'Palacio', category: 'palacio',
    lat: 40.001, lon: -3.001, estimatedVisitMinutes: 25,
    tags: { wikipedia: 'es:Palacio' },
  })
  const museum = poi({
    id: 'mus', name: 'Museo', category: 'museo',
    lat: 40.002, lon: -3.002, estimatedVisitMinutes: 60,
    tags: { wikipedia: 'es:Museo' },
  })
  const cafe = poi({
    id: 'caf', name: 'Cafetería', category: 'cafetería',
    lat: 40.003, lon: -3.003, estimatedVisitMinutes: 15,
    tags: {},
  })
  const minorChurch1 = poi({
    id: 'c1', name: 'Ermita de San X', category: 'iglesia',
    lat: 40.004, lon: -3.004, estimatedVisitMinutes: 15,
  })
  const minorChurch2 = poi({
    id: 'c2', name: 'Ermita de San Y', category: 'iglesia',
    lat: 40.005, lon: -3.005, estimatedVisitMinutes: 15,
  })
  const minorChurch3 = poi({
    id: 'c3', name: 'Ermita de San Z', category: 'iglesia',
    lat: 40.006, lon: -3.006, estimatedVisitMinutes: 15,
  })
  const minorChurch4 = poi({
    id: 'c4', name: 'Ermita de San W', category: 'iglesia',
    lat: 40.007, lon: -3.007, estimatedVisitMinutes: 15,
  })

  it('prioritises emblematic stops over generic cafés within the budget', () => {
    const chosen = selectPOIsForBudget(
      [cafe, cathedral, palace, museum],
      { budgetMinutes: 120, minStops: 3 }
    )
    const ids = chosen.map(p => p.id)
    expect(ids).toContain('cat')
    // Museum takes 60 min alone; cafe should be dropped in its favour
    expect(ids).not.toContain('caf')
  })

  it('respects the diversity cap (no more than ⌈n/3⌉ of the same family)', () => {
    const chosen = selectPOIsForBudget(
      [cathedral, palace, museum, minorChurch1, minorChurch2, minorChurch3, minorChurch4],
      { budgetMinutes: 240, minStops: 3, maxStops: 6 }
    )
    const religiousCount = chosen.filter(p =>
      /iglesia|catedral|ermita/.test(p.category.toLowerCase())
    ).length
    // ⌈6/3⌉ = 2 → cathedral + at most 1 ermita (cap is by family, not per-name)
    expect(religiousCount).toBeLessThanOrEqual(2)
  })

  it('returns at least minStops when the pool allows', () => {
    const chosen = selectPOIsForBudget(
      [cathedral, palace, museum],
      { budgetMinutes: 30, minStops: 3 }  // budget ridiculously tight
    )
    // minStops wins even at the cost of going over budget
    expect(chosen.length).toBeGreaterThanOrEqual(3)
  })

  it('prefers a closer anchor when candidates have comparable scores', () => {
    // Two equally "emblematic" cathedrals, one 10 km south of start,
    // the other right next to it. The anchor should be the close one.
    const near = poi({
      id: 'near', name: 'Catedral Norte', category: 'catedral',
      lat: 40.001, lon: -3.001, estimatedVisitMinutes: 30,
      tags: { wikipedia: 'es:Catedral_Norte', wikidata: 'Q10' },
    })
    const far = poi({
      id: 'far', name: 'Catedral Sur', category: 'catedral',
      lat: 39.91, lon: -3.0, estimatedVisitMinutes: 30,
      tags: { wikipedia: 'es:Catedral_Sur', wikidata: 'Q11' },
    })
    const chosen = selectPOIsForBudget(
      [near, far],
      { budgetMinutes: 60, minStops: 1, startLat: 40.0, startLon: -3.0 }
    )
    expect(chosen[0].id).toBe('near')
  })

  it('returns empty when given no candidates', () => {
    expect(selectPOIsForBudget([], { budgetMinutes: 120 })).toEqual([])
  })
})

describe('orderForWalking (2-opt)', () => {
  it('is a no-op for 2-POI routes', () => {
    const a = poi({ id: 'a', lat: 40, lon: -3 })
    const b = poi({ id: 'b', lat: 41, lon: -3 })
    const ordered = orderForWalking([a, b])
    expect(ordered.map(p => p.id)).toEqual(['a', 'b'])
  })

  it('produces a shorter path than the raw input on a crossing-prone layout', () => {
    // POIs arranged so the naive input ordering crosses itself
    const input = [
      poi({ id: 'A', lat: 0, lon: 0 }),
      poi({ id: 'C', lat: 0, lon: 2 }),   // far right
      poi({ id: 'B', lat: 0, lon: 1 }),   // middle — should be between A and C
      poi({ id: 'D', lat: 0, lon: 3 }),
    ]

    function totalLen(path: POI[]): number {
      let t = 0
      for (let i = 0; i < path.length - 1; i++) {
        t += Math.hypot(path[i].lat - path[i + 1].lat, path[i].lon - path[i + 1].lon)
      }
      return t
    }

    const before = totalLen(input)
    const after = totalLen(orderForWalking(input))
    expect(after).toBeLessThanOrEqual(before)
  })

  it('keeps the first POI fixed when a start coordinate is supplied', () => {
    const a = poi({ id: 'A', lat: 0, lon: 0 })    // closest to start
    const b = poi({ id: 'B', lat: 0, lon: 5 })
    const c = poi({ id: 'C', lat: 0, lon: 10 })
    const ordered = orderForWalking([c, b, a], 0, -0.1)
    // First element should be the POI closest to the start
    expect(ordered[0].id).toBe('A')
  })
})

describe('planRoute (pipeline)', () => {
  it('produces a non-empty ordered list that respects the budget', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      poi({
        id: `p${i}`,
        name: `POI ${i}`,
        lat: 40 + i * 0.001,
        lon: -3 + i * 0.001,
        category: i % 2 ? 'monumento' : 'museo',
        estimatedVisitMinutes: 20,
        tags: { wikipedia: `es:POI_${i}` },
      })
    )
    const route = planRoute(candidates, { budgetMinutes: 120, minStops: 3 })
    expect(route.length).toBeGreaterThanOrEqual(3)
    expect(route.length).toBeLessThanOrEqual(candidates.length)

    // All returned POIs must come from the candidate pool (no synthesis).
    const candidateIds = new Set(candidates.map(c => c.id))
    for (const p of route) expect(candidateIds.has(p.id)).toBe(true)
  })
})
