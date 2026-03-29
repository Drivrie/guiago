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

function buildInstructionEn(type: string, modifier?: string, streetName?: string): string {
  const street = streetName && streetName !== '' ? ` on ${streetName}` : ''
  switch (type) {
    case 'depart': return `Start${street}`
    case 'arrive': return `You have arrived at your destination`
    case 'turn':
      if (modifier === 'left' || modifier === 'sharp left') return `Turn left${street}`
      if (modifier === 'right' || modifier === 'sharp right') return `Turn right${street}`
      if (modifier === 'slight left') return `Keep slightly left${street}`
      if (modifier === 'slight right') return `Keep slightly right${street}`
      if (modifier === 'uturn') return `Make a U-turn${street}`
      return `Turn${street}`
    case 'new name': return `Continue${street}`
    case 'continue': return `Continue straight${street}`
    case 'merge': return `Merge${street}`
    case 'fork':
      if (modifier?.includes('left')) return `At the fork, keep left${street}`
      if (modifier?.includes('right')) return `At the fork, keep right${street}`
      return `At the fork${street}`
    case 'end of road':
      if (modifier === 'left') return `At the end, turn left${street}`
      if (modifier === 'right') return `At the end, turn right${street}`
      return `At the end of the road${street}`
    case 'roundabout':
    case 'rotary': return `At the roundabout${street}`
    default: return `Continue${street}`
  }
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
      return `Incorpórate${street}`
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

export async function getRoute(waypoints: [number, number][], lang: 'es' | 'en' = 'es'): Promise<RouteResult | null> {
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
        instruction: lang === 'en'
          ? buildInstructionEn(step.maneuver.type, step.maneuver.modifier, step.name)
          : buildInstructionEs(step.maneuver.type, step.maneuver.modifier, step.name),
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

/** Creates a simple direct navigation segment when OSRM routing fails */
export function getDirectRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }): RouteResult {
  const dist = calculateDistance(from.lat, from.lon, to.lat, to.lon)

  // Calculate bearing for direction arrow
  const dLon = (to.lon - from.lon) * Math.PI / 180
  const lat1 = from.lat * Math.PI / 180
  const lat2 = to.lat * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const bearingDeg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360

  let direction: NavigationStep['direction'] = 'straight'
  if (bearingDeg > 337.5 || bearingDeg <= 22.5) direction = 'straight'     // N
  else if (bearingDeg <= 67.5) direction = 'slight_right'                    // NE
  else if (bearingDeg <= 112.5) direction = 'right'                          // E
  else if (bearingDeg <= 157.5) direction = 'right'                          // SE
  else if (bearingDeg <= 202.5) direction = 'u_turn'                         // S
  else if (bearingDeg <= 247.5) direction = 'left'                           // SW
  else if (bearingDeg <= 292.5) direction = 'left'                           // W
  else direction = 'slight_left'                                             // NW

  const instruction = `Dirígete ${dist > 500 ? `${(dist/1000).toFixed(1)} km` : `${Math.round(dist)} m`} hacia el destino`
  const icon = direction === 'left' ? '↰' : direction === 'right' ? '↱' : '↑'

  void icon // used indirectly via maneuver modifier in getStepByStepInstructions
  return {
    distance: dist,
    duration: dist / 1.4,
    geometry: { type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] },
    legs: [{
      distance: { value: dist, text: formatDistance(dist) },
      duration: { value: dist / 1.4, text: `${Math.round(dist / 84)} min` },
      steps: [{
        distance: { value: dist, text: formatDistance(dist) },
        duration: { value: dist / 1.4, text: `${Math.round(dist / 84)} min` },
        instruction,
        maneuver: { type: 'depart', modifier: direction, location: [from.lon, from.lat] as [number, number] },
        geometry: undefined,
      }]
    }]
  }
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

/** Builds a natural spoken instruction for TTS (more human than the display text) */
export function buildVoiceInstruction(step: NavigationStep, lang: 'es' | 'en'): string {
  const dist = step.distance
  const distStr = dist < 50 ? '' : dist < 1000
    ? (lang === 'es' ? `en ${Math.round(dist / 10) * 10} metros` : `in ${Math.round(dist / 10) * 10} meters`)
    : (lang === 'es' ? `en ${(dist / 1000).toFixed(1)} kilómetros` : `in ${(dist / 1000).toFixed(1)} kilometers`)

  if (lang === 'es') {
    switch (step.direction) {
      case 'arrive': return 'Has llegado a tu destino.'
      case 'straight': return distStr ? `Continúa recto ${distStr}.` : 'Continúa recto.'
      case 'left': return distStr ? `${distStr}, gira a la izquierda.` : 'Gira a la izquierda.'
      case 'right': return distStr ? `${distStr}, gira a la derecha.` : 'Gira a la derecha.'
      case 'slight_left': return distStr ? `${distStr}, gira ligeramente a la izquierda.` : 'Gira ligeramente a la izquierda.'
      case 'slight_right': return distStr ? `${distStr}, gira ligeramente a la derecha.` : 'Gira ligeramente a la derecha.'
      case 'u_turn': return 'Da la vuelta cuando puedas.'
      default: return step.instruction
    }
  } else {
    switch (step.direction) {
      case 'arrive': return "You've arrived at your destination."
      case 'straight': return distStr ? `Continue straight ${distStr}.` : 'Continue straight.'
      case 'left': return distStr ? `${distStr}, turn left.` : 'Turn left.'
      case 'right': return distStr ? `${distStr}, turn right.` : 'Turn right.'
      case 'slight_left': return distStr ? `${distStr}, turn slightly left.` : 'Turn slightly left.'
      case 'slight_right': return distStr ? `${distStr}, turn slightly right.` : 'Turn slightly right.'
      case 'u_turn': return 'Make a U-turn when safe.'
      default: return step.instruction
    }
  }
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
