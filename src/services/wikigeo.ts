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
  imprescindibles: /catedral|palacio|alhambra|alcázar|mezquita|museo|monumento|patrimonio|unesco|emblemático|icónico|histórico|basílica|castillo|torre|famoso|turístico|cathedral|palace|castle|museum|heritage|landmark|iconic|historic|monument|katedra|zamek|pałac|muzeum|kościół|zabytek|Dom|Kirche|Schloss|Burg|Denkmal|église|château|palais|castello|cattedrale|duomo|basilica/i,
  secretos_locales: /barrio|rincón|secreto|oculto|poco conocido|local|alternativo|auténtico|escondido|peculiar|taberna|pasaje|patio|calleja|hidden|neighbourhood|alley|courtyard|quarter|secret|dzielnica|rynek|uliczka|Viertel|Gasse|Durchgang|quartier|ruelle|quartiere|vicolo/i,
  monumental: /catedral|basílica|palacio|castillo|muralla|alcázar|torre|museo|monumento|ermita|iglesia|convento|mezquita|sinagoga|fortaleza|cathedral|basilica|palace|castle|walls|tower|museum|monument|church|convent|synagogue|fortress|chapel|katedra|bazylika|pałac|zamek|mury|wieża|muzeum|kościół|klasztor|twierdza|synagoga|Dom|Basilika|Schloss|Burg|Stadtmauer|Turm|Kloster|Festung|église|basilique|château|forteresse|monastère|abbaye|cattedrale|castello|convento|fortezza/i,
  historia_negra: /cementerio|inquisición|guerra|batalla|matanza|ejecución|masacre|prisión|cárcel|víctimas|memorial|tragedia|holocausto|cemetery|inquisition|war|battle|execution|massacre|prison|victims|memorial|genocide|cmentarz|więzienie|bitwa|egzekucja|masakra|ofiara|Friedhof|Gefängnis|Krieg|Schlacht|Hinrichtung|Opfer|cimetière|prison|guerre|bataille|esecuzione|prigione|guerra|battaglia/i,
  curiosidades: /fuente|estatua|escultura|leyenda|misterio|insólito|secreto|peculiar|curiosidad|raro|extraño|fountain|statue|sculpture|legend|mystery|unusual|underground|fontanna|posąg|legenda|tajemnica|Brunnen|Statue|Skulptur|Legende|Geheimnis|fontaine|légende|mystère|fontana|statua|scultura|leggenda|mistero/i,
  gastronomia: /mercado|gastronom|vino|tapas|cocina|taberna|bodega|restaurante|jamón|queso|aceite|mariscos|market|gastronomy|wine|cuisine|tavern|restaurant|food|targ|kuchnia|wino|restauracja|gospoda|Markt|Küche|Wein|Restaurant|Wirtshaus|marché|cuisine|vin|taverne|mercato|cucina|osteria|trattoria/i,
  arquitectura: /arquitectura|barroco|gótico|renacimiento|modernismo|neoclásico|románico|art.*nouveau|fachada|claustro|architecture|baroque|gothic|renaissance|neoclassical|romanesque|facade|cloister|architektura|gotyk|renesans|barok|fasada|Architektur|Gotik|Renaissance|Barock|Fassade|Kreuzgang|gothique|façade|architettura|gotico|rinascimento/i,
  naturaleza: /parque|jardín|río|sierra|monte|playa|laguna|reserva|bosque|marisma|alameda|park|garden|river|mountain|beach|lake|reserve|forest|wetland|nature|ogród|rzeka|góra|plaża|jezioro|las|Garten|Fluss|Berg|Strand|See|Wald|Naturpark|parc|jardin|rivière|montagne|plage|lac|forêt|parco|giardino|fiume|montagna|spiaggia|foresta/i,
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
  if (/unesco|world heritage|patrimonio|welterbe|patrimoine|dziedzictwo/i.test(text)) score += 5
  if (/catedral|palacio|castillo|museo|cathedral|palace|castle|museum|katedra|zamek|muzeum|Dom|Kirche|église|château|cattedrale/i.test(text)) score += 3
  if (/restaurante|mercado|gastronomía|restaurant|market|gastronomy|restauracja|targ|Markt|Wirtshaus|mercato/i.test(text) && routeType === 'gastronomia') score += 4
  if (title.split(' ').length <= 2 && !/catedral|museo|palacio|cathedral|museum|palace|katedra|muzeum|zamek/i.test(title)) score -= 2
  return Math.max(0, score)
}

function guessCategory(title: string, extract: string, routeType: RouteType): string {
  const t = `${title} ${extract.slice(0, 200)}`.toLowerCase()
  if (/catedral|basílica|cathedral|katedra|bazylika|Dom|Münster|cathédrale|duomo|cattedrale/.test(t)) return 'catedral'
  if (/mezquita|mosque|moschee|mosquée|moschea/.test(t)) return 'mezquita'
  if (/sinagoga|synagogue|synagoga|Synagoge|syn[ae]gogue/.test(t)) return 'sinagoga'
  if (/iglesia|parroquia|ermita|church|kościół|Kirche|église|chiesa|capilla|chapel|kapelle|chapelle/.test(t)) return 'iglesia'
  if (/convento|monasterio|monastery|klasztor|Kloster|monastère|monastero|abbaye|abbazia/.test(t)) return 'convento'
  if (/palacio|alcázar|alhambra|alcazaba|palace|pałac|Schloss|Palast|palais|palazzo/.test(t)) return 'palacio'
  if (/castillo|fortaleza|muralla|castle|zamek|Burg|château|castello|fortezza|twierdza/.test(t)) return 'castillo'
  if (/museo|museum|muzeum|Musée/.test(t)) return 'museo'
  if (/torre|tower|wieża|Turm|tour/.test(t)) return 'torre'
  if (/puente|bridge|most|Brücke|pont|ponte/.test(t)) return 'puente'
  if (/plaza|square|rynek|Platz|place|piazza/.test(t)) return 'plaza'
  if (/jardín|parque|park|ogród|Park|parc|parco|giardino/.test(t)) return 'jardín'
  if (/mercado|market|targ|Markt|marché|mercato/.test(t)) return 'mercado'
  if (/cementerio|cemetery|cmentarz|Friedhof|cimetière|cimitero/.test(t)) return 'cementerio'
  if (/teatro|theatre|teatr|Theater|théâtre/.test(t)) return 'teatro'
  if (/universidad|university|uniwersytet|Universität|université|università/.test(t)) return 'universidad'
  if (/fuente|fountain|fontanna|Brunnen|fontaine|fontana/.test(t)) return 'fuente'
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
      gsradius: '8000',
      gslimit: '100',
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
    const result = relevant.length >= 1 ? relevant : scored

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
