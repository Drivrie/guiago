import type { POI, RouteType, City, Language } from '../types'

// Wikipedia API endpoints by language code. Beyond `es` and `en`, we dynamically
// derive the local-language Wikipedia for the city's country to surface POIs
// that exist only in the country's native Wikipedia (the most common reason
// why local-but-internationally-unknown places fail to appear).
const WIKI_API_BASE = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`

const WIKI_API: Record<string, string> = {
  es: WIKI_API_BASE('es'),
  en: WIKI_API_BASE('en'),
}

// Country-code → primary Wikipedia language. Used to query the LOCAL Wikipedia
// for cities whose POIs are documented mainly in the native language.
const COUNTRY_TO_WIKI_LANG: Record<string, string> = {
  ES: 'es', MX: 'es', AR: 'es', CL: 'es', CO: 'es', PE: 'es', VE: 'es', UY: 'es',
  PY: 'es', BO: 'es', EC: 'es', CR: 'es', PA: 'es', CU: 'es', DO: 'es', GT: 'es',
  HN: 'es', NI: 'es', SV: 'es', PR: 'es',
  US: 'en', GB: 'en', IE: 'en', AU: 'en', NZ: 'en', CA: 'en', ZA: 'en',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', CH: 'de', // CH multilingual but de largest
  DE: 'de', AT: 'de', LI: 'de',
  IT: 'it', SM: 'it', VA: 'it',
  PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt',
  PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg',
  GR: 'el', CY: 'el',
  NL: 'nl', DK: 'da', SE: 'sv', NO: 'no', FI: 'fi', IS: 'is', EE: 'et',
  LV: 'lv', LT: 'lt',
  RU: 'ru', UA: 'uk', BY: 'be',
  TR: 'tr', IL: 'he', SA: 'ar', AE: 'ar', EG: 'ar', MA: 'ar', TN: 'ar', JO: 'ar',
  IR: 'fa', IN: 'hi', PK: 'ur', BD: 'bn',
  JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh', HK: 'zh', VN: 'vi', TH: 'th', ID: 'id',
  MY: 'ms', PH: 'tl',
  HR: 'hr', SI: 'sl', RS: 'sr', BA: 'bs', MK: 'mk', AL: 'sq',
}

/** Returns the local Wikipedia language code for a city's country, or null if unknown. */
function localWikiLang(city: City): string | null {
  if (!city.countryCode) return null
  const code = city.countryCode.toUpperCase()
  return COUNTRY_TO_WIKI_LANG[code] || null
}

/** Returns ranked list of Wikipedia languages to try for a city: [appLang, localLang, en] */
function wikiLangsForCity(city: City, lang: Language): string[] {
  const result: string[] = [lang === 'es' ? 'es' : 'en']
  const local = localWikiLang(city)
  if (local && !result.includes(local)) result.push(local)
  if (!result.includes('en')) result.push('en')
  return result
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

/** Geosearch radius derived from the city's bounding box (falls back to 5km). */
function deriveSearchRadius(city: City): number {
  if (city.boundingBox) {
    const [minLat, maxLat, minLon, maxLon] = city.boundingBox
    const latM = Math.abs(maxLat - minLat) * 111000
    const midLat = (maxLat + minLat) / 2
    const lonM = Math.abs(maxLon - minLon) * 111000 * Math.cos((midLat * Math.PI) / 180)
    const halfDiag = Math.max(latM, lonM) / 2
    // Cap between 4km (small towns must still get useful results) and 10km (Wikipedia max).
    return Math.min(10000, Math.max(4000, Math.round(halfDiag * 1.2)))
  }
  return 5000
}

/** Single-language Wikipedia geosearch. */
async function geosearchSingleLang(
  city: City,
  routeType: RouteType,
  wikiLang: string,
  excludeLower: string[],
  radius: number
): Promise<Array<POI & { _score: number; _lang: string }>> {
  const base = WIKI_API[wikiLang] || WIKI_API_BASE(wikiLang)
  try {
    const geoParams = new URLSearchParams({
      action: 'query',
      list: 'geosearch',
      gscoord: `${city.lat}|${city.lon}`,
      gsradius: String(radius),
      gslimit: '500',
      format: 'json',
      origin: '*',
    })
    const geoResp = await fetch(`${base}?${geoParams}`)
    if (!geoResp.ok) return []
    const geoData = await geoResp.json() as { query?: { geosearch?: Array<{ pageid: number; title: string; lat: number; lon: number }> } }
    const geoResults = geoData.query?.geosearch || []
    if (geoResults.length === 0) return []

    // Batch fetch in chunks of 50 (MediaWiki pageids limit)
    const pages: Record<string, { title?: string; extract?: string; thumbnail?: { source?: string } }> = {}
    for (let i = 0; i < geoResults.length; i += 50) {
      const slice = geoResults.slice(i, i + 50)
      const pageIds = slice.map(r => r.pageid).join('|')
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
      if (!extractResp.ok) continue
      const extractData = await extractResp.json() as { query?: { pages?: Record<string, { title?: string; extract?: string; thumbnail?: { source?: string } }> } }
      Object.assign(pages, extractData.query?.pages || {})
    }

    const scored: Array<POI & { _score: number; _lang: string }> = []
    for (const geoItem of geoResults) {
      if (excludeLower.some(ex => geoItem.title.toLowerCase().includes(ex) || ex.includes(geoItem.title.toLowerCase()))) continue
      if (!isPOINearCity(geoItem.lat, geoItem.lon, city)) continue
      const page = pages[String(geoItem.pageid)]
      const extract = cleanHtml(page?.extract || '')
      // Tolerate short extracts: keep entry but with weaker score (raw geosearch hit)
      if (!extract && !geoItem.title) continue

      const score = scoreArticle(geoItem.title, extract, routeType)
      scored.push({
        id: `wiki-${wikiLang}-${geoItem.pageid}`,
        name: geoItem.title,
        lat: geoItem.lat,
        lon: geoItem.lon,
        category: guessCategory(geoItem.title, extract, routeType),
        routeType,
        description: extract || undefined,
        imageUrl: page?.thumbnail?.source,
        wikipediaTitle: geoItem.title,
        estimatedVisitMinutes: guessVisitMinutes(geoItem.title, extract),
        tags: { wikiLang },
        _score: score + (extract.length > 200 ? 1 : 0),
        _lang: wikiLang,
      })
    }
    return scored
  } catch (err) {
    console.error(`geosearch[${wikiLang}] error:`, err)
    return []
  }
}

// Search Wikipedia geosearch around a city, score by route type. Queries app
// language + the country's local language + English in parallel and merges
// duplicates so that POIs documented only in the local Wikipedia surface too.
export async function searchPOIsWikipedia(
  city: City,
  routeType: RouteType,
  maxPOIs: number,
  lang: Language = 'es',
  excludeNames: string[] = [],
  radiusMeters: number = 4000
): Promise<POI[]> {
  try {
    const excludeLower = excludeNames.map(n => n.toLowerCase())
    // Union of both strategies: honour the caller's time-budget radius (main)
    // but never search a smaller area than the bounding-box-derived minimum so
    // small/local towns still return enough POIs (feature). Capped at 10km
    // (Wikipedia geosearch max). The route builder trims to the time budget.
    const radius = Math.min(10000, Math.max(radiusMeters, deriveSearchRadius(city)))
    const langs = wikiLangsForCity(city, lang)

    const perLang = await Promise.all(
      langs.map(l => geosearchSingleLang(city, routeType, l, excludeLower, radius))
    )

    // Merge: dedupe by (lat,lon) rounded — same POI in multiple wikis collapses to one entry.
    const merged = new Map<string, POI & { _score: number; _lang: string }>()
    for (const list of perLang) {
      for (const poi of list) {
        const key = `${poi.lat.toFixed(4)},${poi.lon.toFixed(4)}`
        const existing = merged.get(key)
        if (!existing) {
          merged.set(key, poi)
        } else {
          // Prefer entry with richer description; merge image if missing
          if ((poi.description?.length || 0) > (existing.description?.length || 0)) {
            merged.set(key, { ...poi, imageUrl: poi.imageUrl || existing.imageUrl, _score: poi._score + existing._score })
          } else {
            existing.imageUrl = existing.imageUrl || poi.imageUrl
            existing._score += poi._score
          }
        }
      }
    }

    const scored = Array.from(merged.values())
    scored.sort((a, b) => b._score - a._score)
    const relevant = scored.filter(p => p._score > 0)
    const result = relevant.length >= 2 ? relevant : scored

    return result.slice(0, maxPOIs).map(({ _score: _, _lang: __, ...poi }) => poi)
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
  wikiLang: string
): Promise<POI | null> {
  const base = WIKI_API[wikiLang] || WIKI_API_BASE(wikiLang)

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
    // Try in priority order: app language → local-country language → English.
    // Local-language search is essential for cities whose POIs are mainly
    // documented in their native Wikipedia (e.g. small Polish/Czech towns).
    const langs = wikiLangsForCity(city, lang)
    for (const wikiLang of langs) {
      const poi = await trySearchPOIInWiki(name, city, routeType, wikiLang)
      if (poi) return poi
    }
    return null
  } catch (err) {
    console.error('searchPOIByName error:', err)
    return null
  }
}
