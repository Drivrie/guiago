import { describe, it, expect } from 'vitest'
import {
  calculateDistance,
  estimateWalkingTime,
  orderPOIsOptimally,
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
