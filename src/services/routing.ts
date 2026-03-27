import type { RouteResult, NavigationStep } from '../types'

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/foot'

// OSRM maneuver type to direction mapping
function maneuverToDirection(type: string, modifier?: string): NavigationStep['direction'] {
  if (type === 'arrive') return 'arrive'

  switch (modifier) {
    case 'straight': return 'straight'
    case 'left': return 'left'
    case 'right': return 'right'
    case 'slight left': return 'slight_left'
    case 'slight right': return 'slight_right'
    case 'sharp left': return 'left'
    case 'sharp right': return 'right'
    case 'uturn': return 'u_turn'
    default:
      if (type === 'turn' && modifier?.includes('left')) return 'left'
      if (type === 'turn' && modifier?.includes('right')) return 'right'
      return 'straight'
  }
}

function directionToIcon(direction?: NavigationStep['direction']): string {
  switch (direction) {
    case 'left': return '↰'
    case 'right': return '↱'
    case 'slight_left': return '↖'
    case 'slight_right': return '↗'
    case 'u_turn': return '↩'
    case 'arrive': return '📍'
    case 'straight':
    default: return '↑'
  }
}

function formatDistance(meters: number): string {
  if (meters < 100) return `${Math.round(meters)} m`
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function buildInstructionEs(type: string, modifier?: string, streetName?: string): string {
  const street = streetName && streetName !== '' ? ` por ${streetName}` : ''

  switch (type) {
    case 'depart':
      return `Empieza${street}`
    case 'arrive':
      return `Has llegado a tu destino`
    case 'turn':
      if (modifier === 'left' || modifier === 'sharp left') return `Gira a la izquierda${street}`
      if (modifier === 'right' || modifier === 'sharp right') return `Gira a la derecha${street}`
      if (modifier === 'slight left') return `Gira ligeramente a la izquierda${street}`
      if (modifier === 'slight right') return `Gira ligeramente a la derecha${street}`
      if (modifier === 'uturn') return `Da la vuelta${street}`
      return `Gira${street}`
    case 'new name':
      return `Continúa${street}`
    case 'continue':
      return `Continúa recto${street}`
    case 'merge':
      return `Incorporate${street}`
    case 'fork':
      if (modifier?.includes('left')) return `En el cruce, ve por la izquierda${street}`
      if (modifier?.includes('right')) return `En el cruce, ve por la derecha${street}`
      return `En el cruce${street}`
    case 'end of road':
      if (modifier === 'left') return `Al final, gira a la izquierda${street}`
      if (modifier === 'right') return `Al final, gira a la derecha${street}`
      return `Al final de la calle${street}`
    case 'roundabout':
      return `En la rotonda${street}`
    case 'rotary':
      return `En la rotonda${street}`
    default:
      return `Continúa${street}`
  }
}

export async function getRoute(waypoints: [number, number][]): Promise<RouteResult | null> {
  if (waypoints.length < 2) return null

  try {
    // OSRM expects lon,lat pairs
    const coords = waypoints.map(([lat, lon]) => `${lon},${lat}`).join(';')
    const url = `${OSRM_BASE}/${coords}?steps=true&geometries=geojson&overview=full&annotations=false`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout))
    if (!response.ok) {
      throw new Error(`OSRM error: ${response.status}`)
    }

    const data = await response.json()

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('OSRM returned no routes')
    }

    const route = data.routes[0]

    // Parse legs/steps into our format
    const legs = route.legs.map((leg: {
      distance: number
      duration: number
      steps: Array<{
        distance: number
        duration: number
        maneuver: { type: string; modifier?: string; location?: [number, number] }
        name?: string
        geometry?: { coordinates: [number, number][] }
      }>
    }) => ({
      distance: {
        value: leg.distance,
        text: formatDistance(leg.distance)
      },
      duration: {
        value: leg.duration,
        text: formatDuration(leg.duration)
      },
      steps: leg.steps.map((step) => ({
        distance: {
          value: step.distance,
          text: formatDistance(step.distance)
        },
        duration: {
          value: step.duration,
          text: formatDuration(step.duration)
        },
        instruction: buildInstructionEs(
          step.maneuver.type,
          step.maneuver.modifier,
          step.name
        ),
        maneuver: step.maneuver ? {
          type: step.maneuver.type,
          modifier: step.maneuver.modifier,
          location: step.maneuver.location
        } : undefined,
        geometry: step.geometry
      }))
    }))

    return {
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
      legs
    }
  } catch (error) {
    console.error('OSRM routing error:', error)
    return null
  }
}

export function getStepByStepInstructions(routeResult: RouteResult): NavigationStep[] {
  const steps: NavigationStep[] = []

  for (const leg of routeResult.legs) {
    for (const step of leg.steps) {
      const direction = step.maneuver
        ? maneuverToDirection(step.maneuver.type, step.maneuver.modifier)
        : 'straight'

      steps.push({
        instruction: step.instruction,
        distance: step.distance.value,
        duration: step.duration.value,
        direction,
        icon: directionToIcon(direction),
        coordinates: step.maneuver?.location
      })
    }
  }

  return steps
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} seg`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}min`
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function estimateWalkingTime(distanceMeters: number): number {
  // Average walking speed ~1.4 m/s = ~84 m/min
  return Math.round(distanceMeters / 84)
}

export function orderPOIsOptimally<T extends { lat: number; lon: number }>(
  pois: T[],
  startLat?: number,
  startLon?: number
): T[] {
  if (pois.length <= 2) return pois

  const unvisited = [...pois]
  const ordered: T[] = []

  // Start from first POI or given start position
  let currentLat = startLat ?? pois[0].lat
  let currentLon = startLon ?? pois[0].lon

  if (!startLat) {
    ordered.push(unvisited.splice(0, 1)[0])
    currentLat = ordered[0].lat
    currentLon = ordered[0].lon
  }

  // Nearest neighbor algorithm
  while (unvisited.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity

    for (let i = 0; i < unvisited.length; i++) {
      const dist = calculateDistance(currentLat, currentLon, unvisited[i].lat, unvisited[i].lon)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    }

    const nearest = unvisited.splice(nearestIdx, 1)[0]
    ordered.push(nearest)
    currentLat = nearest.lat
    currentLon = nearest.lon
  }

  return ordered
}
