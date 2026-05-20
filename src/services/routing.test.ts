import { describe, it, expect } from 'vitest'
import {
  calculateDistance,
  estimateWalkingTime,
  orderPOIsOptimally,
  pruneOutlierPOIs,
  buildVoiceInstruction,
} from './routing'
import type { NavigationStep } from '../types'

describe('calculateDistance', () => {
  it('returns ~0 for identical coordinates', () => {
    expect(calculateDistance(40.4168, -3.7038, 40.4168, -3.7038)).toBeLessThan(1)
  })

  it('matches a known great-circle distance (Madrid → Barcelona ≈ 504 km)', () => {
    const d = calculateDistance(40.4168, -3.7038, 41.3874, 2.1686)
    expect(d).toBeGreaterThan(490_000)
    expect(d).toBeLessThan(520_000)
  })
})

describe('estimateWalkingTime', () => {
  it('estimates ~12 min for 1 km at ~84 m/min', () => {
    expect(estimateWalkingTime(1000)).toBe(12)
  })
})

describe('orderPOIsOptimally', () => {
  it('orders POIs by nearest-neighbour from the start point', () => {
    const start = { lat: 0, lon: 0 }
    const pois = [
      { id: 'far', lat: 0, lon: 3 },
      { id: 'near', lat: 0, lon: 1 },
      { id: 'mid', lat: 0, lon: 2 },
    ]
    const ordered = orderPOIsOptimally(pois, start.lat, start.lon)
    expect(ordered.map(p => p.id)).toEqual(['near', 'mid', 'far'])
  })

  it('returns the list unchanged when 2 or fewer POIs', () => {
    const pois = [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }]
    expect(orderPOIsOptimally(pois)).toEqual(pois)
  })

  it('2-opt removes a crossing: a cluster + a swap-prone outlier', () => {
    // Four POIs arranged so greedy nearest-neighbour would create a crossing.
    // Start (0,0). With pure NN, order picks (0,1)→(0,3)→(0,2)→(0,4) — a zigzag.
    // 2-opt should fix it to (0,1)→(0,2)→(0,3)→(0,4).
    const start = { lat: 0, lon: 0 }
    const pois = [
      { id: 'B', lat: 0, lon: 3 },
      { id: 'A', lat: 0, lon: 1 },
      { id: 'D', lat: 0, lon: 4 },
      { id: 'C', lat: 0, lon: 2 },
    ]
    const ordered = orderPOIsOptimally(pois, start.lat, start.lon)
    expect(ordered.map(p => p.id)).toEqual(['A', 'C', 'B', 'D'])
  })
})

describe('pruneOutlierPOIs', () => {
  it('drops a single far-away middle POI', () => {
    // A and B are 100m apart (close); C is far (~110 km away in both directions);
    // D and E are close to B. C is a textbook outlier that breaks the route.
    const pois = [
      { id: 'A', lat: 0, lon: 0 },
      { id: 'B', lat: 0, lon: 0.001 },         // ~111 m
      { id: 'C', lat: 1, lon: 0.001 },          // ~111 km north
      { id: 'D', lat: 0, lon: 0.002 },          // ~222 m
      { id: 'E', lat: 0, lon: 0.003 },          // ~333 m
    ]
    const pruned = pruneOutlierPOIs(pois, 1500)
    expect(pruned.map(p => p.id)).toEqual(['A', 'B', 'D', 'E'])
  })

  it('keeps small routes unchanged', () => {
    const pois = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: 2 }]
    expect(pruneOutlierPOIs(pois)).toEqual(pois)
  })
})

describe('buildVoiceInstruction', () => {
  const step = (direction: NavigationStep['direction'], distance: number): NavigationStep => ({
    instruction: 'x',
    distance,
    duration: 0,
    direction,
  })

  it('announces arrival in Spanish', () => {
    expect(buildVoiceInstruction(step('arrive', 0), 'es')).toMatch(/destino/i)
  })

  it('includes the distance when far enough (English)', () => {
    expect(buildVoiceInstruction(step('left', 200), 'en')).toMatch(/200 meters/i)
  })

  it('omits distance when very close', () => {
    expect(buildVoiceInstruction(step('right', 10), 'es')).toBe('Gira a la derecha.')
  })
})
