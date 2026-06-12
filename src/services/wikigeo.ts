import type { POI, RouteType, City, Language } from '../types'
import { fetchSitelinksCounts } from './wikidata'

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

/** Public: local Wikipedia language for an ISO country code ('PL' → 'pl'). */
export function wikiLangForCountry(countryCode?: string): string | null {
  if (!countryCode) return null
  return COUNTRY_TO_WIKI_LANG[countryCode.toUpperCase()] || null
}

/** Returns ranked list of Wikipedia languages to try for a city: [appLang, localLang, en] */
function wikiLangsForCity(city: City, lang: Language): string[] {
  const result: string[] = [lang === 'es' ? 'es' : 'en']
  const local = localWikiLang(city)
  if (local && !result.includes(local)) result.push(local)
  if (!result.includes('en')) result.push('en')
  return result
}

// Keywords per route type for scoring Wikipedia articles — extended with
// English / international terms so the geosearch works for any city.
const ROUTE_KEYWORDS: Record<RouteType, RegExp> = {
  imprescindibles: /catedral|palacio|alhambra|alcázar|mezquita|museo|monumento|patrimonio|unesco|emblemático|icónico|histórico|principal|basílica|castillo|torre|plaza mayor|famoso|turístico|cathedral|palace|castle|museum|monument|heritage|iconic|famous|landmark|basilica|tower|main square|historic|plaza|square|bridge|puente|gate|puerta|wall|muralla|temple|templo|market|mercado/i,
  secretos_locales: /barrio|rincón|secreto|oculto|poco conocido|local|vecinos|cotidiano|alternativo|auténtico|escondido|peculiar|mercadillo|taberna|pasaje|patio|calleja|hidden|secret|local favourite|tucked away|quiet|backstreet|alley|courtyard|insider/i,
  monumental: /catedral|basílica|palacio|castillo|muralla|alcázar|torre|museo|monumento|ermita|iglesia|convento|real|alcazaba|mezquita|sinagoga|alhambra|fortaleza|cathedral|basilica|palace|castle|wall|tower|museum|monument|chapel|church|convent|abbey|royal|fort/i,
  historia_negra: /cementerio|inquisición|guerra|batalla|matanza|ejecución|masacre|prisión|cárcel|víctimas|fusilamiento|memorial|asesinato|tragedia|holocausto|peste|tortura|verdugo|brujas|judería|pogromo|cemetery|graveyard|inquisition|war|battle|massacre|execution|prison|jail|victims|firing squad|murder|tragedy|holocaust|plague|torture|witches|ghetto|pogrom|haunted|crime/i,
  curiosidades: /fuente|estatua|escultura|leyenda|misterio|insólito|secreto|subterráneo|peculiar|curiosidad|raro|extraño|único|extraordinario|inusual|excéntrico|fountain|statue|sculpture|legend|mystery|unusual|peculiar|curiosity|odd|strange|unique|extraordinary|eccentric|smallest|oldest|narrowest|tallest|hidden|underground|mural|street art|graffiti|easter egg|quirky/i,
  gastronomia: /mercado|gastronom|vino|tapas|cocina|taberna|bodega|feria|restaurante|jamón|queso|aceite|mariscos|tabernero|chef|chocolatería|pastelería|cervecería|sidrería|asador|denominación de origen|market|gastronom|wine|tapas|cuisine|tavern|winery|food fair|restaurant|ham|cheese|olive oil|seafood|brewery|chocolaterie|patisserie|cider house|grill|protected designation/i,
  arquitectura: /arquitectura|barroco|gótico|renacimiento|mudéjar|modernismo|neoclásico|románico|art.*nouveau|estilo|fachada|claustro|cúpula|art déco|bauhaus|brutalismo|architecture|baroque|gothic|renaissance|moorish|modernism|neoclassical|romanesque|style|façade|facade|cloister|dome|art deco|brutalism/i,
  naturaleza: /parque|jardín|río|arroyo|sierra|monte|playa|laguna|reserva|bosque|dehesa|marisma|huerta|alameda|cascada|lago|estanque|park|garden|river|stream|mountain|beach|lagoon|reserve|forest|woodland|marsh|waterfall|lake|pond|greenway|botanical/i,
}

// Off-theme categories per route type — articles that obviously belong to a
// DIFFERENT route theme should be rejected outright (otherwise a famous
// cathedral surfaces as a "gastronomic" result just because Wikipedia has a
// long article about it).
//
// Empty regex (`(?!)`) means "no off-theme exclusions" — used for the
// imprescindibles / monumental / arquitectura types where landmark articles
// are the legitimate target.
const OFF_THEME_KEYWORDS: Record<RouteType, RegExp> = {
  imprescindibles: /(?!)/,
  monumental: /(?!)/,
  arquitectura: /(?!)/,
  gastronomia: /\b(catedral|cathedral|basílica|basilica|sinagoga|synagogue|mezquita|mosque|convento|convent|monasterio|monastery|cementerio|cemetery|necrópolis|necropolis|batalla|battle|guerra militar)\b/i,
  historia_negra: /\b(jardín botánico|botanical garden|parque urbano|public park|fuente decorativa|decorative fountain|mercado de abastos|food market|wine festival|sidrería|cider house|panadería|bakery|restaurante|restaurant|cafetería|cafe)\b/i,
  curiosidades: /\b(banco central|central bank|hospital general|general hospital|ayuntamiento sede|city hall headquarters|aeropuerto|airport)\b/i,
  secretos_locales: /(?!)/, // handled by fame inverse weighting instead
  naturaleza: /\b(catedral|cathedral|basílica|basilica|palacio|palace|castillo|castle|museo|museum|sinagoga|synagogue|mezquita|mosque|inquisición|inquisition|ejecución|execution)\b/i,
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

/**
 * Score a Wikipedia article for relevance to the requested route type.
 *
 * THE KEYWORD GATE: for any route type EXCEPT `imprescindibles`, an article
 * with zero on-theme keyword matches returns score 0 (and the caller drops
 * it via `_score > 0` filtering). This prevents famous-but-off-theme
 * landmarks (cathedrals, palaces) from drowning out genuine gastronomía,
 * naturaleza, historia_negra, curiosidades POIs just because they have long
 * Wikipedia articles. Length and heritage bonuses ONLY apply on top of a
 * positive keyword match — they amplify on-theme hits, never lift off-theme
 * ones.
 *
 * For `imprescindibles`, any landmark-keyword match across all themes is
 * accepted: it's the catch-all "best-of" type that should surface the
 * city's most iconic sites regardless of niche.
 */
function scoreArticle(title: string, extract: string, routeType: RouteType): number {
  const text = `${title} ${extract.slice(0, 600)}`

  // OFF-THEME REJECTION — articles whose title/intro clearly belong to a
  // different theme score 0 outright. Biggest single lever for route-type
  // differentiation.
  const offThemeRe = OFF_THEME_KEYWORDS[routeType]
  if (offThemeRe.source !== '(?!)' && offThemeRe.test(text)) return 0

  if (routeType === 'imprescindibles') {
    const allMatches = (text.match(ALL_KEYWORDS_RE) || []).length
    if (allMatches === 0 && extract.length < 600) return 0
    const notorietyBonus = /turístico|famoso|emblemático|icónico|símbolo|principal|destacad|patrimonio|unesco|known for|famous|landmark|iconic|renowned|world-famous/i.test(text) ? 4 : 0
    const heritageBonus = /unesco|patrimonio mundial|world heritage|monumento nacional|national monument|bien de interés cultural|bic\b|listed building|denkmalliste/i.test(extract) ? 6 : 0
    const lengthBonus = extract.length > 1500 ? 4 : extract.length > 800 ? 3 : extract.length > 400 ? 2 : 0
    return allMatches + notorietyBonus + heritageBonus + lengthBonus
  }

  const re = new RegExp(ROUTE_KEYWORDS[routeType].source, 'gi')
  const themeMatches = (text.match(re) || []).length
  if (themeMatches === 0) return 0   // THE GATE — drop everything off-theme

  const lengthBonus = extract.length > 1500 ? 3 : extract.length > 800 ? 2 : extract.length > 400 ? 1 : 0
  const heritageBonus = /unesco|patrimonio mundial|world heritage|monumento nacional|national monument|bien de interés cultural|bic\b|listed building/i.test(extract) ? 4 : 0
  return themeMatches * 2 + lengthBonus + heritageBonus
}

/** Sitelinks weight per route type — how much international fame matters
 *  for each kind of route. Iconic-landmark routes weight it heavily;
 *  "local secrets" routes weight it inversely (we actually want LESS famous). */
function fameWeight(routeType: RouteType): number {
  switch (routeType) {
    case 'imprescindibles': return 1.0
    case 'monumental': return 0.9
    case 'arquitectura': return 0.7
    case 'historia_negra': return 0.4
    case 'gastronomia': return 0.3
    case 'curiosidades': return 0.3
    case 'naturaleza': return 0.5
    case 'secretos_locales': return 0.05  // local secrets are by definition not internationally famous
    default: return 0.5
  }
}

/** Realistic visit times for a walking-tour stop (not a deep interior visit). */
function guessVisitMinutes(title: string, extract: string): number {
  const t = `${title} ${extract.slice(0, 200)}`.toLowerCase()
  if (/museo|museum/.test(t)) return 20
  if (/catedral|basílica|cathedral|basilica/.test(t)) return 15
  if (/palacio|palace|alcázar|alhambra|alcazaba/.test(t)) return 18
  if (/castillo|castle|fortaleza|muralla/.test(t)) return 15
  if (/parque|jardín|park|garden/.test(t)) return 12
  if (/mercado|market/.test(t)) return 20
  if (/restaurante|restaurant|taberna|tavern|bar|café|cafe/.test(t)) return 45
  if (/plaza|square|piazza/.test(t)) return 10
  if (/puente|bridge|pont/.test(t)) return 8
  if (/iglesia|church|convento|monasterio|chapel/.test(t)) return 12
  if (/torre|tower/.test(t)) return 10
  if (/cementerio|cemetery|prisión|prison/.test(t)) return 20
  return 15
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

    // Batch fetch in chunks of 50 (MediaWiki pageids limit). We also request
    // `pageprops` (specifically `wikibase_item`, the Wikidata Q-id) so we can
    // re-rank by international fame via sitelinks later — see fetchSitelinksCounts.
    type WikiPage = {
      title?: string
      extract?: string
      thumbnail?: { source?: string }
      pageprops?: { wikibase_item?: string }
    }
    const pages: Record<string, WikiPage> = {}
    for (let i = 0; i < geoResults.length; i += 50) {
      const slice = geoResults.slice(i, i + 50)
      const pageIds = slice.map(r => r.pageid).join('|')
      const extractParams = new URLSearchParams({
        action: 'query',
        pageids: pageIds,
        prop: 'extracts|pageimages|pageprops',
        ppprop: 'wikibase_item',
        exintro: 'true',
        exchars: '800',
        pithumbsize: '600',
        format: 'json',
        origin: '*',
      })
      const extractResp = await fetch(`${base}?${extractParams}`)
      if (!extractResp.ok) continue
      const extractData = await extractResp.json() as { query?: { pages?: Record<string, WikiPage> } }
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
      const qid = page?.pageprops?.wikibase_item
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
        tags: { wikiLang, ...(qid ? { wikidata: qid } : {}) },
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

    // International-fame re-rank via Wikidata sitelinks. For the top ~30
    // candidates we batch-fetch the number of Wikipedia editions that link
    // to each entity (world-famous landmarks: 50-200+; minor local sites: 1-3),
    // and fold that into the score. The weight per route type lets routes like
    // "secretos_locales" deliberately favour LESS famous sites.
    const TOP_FOR_FAME = Math.min(30, scored.length)
    const topQids = scored.slice(0, TOP_FOR_FAME)
      .map(p => p.tags?.wikidata)
      .filter((q): q is string => !!q)
    const sitelinks = await fetchSitelinksCounts(topQids)
    const weight = fameWeight(routeType)
    if (sitelinks.size > 0) {
      for (const p of scored.slice(0, TOP_FOR_FAME)) {
        const qid = p.tags?.wikidata
        if (!qid) continue
        const links = sitelinks.get(qid) || 0
        if (links <= 0) continue
        // sitelinks → fame bonus: scaled by route-type weight, capped to keep
        // famous-but-thematically-wrong POIs from dominating. A weight of 1.0
        // and 60 sitelinks → +24 bonus (large but bounded).
        const bonus = Math.min(28, Math.round(links * weight * 0.45))
        p._score += bonus
      }
      // Re-sort after fame fold-in
      scored.sort((a, b) => b._score - a._score)
    }

    // Always honour the theme gate — never silently surface off-theme
    // (score 0) articles even when no on-theme article was found. An empty
    // result triggers the theme-preserving fallback chain in RouteSetupPage,
    // which is preferable to a "gastronomic route showing only cathedrals".
    const result = scored.filter(p => p._score > 0)

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
