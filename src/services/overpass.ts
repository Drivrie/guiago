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

/**
 * Adaptive search radius based on city bounding box (approx city diameter).
 * - Small towns (≤4 km wide): 2 km radius (avoids reaching neighbouring villages).
 * - Medium cities (≤10 km): 3 km.
 * - Large cities (>10 km, e.g. Paris, Madrid, Rome): 5 km to include outer
 *   landmarks like Sacré-Cœur or El Retiro that fall outside a 3-km circle.
 */
function adaptiveRadius(city: City): number {
  if (!city.boundingBox) return 3000
  const [minLat, maxLat, minLon, maxLon] = city.boundingBox
  // Rough diagonal in km (1° lat ≈ 111 km; lon scales by cos(lat))
  const latKm = (maxLat - minLat) * 111
  const lonKm = (maxLon - minLon) * 111 * Math.cos((city.lat * Math.PI) / 180)
  const diag = Math.sqrt(latKm * latKm + lonKm * lonKm)
  if (diag <= 4) return 2000
  if (diag <= 10) return 3000
  if (diag <= 20) return 4500
  return 6000
}

// Overpass tag queries per route type
function buildOverpassQuery(city: City, routeType: RouteType): string {
  const radius = adaptiveRadius(city)
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

    // Sort by relevance and apply category diversity (avoid 10 churches in a row)
    const scored = processedPOIs.map(p => ({ poi: p, score: scorePOI(p) }))
    scored.sort((a, b) => b.score - a.score)

    const maxPOIs = getPOICount(maxDuration)
    const diverse = pickDiverseTopPOIs(scored, maxPOIs)
    return diverse
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

/**
 * Score an Overpass POI by tourist relevance.
 * Higher = more emblematic / better documented.
 *
 * Heuristic combines:
 *  - Documentation depth (wikipedia/wikidata link → strong signal of fame).
 *  - Heritage / UNESCO / protected status.
 *  - Category prior (cathedral > random church).
 *  - Practical info (hours, website, accessibility).
 *  - Negative penalties for vague/short names typical of low-quality entries.
 */
function scorePOI(poi: POI): number {
  let score = 0
  const tags = poi.tags || {}

  // Strongest fame signal: linked to Wikipedia / Wikidata
  if (tags.wikipedia) score += 25
  if (tags.wikidata) score += 12

  // Heritage status (national protection, UNESCO list)
  if (tags.heritage) score += 15
  if (tags['heritage:operator'] === 'unesco' || tags['heritage:operator'] === 'whc') score += 30
  if (tags['ref:whc']) score += 30  // WHC = World Heritage Centre id

  // Tourism quality signals
  if (tags.tourism === 'attraction') score += 6
  if (tags.tourism === 'museum') score += 8
  if (tags.tourism === 'viewpoint') score += 3
  if (tags.tourism === 'artwork') score += 2

  // Practical info (suggests it's a "real" curated POI)
  if (tags.website || tags['contact:website']) score += 4
  if (tags.opening_hours) score += 3
  if (tags.image || tags.wikimedia_commons) score += 3
  if (tags.description) score += 4
  if (tags.phone || tags['contact:phone']) score += 1
  if (tags['addr:street']) score += 1
  if (tags.wheelchair) score += 1  // accessibility info → curated entry

  // Architecture significance
  if (tags['architecture:style'] || tags.architect) score += 6
  if (tags['building:architecture']) score += 4

  // Boost for emblematic categories
  const cat = poi.category.toLowerCase()
  if (/(catedral|cathedral|basílica|basilica|alhambra|alcázar|alcazar)/.test(cat)) score += 25
  if (/(palacio|palace|castle|castillo)/.test(cat)) score += 18
  if (/(museo|museum)/.test(cat)) score += 14
  if (/(monumento|monument|ruins|archaeological)/.test(cat)) score += 12
  if (/(mezquita|mosque|sinagoga|synagogue)/.test(cat)) score += 12
  if (/(plaza|square|mercado|market)/.test(cat)) score += 8
  if (/(torre|tower|puente|bridge)/.test(cat)) score += 6
  if (/(iglesia|church|capilla|chapel)/.test(cat)) score += 4

  // Penalties: vague, short or generic names
  const name = poi.name.trim()
  if (name.length < 4) score -= 5
  if (/^(la |el |the )?(iglesia|church|capilla|chapel|fuente|fountain|estatua|statue)$/i.test(name)) score -= 8
  if (!tags.wikipedia && !tags.wikidata && !tags.website && !tags.description) score -= 3

  return score
}

function getPOICount(durationMinutes: number): number {
  return POIS_BY_DURATION[durationMinutes] || Math.floor(durationMinutes / 15)
}

/**
 * Bucket a category into a coarse "family" so we can enforce diversity.
 * Returns one of: religious, museum, palace, square, market, garden, viewpoint,
 *   monument, food, art, other
 */
function categoryFamily(category: string): string {
  const c = category.toLowerCase()
  if (/(catedral|basílica|iglesia|capilla|mezquita|sinagoga|convento|monasterio|chapel|church|mosque|synagogue|cathedral)/.test(c)) return 'religious'
  if (/(museo|museum|galería|gallery)/.test(c)) return 'museum'
  if (/(palacio|palace|castillo|castle|alcázar|alhambra|fortaleza|fort)/.test(c)) return 'palace'
  if (/(plaza|square)/.test(c)) return 'square'
  if (/(mercado|market)/.test(c)) return 'market'
  if (/(jardín|garden|parque|park|natural|wood|water)/.test(c)) return 'garden'
  if (/(mirador|viewpoint|torre|tower)/.test(c)) return 'viewpoint'
  if (/(monumento|monument|memorial|estatua|statue|obelisco|fuente|fountain|puente|bridge)/.test(c)) return 'monument'
  if (/(restaurante|restaurant|bar|cafetería|cafe|bakery|food)/.test(c)) return 'food'
  if (/(obra de arte|artwork|sculpture|mural|graffiti)/.test(c)) return 'art'
  return 'other'
}

/**
 * Greedy diversity picker: walks the score-sorted list and keeps POIs while
 * limiting consecutive picks of the same category family.
 *
 * Rule: no family may exceed ceil(targetCount / 3) picks until the pool is
 * exhausted. This is permissive enough for "monumental" routes (where churches
 * dominate) but prevents 10 cafés in "gastronomía".
 */
function pickDiverseTopPOIs<T extends { poi: POI; score: number }>(
  scored: T[],
  targetCount: number
): POI[] {
  if (scored.length <= targetCount) return scored.map(s => s.poi)

  const familyCap = Math.max(2, Math.ceil(targetCount / 3))
  const familyCount = new Map<string, number>()
  const picked: POI[] = []
  const skipped: POI[] = []  // overflow bucket if we run out before hitting target

  for (const { poi } of scored) {
    if (picked.length >= targetCount) break
    const fam = categoryFamily(poi.category)
    const used = familyCount.get(fam) || 0
    if (used < familyCap) {
      picked.push(poi)
      familyCount.set(fam, used + 1)
    } else {
      skipped.push(poi)
    }
  }

  // Backfill from skipped if we couldn't reach targetCount with diversity
  for (const poi of skipped) {
    if (picked.length >= targetCount) break
    picked.push(poi)
  }

  return picked
}

/** Public scoring helper — used by the route planner to weight stops. */
export function relevanceScore(poi: POI): number {
  return scorePOI(poi)
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
