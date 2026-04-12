import type { POI, RouteType, City, Language } from '../types'

const WIKI_API = {
  es: 'https://es.wikipedia.org/w/api.php',
  en: 'https://en.wikipedia.org/w/api.php'
}

// Keywords per route type for scoring Wikipedia articles
const ROUTE_KEYWORDS: Record<RouteType, RegExp> = {
  imprescindibles: /catedral|palacio|alhambra|alcázar|mezquita|museo|monumento|patrimonio|unesco|emblemático|icónico|histórico|principal|basílica|castillo|torre|plaza mayor|famoso|turístico|cathedral|palace|castle|museum|monument|heritage|iconic|famous|landmark|basilica|tower|main square|historic|plaza|square|bridge|puente|gate|puerta|wall|muralla|temple|templo|market|mercado/i,
  secretos_locales: /barrio|rincón|secreto|oculto|poco conocido|local|vecinos|cotidiano|alternativo|auténtico|escondido|peculiar|mercadillo|taberna|pasaje|patio|calleja/i,
  monumental: /catedral|basílica|palacio|castillo|muralla|alcázar|torre|museo|monumento|ermita|iglesia|convento|real|alcazaba|mezquita|sinagoga|alhambra|fortaleza/i,
  historia_negra: /cementerio|inquisición|guerra|batalla|matanza|ejecución|masacre|prisión|cárcel|víctimas|fusilamiento|memorial|asesinato|tragedia|holocausto/i,
  curiosidades: /fuente|estatua|escultura|plaza|barrio|leyenda|misterio|insólito|secreto|subterráneo|peculiar|curiosidad|raro|extraño/i,
  gastronomia: /mercado|gastronom|vino|tapas|cocina|taberna|bodega|feria|restaurante|jamón|queso|aceite|mariscos/i,
  arquitectura: /arquitectura|barroco|gótico|renacimiento|mudéjar|modernismo|neoclásico|románico|art.*nouveau|estilo|fachada|claustro/i,
  naturaleza: /parque|jardín|río|arroyo|sierra|monte|playa|laguna|reserva|bosque|dehesa|marisma|huerta|alameda/i,
}

// For imprescindibles, also use the combined score across ALL types
const ALL_KEYWORDS_COMBINED = Object.entries(ROUTE_KEYWORDS)
  .filter(([k]) => k !== 'imprescindibles')
  .map(([, v]) => v.source)
  .join('|')
const ALL_KEYWORDS_RE = new RegExp(ALL_KEYWORDS_COMBINED, 'gi')

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ').trim()
}

function scoreArticle(title: string, extract: string, routeType: RouteType): number {
  const text = `${title} ${extract.slice(0, 400)}`
  if (routeType === 'imprescindibles') {
    // Score highest overall landmark coverage
    const allMatches = (text.match(ALL_KEYWORDS_RE) || []).length
    // Bonus for "famous/emblematic" language
    const notorietyBonus = /turístico|famoso|emblemático|icónico|símbolo|principal|destacad|patrimonio|unesco|known for|famous/i.test(text) ? 3 : 0
    return allMatches + notorietyBonus
  }
  const re = new RegExp(ROUTE_KEYWORDS[routeType].source, 'gi')
  return (text.match(re) || []).length
}

/** Realistic visit times for a walking-tour stop (not a deep interior visit). */
function guessVisitMinutes(title: string, extract: string): number {
  const t = `${title} ${extract.slice(0, 200)}`.toLowerCase()
  if (/museo|museum/.test(t)) return 20
  if (/catedral|basílica|cathedral|basilica/.test(t)) return 15
  if (/palacio|palace|alcázar|alhambra|alcazaba/.test(t)) return 18
  if (/castillo|castle|fortaleza|muralla/.test(t)) return 15
  if (/parque|jardín|park|garden/.test(t)) return 12
  if (/mercado|market/.test(t)) return 15
  if (/plaza|square|piazza/.test(t)) return 8
  if (/puente|bridge|pont/.test(t)) return 8
  if (/iglesia|church|convento|monasterio|chapel/.test(t)) return 12
  if (/torre|tower/.test(t)) return 10
  return 12
}

function guessCategory(title: string, extract: string, routeType: RouteType): string {
  const t = `${title} ${extract.slice(0, 200)}`.toLowerCase()
  if (/catedral|basílica/.test(t)) return 'catedral'
  if (/mezquita/.test(t)) return 'mezquita'
  if (/sinagoga/.test(t)) return 'sinagoga'
  if (/iglesia|parroquia|ermita/.test(t)) return 'iglesia'
  if (/convento|monasterio/.test(t)) return 'convento'
  if (/palacio|alcázar|alhambra|alcazaba/.test(t)) return 'palacio'
  if (/castillo|fortaleza|muralla/.test(t)) return 'castillo'
  if (/museo/.test(t)) return 'museo'
  if (/torre/.test(t)) return 'torre'
  if (/puente/.test(t)) return 'puente'
  if (/plaza/.test(t)) return 'plaza'
  if (/jardín|parque/.test(t)) return 'jardín'
  if (/mercado/.test(t)) return 'mercado'
  if (/cementerio/.test(t)) return 'cementerio'
  if (/teatro/.test(t)) return 'teatro'
  if (/universidad/.test(t)) return 'universidad'
  if (/fuente/.test(t)) return 'fuente'
  const defaults: Record<RouteType, string> = {
    imprescindibles: 'lugar imprescindible',
    secretos_locales: 'secreto local',
    monumental: 'monumento',
    historia_negra: 'lugar histórico',
    curiosidades: 'punto de interés',
    gastronomia: 'lugar gastronómico',
    arquitectura: 'edificio',
    naturaleza: 'espacio natural',
  }
  return defaults[routeType]
}

// Search Wikipedia geosearch around a city, score by route type
export async function searchPOIsWikipedia(
  city: City,
  routeType: RouteType,
  maxPOIs: number,
  lang: Language = 'es',
  excludeNames: string[] = [],
  radiusMeters: number = 4000
): Promise<POI[]> {
  try {
    const wikiLang = lang === 'es' ? 'es' : 'en'
    const base = WIKI_API[wikiLang]
    const excludeLower = excludeNames.map(n => n.toLowerCase())

    // Step 1: Geosearch around city center
    const geoParams = new URLSearchParams({
      action: 'query',
      list: 'geosearch',
      gscoord: `${city.lat}|${city.lon}`,
      gsradius: String(Math.min(10000, Math.max(1000, radiusMeters))),
      gslimit: '100',    // More candidates → better scoring pool
      format: 'json',
      origin: '*',
    })

    const geoResp = await fetch(`${base}?${geoParams}`)
    if (!geoResp.ok) return []
    const geoData = await geoResp.json() as { query?: { geosearch?: Array<{ pageid: number; title: string; lat: number; lon: number }> } }
    const geoResults = geoData.query?.geosearch || []
    if (geoResults.length === 0) return []

    // Step 2: Batch fetch extracts + images + coordinates
    const pageIds = geoResults.map(r => r.pageid).join('|')
    const extractParams = new URLSearchParams({
      action: 'query',
      pageids: pageIds,
      prop: 'extracts|pageimages',
      exintro: 'true',
      exchars: '800',
      pithumbsize: '600',
      format: 'json',
      origin: '*',
    })

    const extractResp = await fetch(`${base}?${extractParams}`)
    if (!extractResp.ok) return []
    const extractData = await extractResp.json() as { query?: { pages?: Record<string, { extract?: string; thumbnail?: { source?: string } }> } }
    const pages = extractData.query?.pages || {}

    // Step 3: Score and filter
    type ScoredPOI = POI & { _score: number }
    const scored: ScoredPOI[] = []

    for (const geoItem of geoResults) {
      // Skip if already visited
      if (excludeLower.some(ex => geoItem.title.toLowerCase().includes(ex) || ex.includes(geoItem.title.toLowerCase()))) continue

      // Skip if POI coordinates fall outside the city bounds (extra safety check on top of gsradius)
      if (!isPOINearCity(geoItem.lat, geoItem.lon, city)) continue

      const page = pages[String(geoItem.pageid)]
      if (!page?.extract) continue

      const extract = cleanHtml(page.extract)
      if (extract.length < 50) continue

      const score = scoreArticle(geoItem.title, extract, routeType)

      scored.push({
        id: `wiki-${geoItem.pageid}`,
        name: geoItem.title,
        lat: geoItem.lat,
        lon: geoItem.lon,
        category: guessCategory(geoItem.title, extract, routeType),
        routeType,
        description: extract,
        imageUrl: (page as { thumbnail?: { source?: string } }).thumbnail?.source,
        wikipediaTitle: geoItem.title,
        estimatedVisitMinutes: guessVisitMinutes(geoItem.title, extract),
        tags: {},
        _score: score,
      })
    }

    // Step 4: Sort by relevance, use all if too few scored
    scored.sort((a, b) => b._score - a._score)
    const relevant = scored.filter(p => p._score > 0)
    const result = relevant.length >= 3 ? relevant : scored

    return result.slice(0, maxPOIs).map(({ _score: _, ...poi }) => poi)
  } catch (err) {
    console.error('wikigeo error:', err)
    return []
  }
}

// Maximum distance (in degrees) a POI can be from the city centre to be accepted.
// ~0.25° ≈ 25 km — generous enough for big cities, tight enough to reject cross-country results.
const MAX_POI_DISTANCE_DEG = 0.25

/** Returns true when Wikipedia coordinates are geographically within the city. */
function isPOINearCity(poiLat: number, poiLon: number, city: City): boolean {
  if (city.boundingBox) {
    // Use bounding box + 50% padding for suburbs
    const [minLat, maxLat, minLon, maxLon] = city.boundingBox
    const latPad = (maxLat - minLat) * 0.5
    const lonPad = (maxLon - minLon) * 0.5
    return poiLat >= minLat - latPad && poiLat <= maxLat + latPad &&
           poiLon >= minLon - lonPad && poiLon <= maxLon + lonPad
  }
  const dist = Math.sqrt(Math.pow(poiLat - city.lat, 2) + Math.pow(poiLon - city.lon, 2))
  return dist < MAX_POI_DISTANCE_DEG
}

/**
 * Try to find a POI by name in a specific Wikipedia language edition.
 * Returns null if the article cannot be geolocated near the city.
 * This is the core validation step that prevents cross-city contamination.
 */
async function trySearchPOIInWiki(
  name: string,
  city: City,
  routeType: RouteType,
  wikiLang: 'es' | 'en'
): Promise<POI | null> {
  const base = WIKI_API[wikiLang]

  // Search with city name AND country for disambiguation
  // e.g. "Wawel Castle Kraków Poland" instead of just "Wawel Castle Kraków"
  const searchQuery = [name, city.name, city.country].filter(Boolean).join(' ')
  const searchParams = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: searchQuery,
    srlimit: '5',
    format: 'json',
    origin: '*',
  })

  const searchResp = await fetch(`${base}?${searchParams}`)
  if (!searchResp.ok) return null
  const searchData = await searchResp.json() as { query?: { search?: Array<{ pageid: number; title: string }> } }
  const hits = searchData.query?.search || []
  if (hits.length === 0) return null

  // Try each hit in ranking order — accept the FIRST one with valid coordinates near the city
  for (const hit of hits) {
    const pageParams = new URLSearchParams({
      action: 'query',
      pageids: String(hit.pageid),
      prop: 'extracts|pageimages|coordinates',
      exintro: 'true',
      exchars: '800',
      pithumbsize: '600',
      colimit: '1',
      format: 'json',
      origin: '*',
    })

    const pageResp = await fetch(`${base}?${pageParams}`)
    if (!pageResp.ok) continue
    const pageData = await pageResp.json() as {
      query?: {
        pages?: Record<string, {
          title?: string
          extract?: string
          thumbnail?: { source?: string }
          coordinates?: Array<{ lat: number; lon: number }>
          missing?: string
        }>
      }
    }
    const page = pageData.query?.pages?.[String(hit.pageid)]
    if (!page || page.missing !== undefined) continue

    const coords = page.coordinates?.[0]
    if (!coords) continue // No coordinates — cannot validate location, skip

    // CRITICAL: reject this article if the POI is not near the requested city
    if (!isPOINearCity(coords.lat, coords.lon, city)) continue

    const extract = cleanHtml(page.extract || '')
    if (extract.length < 30) continue

    return {
      id: `wiki-${hit.pageid}`,
      name: page.title || name,
      lat: coords.lat,
      lon: coords.lon,
      category: guessCategory(name, extract, routeType),
      routeType,
      description: extract,
      imageUrl: page.thumbnail?.source,
      wikipediaTitle: page.title,
      estimatedVisitMinutes: guessVisitMinutes(page.title || name, extract),
      tags: {},
    }
  }
  return null
}

/**
 * Search Wikipedia for a specific POI by name and return with validated coordinates.
 * Used to geocode AI-suggested POI names.
 *
 * Strategy:
 * 1. Search app-language Wikipedia with name + city + country
 * 2. If no valid near-city result, fall back to English Wikipedia
 * 3. Reject POIs whose Wikipedia coordinates are outside the city area
 *    (prevents Italian POIs appearing in Polish cities etc.)
 */
export async function searchPOIByName(
  name: string,
  city: City,
  routeType: RouteType,
  lang: Language = 'es'
): Promise<POI | null> {
  try {
    const primaryLang = lang === 'es' ? 'es' : 'en'

    // Try primary language first
    const primary = await trySearchPOIInWiki(name, city, routeType, primaryLang)
    if (primary) return primary

    // Fallback to English Wikipedia (broader coverage for non-English/non-Spanish cities)
    if (primaryLang !== 'en') {
      const english = await trySearchPOIInWiki(name, city, routeType, 'en')
      if (english) return english
    }

    // POI could not be verified near the city — reject to avoid cross-city contamination
    return null
  } catch (err) {
    console.error('searchPOIByName error:', err)
    return null
  }
}
