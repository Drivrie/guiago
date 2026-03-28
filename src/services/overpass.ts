import type { POI, City, RouteType, OverpassElement } from '../types'

const OVERPASS_BASE = 'https://overpass-api.de/api/interpreter'

// POIs needed per route type (approximate, adjusted by duration)
const POIS_BY_DURATION: Record<number, number> = {
  60: 4,
  120: 7,
  180: 10,
  240: 13,
  480: 20
}

// Overpass tag queries per route type
function buildOverpassQuery(city: City, routeType: RouteType): string {
  const radius = 3000 // 3km radius from city center
  const lat = city.lat
  const lon = city.lon

  let tagFilters = ''

  switch (routeType) {
    case 'imprescindibles':
      // Broad: top landmarks, museums, major attractions
      tagFilters = `
        node["historic"~"monument|castle|palace|cathedral|fort|archaeological_site"](around:${radius},${lat},${lon});
        way["historic"~"monument|castle|palace|cathedral|fort|archaeological_site"](around:${radius},${lat},${lon});
        node["tourism"="museum"](around:${radius},${lat},${lon});
        way["tourism"="museum"](around:${radius},${lat},${lon});
        node["tourism"="attraction"](around:${radius},${lat},${lon});
        way["tourism"="attraction"](around:${radius},${lat},${lon});
        node["building"~"cathedral|church|palace|castle"](around:${radius},${lat},${lon});
        way["building"~"cathedral|church|palace|castle"](around:${radius},${lat},${lon});
        node["leisure"="park"]["name"](around:${radius},${lat},${lon});
        way["leisure"="park"]["name"](around:${radius},${lat},${lon});
      `
      break

    case 'secretos_locales':
      // Hidden gems: local markets, lesser-known historic spots, quirky attractions
      tagFilters = `
        node["tourism"="artwork"](around:${radius},${lat},${lon});
        node["amenity"="marketplace"](around:${radius},${lat},${lon});
        way["amenity"="marketplace"](around:${radius},${lat},${lon});
        node["historic"~"milestone|boundary_stone|wayside_shrine|water_pump"](around:${radius},${lat},${lon});
        node["man_made"~"clock|water_tower|windmill|tower"](around:${radius},${lat},${lon});
        way["man_made"~"clock|water_tower|windmill|tower"](around:${radius},${lat},${lon});
        node["tourism"="viewpoint"](around:${radius},${lat},${lon});
        node["amenity"="fountain"]["name"](around:${radius},${lat},${lon});
        node["artwork_type"~"sculpture|mural|installation|mosaic"](around:${radius},${lat},${lon});
        node["leisure"="garden"]["name"](around:${radius},${lat},${lon});
        way["leisure"="garden"]["name"](around:${radius},${lat},${lon});
      `
      break

    case 'monumental':
      tagFilters = `
        node["historic"~"monument|castle|ruins|archaeological_site|memorial|city_gate|fort|palace|manor|cathedral"](around:${radius},${lat},${lon});
        way["historic"~"monument|castle|ruins|archaeological_site|memorial|city_gate|fort|palace|manor|cathedral"](around:${radius},${lat},${lon});
        node["tourism"="museum"](around:${radius},${lat},${lon});
        way["tourism"="museum"](around:${radius},${lat},${lon});
        node["tourism"="attraction"]["historic"](around:${radius},${lat},${lon});
        way["tourism"="attraction"]["historic"](around:${radius},${lat},${lon});
        node["building"~"cathedral|church|chapel|mosque|synagogue|palace|castle"](around:${radius},${lat},${lon});
        way["building"~"cathedral|church|chapel|mosque|synagogue|palace|castle"](around:${radius},${lat},${lon});
      `
      break

    case 'historia_negra':
      tagFilters = `
        node["historic"~"memorial|battlefield|execution|prison|gallows|plague_cross|wayside_cross|crypt|tomb"](around:${radius},${lat},${lon});
        way["historic"~"memorial|battlefield|execution|prison|gallows|plague_cross|wayside_cross|crypt|tomb"](around:${radius},${lat},${lon});
        node["tourism"="museum"]["name"~"inquisición|tortura|guerra|holocausto|guerra|cementerio|cárcel|prisión",i](around:${radius},${lat},${lon});
        node["amenity"="grave_yard"](around:${radius},${lat},${lon});
        way["amenity"="grave_yard"](around:${radius},${lat},${lon});
        node["landuse"="cemetery"](around:${radius},${lat},${lon});
        way["landuse"="cemetery"](around:${radius},${lat},${lon});
        node["historic"="memorial"]["memorial"~"war|wwii|civil_war|victims"](around:${radius},${lat},${lon});
        node["amenity"="prison"](around:${radius},${lat},${lon});
        way["amenity"="prison"](around:${radius},${lat},${lon});
      `
      break

    case 'curiosidades':
      tagFilters = `
        node["tourism"~"artwork|attraction"](around:${radius},${lat},${lon});
        way["tourism"~"artwork|attraction"](around:${radius},${lat},${lon});
        node["historic"~"milestone|boundary_stone|wayside_shrine|wayside_cross|stone"](around:${radius},${lat},${lon});
        node["artwork_type"~"sculpture|mural|graffiti|installation|mosaic|statue"](around:${radius},${lat},${lon});
        node["leisure"~"outdoor_seating"]["name"](around:${radius},${lat},${lon});
        node["amenity"~"fountain"](around:${radius},${lat},${lon});
        way["amenity"~"fountain"](around:${radius},${lat},${lon});
        node["man_made"~"clock|water_tower|lighthouse|windmill|tower"](around:${radius},${lat},${lon});
        way["man_made"~"clock|water_tower|lighthouse|windmill|tower"](around:${radius},${lat},${lon});
        node["tourism"="viewpoint"](around:${radius},${lat},${lon});
      `
      break

    case 'gastronomia':
      tagFilters = `
        node["amenity"="marketplace"](around:${radius},${lat},${lon});
        way["amenity"="marketplace"](around:${radius},${lat},${lon});
        node["shop"="supermarket"]["name"~"mercado|market",i](around:${radius},${lat},${lon});
        node["amenity"~"restaurant|cafe|bar"]["tourism"="attraction"](around:${radius},${lat},${lon});
        node["amenity"~"restaurant|cafe|bar"]["historic"](around:${radius},${lat},${lon});
        node["tourism"~"attraction"]["amenity"~"restaurant|cafe|bar"](around:${radius},${lat},${lon});
        node["amenity"="restaurant"]["name"](around:${radius},${lat},${lon});
        node["amenity"="bar"]["name"](around:${radius},${lat},${lon});
        node["amenity"="cafe"]["name"](around:${radius},${lat},${lon});
        node["shop"~"bakery|deli|cheese|wine|butcher|fishmonger"]["name"](around:${radius},${lat},${lon});
        node["amenity"="food_court"](around:${radius},${lat},${lon});
      `
      break

    case 'arquitectura':
      tagFilters = `
        node["building"~"cathedral|church|chapel|palace|castle|tower|government|civic|commercial|train_station"](around:${radius},${lat},${lon});
        way["building"~"cathedral|church|chapel|palace|castle|tower|government|civic|commercial|train_station"](around:${radius},${lat},${lon});
        node["architecture:style"](around:${radius},${lat},${lon});
        way["architecture:style"](around:${radius},${lat},${lon});
        node["heritage"](around:${radius},${lat},${lon});
        way["heritage"](around:${radius},${lat},${lon});
        node["historic"~"building|house|manor|palace|castle"](around:${radius},${lat},${lon});
        way["historic"~"building|house|manor|palace|castle"](around:${radius},${lat},${lon});
        node["tourism"="attraction"]["building"](around:${radius},${lat},${lon});
        way["tourism"="attraction"]["building"](around:${radius},${lat},${lon});
        node["amenity"~"theatre|cinema"]["name"](around:${radius},${lat},${lon});
        way["amenity"~"theatre|cinema"]["name"](around:${radius},${lat},${lon});
      `
      break

    case 'naturaleza':
      tagFilters = `
        node["leisure"~"park|garden|nature_reserve"](around:${radius},${lat},${lon});
        way["leisure"~"park|garden|nature_reserve"](around:${radius},${lat},${lon});
        node["natural"~"tree|spring|waterfall|cliff|cave_entrance|beach"](around:${radius},${lat},${lon});
        way["natural"~"wood|water|wetland|cliff|beach"](around:${radius},${lat},${lon});
        node["tourism"~"viewpoint"](around:${radius},${lat},${lon});
        node["amenity"="fountain"](around:${radius},${lat},${lon});
        way["amenity"="fountain"](around:${radius},${lat},${lon});
        node["historic"="natural_object"](around:${radius},${lat},${lon});
        node["tourism"="picnic_site"](around:${radius},${lat},${lon});
        way["landuse"="forest"]["name"](around:${radius},${lat},${lon});
        node["natural"="tree"]["name"](around:${radius},${lat},${lon});
      `
      break
  }

  return `[out:json][timeout:30];
(
  ${tagFilters}
);
out center;`
}

function elementToCategory(element: OverpassElement, routeType: RouteType): string {
  const tags = element.tags || {}

  if (tags.historic) return tags.historic.replace(/_/g, ' ')
  if (tags.tourism === 'museum') return 'museo'
  if (tags.tourism === 'attraction') return 'atracción turística'
  if (tags.tourism === 'artwork') return 'obra de arte'
  if (tags.tourism === 'viewpoint') return 'mirador'
  if (tags.amenity === 'place_of_worship') return tags.religion === 'christian' ? 'iglesia' : 'lugar de culto'
  if (tags.amenity === 'marketplace') return 'mercado'
  if (tags.amenity === 'restaurant') return 'restaurante'
  if (tags.amenity === 'cafe') return 'cafetería'
  if (tags.amenity === 'bar') return 'bar'
  if (tags.amenity === 'grave_yard' || tags.landuse === 'cemetery') return 'cementerio'
  if (tags.amenity === 'prison') return 'prisión'
  if (tags.amenity === 'fountain') return 'fuente'
  if (tags.amenity === 'theatre') return 'teatro'
  if (tags.leisure === 'park') return 'parque'
  if (tags.leisure === 'garden') return 'jardín'
  if (tags.natural) return tags.natural
  if (tags.building) return tags.building.replace(/_/g, ' ')

  // Fallback by route type
  const defaults: Record<RouteType, string> = {
    imprescindibles: 'lugar imprescindible',
    secretos_locales: 'secreto local',
    monumental: 'monumento',
    historia_negra: 'lugar histórico',
    curiosidades: 'curiosidad',
    gastronomia: 'lugar gastronómico',
    arquitectura: 'edificio',
    naturaleza: 'espacio natural'
  }
  return defaults[routeType]
}

function estimateVisitTime(routeType: RouteType, category: string): number {
  // Minutes to spend at each POI
  const base: Record<RouteType, number> = {
    imprescindibles: 25,
    secretos_locales: 15,
    monumental: 20,
    historia_negra: 15,
    curiosidades: 10,
    gastronomia: 45,
    arquitectura: 15,
    naturaleza: 25
  }

  let time = base[routeType]
  if (category.includes('museo') || category.includes('museum')) time = 60
  if (category.includes('catedral') || category.includes('iglesia')) time = 25
  if (category.includes('restaurante') || category.includes('bar')) time = 60
  if (category.includes('mercado')) time = 30
  if (category.includes('parque') || category.includes('jardín')) time = 30

  return time
}

export async function getPOIsByCity(city: City, routeType: RouteType, maxDuration: number = 180): Promise<POI[]> {
  try {
    const query = buildOverpassQuery(city, routeType)

    const response = await fetch(OVERPASS_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `data=${encodeURIComponent(query)}`
    })

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`)
    }

    const data = await response.json()
    const elements: OverpassElement[] = data.elements || []

    // Process elements - filter those with names and valid coordinates
    const processedPOIs: POI[] = []
    const seenNames = new Set<string>()

    for (const element of elements) {
      const tags = element.tags || {}
      const name = tags.name || tags['name:es'] || tags['name:en']

      if (!name || name.trim().length < 2) continue

      // Get coordinates
      let lat: number, lon: number
      if (element.type === 'node' && element.lat !== undefined && element.lon !== undefined) {
        lat = element.lat
        lon = element.lon
      } else if (element.center) {
        lat = element.center.lat
        lon = element.center.lon
      } else {
        continue
      }

      // Skip duplicates
      const nameKey = name.toLowerCase().trim()
      if (seenNames.has(nameKey)) continue
      seenNames.add(nameKey)

      const category = elementToCategory(element, routeType)
      const estimatedVisitMinutes = estimateVisitTime(routeType, category)

      const poi: POI = {
        id: `${element.type}-${element.id}`,
        name: name.trim(),
        lat,
        lon,
        category,
        routeType,
        tags,
        estimatedVisitMinutes,
        address: buildAddress(tags),
        openingHours: tags.opening_hours,
        website: tags.website || tags['contact:website'],
        phone: tags.phone || tags['contact:phone'],
        wikipediaTitle: tags['wikipedia'] ? extractWikiTitle(tags['wikipedia']) : name
      }

      processedPOIs.push(poi)
    }

    // Sort by importance (prefer elements with more tags/info)
    processedPOIs.sort((a, b) => {
      const scoreA = scorePOI(a)
      const scoreB = scorePOI(b)
      return scoreB - scoreA
    })

    // Limit based on duration
    const maxPOIs = getPOICount(maxDuration)

    return processedPOIs.slice(0, maxPOIs)
  } catch (error) {
    console.error('Error fetching POIs from Overpass:', error)
    return []
  }
}

function buildAddress(tags: Record<string, string>): string {
  const parts = []
  if (tags['addr:street']) parts.push(tags['addr:street'])
  if (tags['addr:housenumber']) parts.push(tags['addr:housenumber'])
  if (tags['addr:city']) parts.push(tags['addr:city'])
  return parts.join(', ')
}

function extractWikiTitle(wikiTag: string): string {
  // Format: "es:Title" or just "Title"
  if (wikiTag.includes(':')) {
    return wikiTag.split(':').slice(1).join(':')
  }
  return wikiTag
}

function scorePOI(poi: POI): number {
  let score = 0
  const tags = poi.tags || {}

  if (tags.wikipedia) score += 10
  if (tags.wikidata) score += 5
  if (tags.website) score += 3
  if (tags.opening_hours) score += 2
  if (tags.phone) score += 1
  if (tags['addr:street']) score += 1
  if (tags.description) score += 3
  if (tags.image) score += 2

  // Boost for certain types
  if (['cathedral', 'palace', 'castle', 'museum'].includes(poi.category)) score += 10
  if (['monument', 'ruins', 'archaeological_site'].includes(poi.category)) score += 7

  return score
}

function getPOICount(durationMinutes: number): number {
  return POIS_BY_DURATION[durationMinutes] || Math.floor(durationMinutes / 15)
}

export async function searchPOIsNearby(lat: number, lon: number, radius: number = 500): Promise<POI[]> {
  const query = `[out:json][timeout:15];
(
  node["tourism"](around:${radius},${lat},${lon});
  node["historic"](around:${radius},${lat},${lon});
  node["amenity"~"restaurant|bar|cafe|museum"](around:${radius},${lat},${lon});
);
out body;`

  try {
    const response = await fetch(OVERPASS_BASE, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`
    })

    if (!response.ok) return []
    const data = await response.json()
    const elements: OverpassElement[] = data.elements || []

    return elements
      .filter(e => e.tags?.name && e.lat !== undefined && e.lon !== undefined)
      .map(e => ({
        id: `${e.type}-${e.id}`,
        name: e.tags!.name!,
        lat: e.lat!,
        lon: e.lon!,
        category: e.tags?.tourism || e.tags?.historic || e.tags?.amenity || 'lugar',
        routeType: 'curiosidades' as RouteType,
        tags: e.tags,
        estimatedVisitMinutes: 15
      }))
  } catch {
    return []
  }
}
