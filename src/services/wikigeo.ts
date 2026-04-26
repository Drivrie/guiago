import type { POI, RouteType, City, Language } from '../types'
import { getCountryLanguage } from './wikipedia'
import { translateText } from './translation'

const WIKI_API: Record<string, string> = {
  es: 'https://es.wikipedia.org/w/api.php',
  en: 'https://en.wikipedia.org/w/api.php',
  pl: 'https://pl.wikipedia.org/w/api.php',
  de: 'https://de.wikipedia.org/w/api.php',
  fr: 'https://fr.wikipedia.org/w/api.php',
  it: 'https://it.wikipedia.org/w/api.php',
  pt: 'https://pt.wikipedia.org/w/api.php',
  ru: 'https://ru.wikipedia.org/w/api.php',
}

const ROUTE_KEYWORDS: Record<RouteType, RegExp> = {
  imprescindibles: /catedral|palacio|alhambra|alcázar|mezquita|museo|monumento|patrimonio|unesco|emblemático|icónico|histórico|principal|basílica|castillo|torre|plaza mayor|famoso|turístico/i,
  secretos_locales: /barrio|rincón|secreto|oculto|poco conocido|local|vecinos|cotidiano|alternativo|auténtico|escondido|peculiar|mercadillo|taberna|pasaje|patio|calleja/i,
  monumental: /catedral|basílica|palacio|castillo|muralla|alcázar|torre|museo|monumento|ermita|iglesia|convento|real|alcazaba|mezquita|sinagoga|fortaleza/i,
  historia_negra: /cementerio|inquisición|guerra|batalla|matanza|ejecución|masacre|prisión|cárcel|víctimas|fusilamiento|memorial|asesinato|tragedia|holocausto/i,
  curiosidades: /fuente|estatua|escultura|plaza|barrio|leyenda|misterio|insólito|secreto|subterráneo|peculiar|curiosidad|raro|extraño/i,
  gastronomia: /mercado|gastronom|vino|tapas|cocina|taberna|bodega|feria|restaurante|jamón|queso|aceite|mariscos/i,
  arquitectura: /arquitectura|barroco|gótico|renacimiento|mudéjar|modernismo|neoclásico|románico|art.*nouveau|estilo|fachada|claustro/i,
  naturaleza: /parque|jardín|río|arroyo|sierra|monte|playa|laguna|reserva|bosque|dehesa|marisma|huerta|alameda/i,
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ').trim()
}

function scoreArticle(title: string, extract: string, routeType: RouteType): number {
  const text = `${title} ${extract.slice(0, 400)}`.toLowerCase()
  let score = (text.match(ROUTE_KEYWORDS[routeType]) || []).length * 2
  if (/unesco|patrimonio de la humanidad|heritage/i.test(text)) score += 5
  if (/catedral|palacio|castillo|museo/i.test(text)) score += 3
  if (/restaurante|mercado|gastronomía/i.test(text) && routeType === 'gastronomia') score += 4
  if (title.split(' ').length <= 2 && !/catedral|museo|palacio/i.test(title)) score -= 2
  return Math.max(0, score)
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

export async function searchPOIsWikipedia(
  city: City,
  routeType: RouteType,
  maxPOIs: number,
  lang: Language = 'es',
  excludeNames: string[] = []
): Promise<POI[]> {
  try {
    const targetLang = city.countryCode ? getCountryLanguage(city.countryCode) : lang
    const base = WIKI_API[targetLang] || WIKI_API['en']
    const excludeLower = excludeNames.map(n => n.toLowerCase())

    const geoParams = new URLSearchParams({
      action: 'query',
      list: 'geosearch',
      gscoord: `${city.lat}|${city.lon}`,
      gsradius: '3000',
      gslimit: '50',
      format: 'json',
      origin: '*',
    })

    const geoResp = await fetch(`${base}?${geoParams}`)
    if (!geoResp.ok) return []
    const geoData = await geoResp.json() as {
      query?: { geosearch?: Array<{ pageid: number; title: string; lat: number; lon: number }> }
    }
    const geoResults = geoData.query?.geosearch || []
    if (geoResults.length === 0) return []

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
    const extractData = await extractResp.json() as {
      query?: { pages?: Record<string, { extract?: string; thumbnail?: { source?: string } }> }
    }
    const pages = extractData.query?.pages || {}

    type ScoredPOI = POI & { _score: number }
    const scored: ScoredPOI[] = []

    for (const geoItem of geoResults) {
      if (excludeLower.some(ex =>
        geoItem.title.toLowerCase().includes(ex) || ex.includes(geoItem.title.toLowerCase())
      )) continue

      if (!isPOINearCity(geoItem.lat, geoItem.lon, city)) continue

      const page = pages[String(geoItem.pageid)]
      if (!page?.extract) continue

      const extract = cleanHtml(page.extract)
      if (extract.length < 50) continue

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
        estimatedVisitMinutes: 20,
        tags: {},
        _score: scoreArticle(geoItem.title, extract, routeType),
      })
    }

    scored.sort((a, b) => b._score - a._score)
    const relevant = scored.filter(p => p._score > 0)
    const result = relevant.length >= 3 ? relevant : scored

    // Translate POI content to app language if Wikipedia language differs
    if (city.countryCode) {
      const poiLang = getCountryLanguage(city.countryCode)
      if (poiLang !== lang) {
        for (const poi of result) {
          if (poi.description) {
            poi.description = await translateText(poi.description, lang, poiLang)
          }
          poi.name = await translateText(poi.name, lang, poiLang)
        }
      }
    }

    return result.slice(0, maxPOIs).map(({ _score: _, ...poi }) => poi)
  } catch (err) {
    console.error('wikigeo error:', err)
    return []
  }
}

const MAX_POI_DISTANCE_DEG = 0.25

function isPOINearCity(poiLat: number, poiLon: number, city: City): boolean {
  if (city.boundingBox) {
    const [minLat, maxLat, minLon, maxLon] = city.boundingBox
    const latPad = (maxLat - minLat) * 0.5
    const lonPad = (maxLon - minLon) * 0.5
    return poiLat >= minLat - latPad && poiLat <= maxLat + latPad &&
           poiLon >= minLon - lonPad && poiLon <= maxLon + lonPad
  }
  const dist = Math.sqrt(Math.pow(poiLat - city.lat, 2) + Math.pow(poiLon - city.lon, 2))
  return dist < MAX_POI_DISTANCE_DEG
}

async function trySearchPOIInWiki(
  name: string,
  city: City,
  routeType: RouteType,
  wikiLang: string
): Promise<POI | null> {
  const base = WIKI_API[wikiLang] || WIKI_API['en']
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
  const searchData = await searchResp.json() as {
    query?: { search?: Array<{ pageid: number; title: string }> }
  }
  const hits = searchData.query?.search || []
  if (hits.length === 0) return null

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
    if (!coords) continue

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
      estimatedVisitMinutes: 20,
      tags: {},
    }
  }
  return null
}

export async function searchPOIByName(
  name: string,
  city: City,
  routeType: RouteType,
  lang: Language = 'es'
): Promise<POI | null> {
  try {
    const targetLang = city.countryCode ? getCountryLanguage(city.countryCode) : lang

    const primary = await trySearchPOIInWiki(name, city, routeType, targetLang)
    if (primary) return primary

    if (targetLang !== 'en') {
      const english = await trySearchPOIInWiki(name, city, routeType, 'en')
      if (english) return english
    }

    return null
  } catch (err) {
    console.error('searchPOIByName error:', err)
    return null
  }
}
