import type { POI, RouteType, City, Language } from '../types'

const WIKI_API = {
  es: 'https://es.wikipedia.org/w/api.php',
  en: 'https://en.wikipedia.org/w/api.php'
}

// Keywords to score articles per route type
const ROUTE_KEYWORDS: Record<RouteType, RegExp> = {
  monumental: /catedral|basílica|palacio|castillo|muralla|alcázar|torre|museo|monumento|ermita|iglesia|convento|real|alcazaba|mezquita|sinagoga|alhambra|fortaleza/i,
  historia_negra: /cementerio|inquisición|guerra|batalla|matanza|ejecución|masacre|prisión|cárcel|víctimas|fusilamiento|memorial|asesinato|tragedia|holocausto/i,
  curiosidades: /fuente|estatua|escultura|plaza|barrio|leyenda|misterio|insólito|secreto|subterráneo|peculiar|curiosidad|raro|extraño/i,
  gastronomia: /mercado|gastronom|vino|tapas|cocina|taberna|bodega|feria|restaurante|jamón|queso|aceite|mariscos/i,
  arquitectura: /arquitectura|barroco|gótico|renacimiento|mudéjar|modernismo|neoclásico|románico|art.*nouveau|estilo|fachada|claustro/i,
  naturaleza: /parque|jardín|río|arroyo|sierra|monte|playa|laguna|reserva|bosque|dehesa|marisma|huerta|alameda/i
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ').trim()
}

function scoreArticle(title: string, extract: string, routeType: RouteType): number {
  const text = `${title} ${extract.slice(0, 300)}`
  const matches = text.match(new RegExp(ROUTE_KEYWORDS[routeType].source, 'gi')) || []
  return matches.length
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
    monumental: 'monumento', historia_negra: 'lugar histórico',
    curiosidades: 'punto de interés', gastronomia: 'lugar gastronómico',
    arquitectura: 'edificio', naturaleza: 'espacio natural'
  }
  return defaults[routeType]
}

export async function searchPOIsWikipedia(
  city: City,
  routeType: RouteType,
  maxPOIs: number,
  lang: Language = 'es'
): Promise<POI[]> {
  try {
    const wikiLang = lang === 'es' ? 'es' : 'en'
    const base = WIKI_API[wikiLang]

    // Step 1: Geosearch — find Wikipedia articles near city center
    const geoParams = new URLSearchParams({
      action: 'query',
      list: 'geosearch',
      gscoord: `${city.lat}|${city.lon}`,
      gsradius: '5000',
      gslimit: '50',
      format: 'json',
      origin: '*'
    })

    const geoResp = await fetch(`${base}?${geoParams}`)
    if (!geoResp.ok) return []
    const geoData = await geoResp.json()
    const geoResults: Array<{ pageid: number; title: string; lat: number; lon: number }> =
      geoData.query?.geosearch || []

    if (geoResults.length === 0) return []

    // Step 2: Batch fetch extracts for all found articles (1 API call)
    const pageIds = geoResults.map(r => r.pageid).join('|')
    const extractParams = new URLSearchParams({
      action: 'query',
      pageids: pageIds,
      prop: 'extracts|pageimages',
      exintro: 'true',
      exchars: '800',
      pithumbsize: '400',
      format: 'json',
      origin: '*'
    })

    const extractResp = await fetch(`${base}?${extractParams}`)
    if (!extractResp.ok) return []
    const extractData = await extractResp.json()
    const pages = extractData.query?.pages || {}

    // Step 3: Build scored POI list
    type ScoredPOI = POI & { _score: number }
    const scored: ScoredPOI[] = []

    for (const geoItem of geoResults) {
      const page = pages[String(geoItem.pageid)]
      if (!page || !page.extract) continue

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
        imageUrl: page.thumbnail?.source,
        wikipediaTitle: geoItem.title,
        estimatedVisitMinutes: 20,
        tags: {},
        _score: score
      })
    }

    // Step 4: Sort by relevance score, fallback to all if too few
    scored.sort((a, b) => b._score - a._score)

    const relevant = scored.filter(p => p._score > 0)
    const result = relevant.length >= 3 ? relevant : scored

    // Remove _score before returning
    return result.slice(0, maxPOIs).map(({ _score: _, ...poi }) => poi)

  } catch (err) {
    console.error('wikigeo error:', err)
    return []
  }
}
