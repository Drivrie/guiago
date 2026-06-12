import type { WikiResult, Language } from '../types'
import { wikiLangForCountry } from './wikigeo'

const WIKI_API = {
  es: 'https://es.wikipedia.org/w/api.php',
  en: 'https://en.wikipedia.org/w/api.php'
}

// Wikivoyage — same MediaWiki API, travel-focused content (tips, what to see, etc.)
const WIKIVOYAGE_API = {
  es: 'https://es.wikivoyage.org/w/api.php',
  en: 'https://en.wikivoyage.org/w/api.php'
}

interface WikiApiResponse {
  query?: {
    pages?: Record<string, {
      pageid?: number
      title?: string
      extract?: string
      thumbnail?: { source?: string }
      missing?: string
    }>
    search?: Array<{
      pageid: number
      title: string
      snippet?: string
    }>
  }
}

export async function searchArticle(query: string, lang: 'es' | 'en' = 'es'): Promise<WikiResult | null> {
  try {
    const base = WIKI_API[lang]
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '3',
      format: 'json',
      origin: '*'
    })

    const response = await fetch(`${base}?${params}`)
    if (!response.ok) return null

    const data: WikiApiResponse = await response.json()
    const results = data?.query?.search

    if (!results || results.length === 0) return null

    const firstResult = results[0]
    return await getFullArticle(firstResult.pageid, lang)
  } catch (error) {
    console.error('Wikipedia search error:', error)
    return null
  }
}

export async function getFullArticle(pageid: number, lang: 'es' | 'en' = 'es'): Promise<WikiResult | null> {
  try {
    const base = WIKI_API[lang]
    const params = new URLSearchParams({
      action: 'query',
      pageids: String(pageid),
      prop: 'extracts|pageimages',
      exintro: 'false',
      exchars: '2000',
      pithumbsize: '600',
      format: 'json',
      origin: '*'
    })

    const response = await fetch(`${base}?${params}`)
    if (!response.ok) return null

    const data: WikiApiResponse = await response.json()
    const pages = data?.query?.pages
    if (!pages) return null

    const page = pages[String(pageid)]
    if (!page || page.missing !== undefined) return null

    return {
      pageid: page.pageid!,
      title: page.title!,
      extract: cleanWikiExtract(page.extract || ''),
      imageUrl: page.thumbnail?.source,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title!.replace(/ /g, '_'))}`
    }
  } catch (error) {
    console.error('Wikipedia getFullArticle error:', error)
    return null
  }
}

/**
 * Internal: fetch POI info from any MediaWiki-compatible API (Wikipedia, Wikivoyage…)
 * Tries direct title lookup first, falls back to full-text search.
 */
async function fetchPOIFromMediaWiki(
  name: string,
  lang: Language,
  apiBase: string,
  siteBase: string
): Promise<WikiResult | null> {
  try {
    // 1. Direct title lookup
    const directParams = new URLSearchParams({
      action: 'query',
      titles: name,
      prop: 'extracts|pageimages',
      exintro: 'true',
      exchars: '6000',
      pithumbsize: '600',
      format: 'json',
      origin: '*'
    })
    const directResp = await fetch(`${apiBase}?${directParams}`)
    if (directResp.ok) {
      const data: WikiApiResponse = await directResp.json()
      const pages = data?.query?.pages
      if (pages) {
        const page = Object.values(pages)[0]
        if (page?.pageid && page.missing === undefined) {
          const extract = cleanWikiExtract(page.extract || '')
          if (extract) {
            return {
              pageid: page.pageid,
              title: page.title!,
              extract,
              imageUrl: page.thumbnail?.source,
              url: `${siteBase}/wiki/${encodeURIComponent(page.title!.replace(/ /g, '_'))}`
            }
          }
        }
      }
    }

    // 2. Fallback: full-text search
    const searchParams = new URLSearchParams({
      action: 'query', list: 'search', srsearch: name,
      srlimit: '3', format: 'json', origin: '*'
    })
    const searchResp = await fetch(`${apiBase}?${searchParams}`)
    if (!searchResp.ok) return null
    const searchData: WikiApiResponse = await searchResp.json()
    const results = searchData?.query?.search
    if (!results?.length) return null

    // 3. Fetch full article for first result
    const fullParams = new URLSearchParams({
      action: 'query', pageids: String(results[0].pageid),
      prop: 'extracts|pageimages', exintro: 'true', exchars: '6000',
      pithumbsize: '600', format: 'json', origin: '*'
    })
    const fullResp = await fetch(`${apiBase}?${fullParams}`)
    if (!fullResp.ok) return null
    const fullData: WikiApiResponse = await fullResp.json()
    const fullPages = fullData?.query?.pages
    if (!fullPages) return null
    const fullPage = fullPages[String(results[0].pageid)]
    if (!fullPage?.pageid) return null

    return {
      pageid: fullPage.pageid!,
      title: fullPage.title!,
      extract: cleanWikiExtract(fullPage.extract || ''),
      imageUrl: fullPage.thumbnail?.source,
      url: `${siteBase}/wiki/${encodeURIComponent(fullPage.title!.replace(/ /g, '_'))}`
    }
  } catch { return null }
}

export async function getPOIDescription(name: string, lang: Language = 'es'): Promise<string> {
  try {
    // Merge Wikipedia + Wikivoyage so the narration prompt receives BOTH
    // encyclopedic context (history, dates, names) and travel-guide flavour
    // (what to see, when to go, anecdotes). This is what unlocks Civitatis-
    // quality narrations: the AI no longer has to invent the travel-tip half.
    const [wikiRes, voyageRes] = await Promise.allSettled([
      fetchPOIFromMediaWiki(name, lang, WIKI_API[lang], `https://${lang}.wikipedia.org`),
      fetchPOIFromMediaWiki(name, lang, WIKIVOYAGE_API[lang], `https://${lang}.wikivoyage.org`),
    ])
    const wiki = wikiRes.status === 'fulfilled' ? wikiRes.value : null
    const voyage = voyageRes.status === 'fulfilled' ? voyageRes.value : null
    const parts: string[] = []
    if (wiki?.extract) parts.push(wiki.extract)
    if (voyage?.extract && (!wiki?.extract || !wiki.extract.includes(voyage.extract.slice(0, 40)))) {
      parts.push(voyage.extract)
    }
    if (parts.length > 0) return parts.join(' ').trim()
    return generateFallbackDescription(name, lang)
  } catch (error) {
    console.error('Error getting POI description:', error)
    return generateFallbackDescription(name, lang)
  }
}

export async function getPOIInfo(name: string, lang: Language = 'es'): Promise<WikiResult | null> {
  return fetchPOIFromMediaWiki(
    name, lang,
    WIKI_API[lang],
    `https://${lang}.wikipedia.org`
  )
}

/**
 * City-aware POI lookup. When `context` is provided (city name + optional country and
 * coordinates), the search is biased to results inside that locality — preventing the
 * "Catedral" query from returning Sevilla's cathedral when the user is actually in
 * Burgos. When coordinates are given, results are validated against geosearch.
 */
export interface POILookupContext {
  cityName?: string
  country?: string
  countryCode?: string
  lat?: number
  lon?: number
  /** Search radius in metres for coordinate validation (default 6km). */
  radiusMeters?: number
}

/**
 * Multi-source POI lookup: queries Wikipedia + Wikivoyage in parallel.
 * Wikipedia provides encyclopedic facts; Wikivoyage adds practical travel tips.
 * Returns the merged best result — prefers Wikipedia as base, supplements with
 * Wikivoyage content and fills in missing images from either source.
 *
 * If `context` is given, queries are city-scoped and results that don't match
 * the city (by geo or by extract content) are rejected, then the search retries
 * with the bare query as a last resort.
 */
export async function getPOIInfoMultiSource(
  name: string,
  lang: Language = 'es',
  context?: POILookupContext
): Promise<WikiResult | null> {
  // 1. If we have a city context, prefer geosearch — only Wikipedia articles whose
  //    coordinates fall within `radiusMeters` of the city are accepted. This is
  //    the only reliable way to prevent cross-city contamination.
  //    Searched across app language + the country's LOCAL Wikipedia + English,
  //    matching what route generation does — previously this only looked at
  //    one language, which is why "search a place" missed POIs that route
  //    building later found.
  if (context?.lat !== undefined && context?.lon !== undefined) {
    const geoLangs: string[] = [lang]
    const local = wikiLangForCountry(context.countryCode)
    if (local && !geoLangs.includes(local)) geoLangs.push(local)
    if (!geoLangs.includes('en')) geoLangs.push('en')
    for (const gl of geoLangs) {
      const geoHit = await searchPOIByGeo(name, gl, context.lat, context.lon, context.radiusMeters ?? 6000)
      if (geoHit) return geoHit
    }
  }

  // 2. City-scoped name search: append city + country to the query so MediaWiki's
  //    full-text search disambiguates correctly. Used for both Wikipedia and Wikivoyage.
  const scopedQuery = context?.cityName
    ? [name, context.cityName, context.country].filter(Boolean).join(' ')
    : name

  const [wikiRes, voyageRes] = await Promise.allSettled([
    fetchPOIFromMediaWiki(scopedQuery, lang, WIKI_API[lang], `https://${lang}.wikipedia.org`),
    fetchPOIFromMediaWiki(scopedQuery, lang, WIKIVOYAGE_API[lang], `https://${lang}.wikivoyage.org`),
  ])

  let wiki = wikiRes.status === 'fulfilled' ? wikiRes.value : null
  let voyage = voyageRes.status === 'fulfilled' ? voyageRes.value : null

  // 3. If a city context exists, reject results that clearly belong elsewhere.
  //    We deliberately do NOT retry with a bare name here: a bare-name fallback
  //    is what causes "Catedral" in Burgos to return Sevilla's cathedral when
  //    the scoped search finds nothing. Better to return null than to lie.
  if (context?.cityName) {
    if (wiki && !articleMatchesCity(wiki, context)) wiki = null
    if (voyage && !articleMatchesCity(voyage, context)) voyage = null
  }

  if (!wiki && !voyage) return null
  if (!wiki) return voyage
  if (!voyage) return wiki

  // Merge: Wikipedia as base, Wikivoyage supplement if non-overlapping
  const voyageExtra = voyage.extract && !wiki.extract.includes(voyage.extract.slice(0, 40))
    ? voyage.extract
    : ''

  return {
    ...wiki,
    imageUrl: wiki.imageUrl || voyage.imageUrl,
    extract: [wiki.extract, voyageExtra].filter(Boolean).join(' ').trim(),
  }
}

/**
 * Heuristic: does the article actually belong to the requested city?
 *
 * Requires the city name to appear as a discrete WORD in title or extract
 * (not just as a substring). The previous version accepted a country mention
 * as sufficient — but a famous "Catedral" article that mentions "Spain"
 * would then pass even if it's in Sevilla while the user is in Burgos.
 * Country alone is no longer enough.
 */
function articleMatchesCity(article: WikiResult, context?: POILookupContext): boolean {
  if (!context?.cityName) return true
  const haystack = `${article.title} ${article.extract}`.toLowerCase()
  const city = context.cityName.toLowerCase().trim()
  if (!city) return true
  // Word-boundary match, with city name regex-escaped
  const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const cityWord = new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'iu')
  return cityWord.test(haystack)
}

/** Rough title-similarity for "Qué visitar hoy" ranking: how closely does
 *  the article's title match the user's free-text query?  Returns 0..1. */
function titleSimilarity(query: string, title: string): number {
  const q = query.toLowerCase().trim()
  const t = title.toLowerCase().trim()
  if (!q || !t) return 0
  if (t === q) return 1
  if (t.includes(q)) return 0.9
  if (q.includes(t)) return 0.7
  const qWords = new Set(q.split(/\s+/).filter(w => w.length > 2))
  const tWords = new Set(t.split(/\s+/).filter(w => w.length > 2))
  if (qWords.size === 0) return 0
  let common = 0
  for (const w of qWords) if (tWords.has(w)) common++
  return common / qWords.size * 0.6
}

/**
 * Geo-validated POI lookup: uses Wikipedia geosearch around (lat,lon) so we only
 * accept articles physically located inside the user's city.
 */
async function searchPOIByGeo(
  name: string,
  lang: string, // any Wikipedia language code, not just app languages
  lat: number,
  lon: number,
  radiusMeters: number
): Promise<WikiResult | null> {
  try {
    const base = `https://${lang}.wikipedia.org/w/api.php`
    // First, run a city-scoped full-text search to identify candidate page IDs.
    const searchParams = new URLSearchParams({
      action: 'query', list: 'search', srsearch: name,
      srlimit: '10', format: 'json', origin: '*'
    })
    const searchResp = await fetch(`${base}?${searchParams}`)
    if (!searchResp.ok) return null
    const searchData = await searchResp.json() as { query?: { search?: Array<{ pageid: number; title: string }> } }
    const hits = searchData.query?.search || []
    if (hits.length === 0) return null

    // Fetch coordinates for each hit and pick the first one inside the radius.
    const pageIds = hits.map(h => h.pageid).join('|')
    const detailParams = new URLSearchParams({
      action: 'query', pageids: pageIds,
      prop: 'extracts|pageimages|coordinates',
      exintro: 'true', exchars: '6000',
      pithumbsize: '600', colimit: '1',
      format: 'json', origin: '*'
    })
    const detailResp = await fetch(`${base}?${detailParams}`)
    if (!detailResp.ok) return null
    const detailData = await detailResp.json() as {
      query?: {
        pages?: Record<string, {
          pageid?: number; title?: string; extract?: string;
          thumbnail?: { source?: string };
          coordinates?: Array<{ lat: number; lon: number }>;
          missing?: string;
        }>
      }
    }
    const pages = detailData.query?.pages || {}

    // Rank candidate hits by a combined score: title similarity to the user
    // query (so "Catedral de Burgos" beats a nearby unrelated article that
    // happens to be a few metres closer) + inverse distance (so a hit 200 m
    // away beats one 3 km away when titles are equally close).
    type Candidate = { combined: number; page: { pageid?: number; title?: string; extract?: string; thumbnail?: { source?: string } } }
    const candidates: Candidate[] = []
    for (const hit of hits) {
      const page = pages[String(hit.pageid)]
      if (!page || page.missing !== undefined) continue
      const coords = page.coordinates?.[0]
      if (!coords) continue
      const distM = haversineMeters(lat, lon, coords.lat, coords.lon)
      if (distM > radiusMeters) continue
      const sim = titleSimilarity(name, page.title || '')
      const proximity = Math.max(0, 1 - distM / radiusMeters)
      const combined = sim * 100 + proximity * 20
      candidates.push({ combined, page })
    }
    candidates.sort((a, b) => b.combined - a.combined)

    for (const { page } of candidates) {
      const extract = cleanWikiExtract(page.extract || '')
      if (!extract) continue
      return {
        pageid: page.pageid!,
        title: page.title!,
        extract,
        imageUrl: page.thumbnail?.source,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title!.replace(/ /g, '_'))}`,
      }
    }
    return null
  } catch (err) {
    console.error('searchPOIByGeo error:', err)
    return null
  }
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function getCityDescription(cityName: string, lang: Language = 'es'): Promise<WikiResult | null> {
  return getPOIInfo(cityName, lang)
}

function cleanWikiExtract(extract: string): string {
  if (!extract) return ''

  let cleaned = extract.replace(/<[^>]+>/g, '')

  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')

  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  if (cleaned.length < 50) return ''

  return cleaned
}

function generateFallbackDescription(name: string, lang: Language): string {
  if (lang === 'en') {
    return `${name} is a notable point of interest in this area. Visit to discover its history and significance.`
  }
  return `${name} es un punto de interés destacado en esta zona. Visítalo para descubrir su historia y significado.`
}

export function generateWalkingScript(targetName: string, distanceMeters: number, lang: Language): string {
  const dist = distanceMeters > 50
    ? (distanceMeters < 1000
      ? `${Math.round(distanceMeters / 10) * 10} metros`
      : `${(distanceMeters / 1000).toFixed(1)} kilómetros`)
    : ''

  if (lang === 'en') {
    const phrases = [
      `Right then, let's head over to ${targetName}. ${dist ? `It's about ${dist} from here.` : ''} Follow the directions on screen.`,
      `Next up: ${targetName}. ${dist ? `Around ${dist} on foot.` : ''} I'll guide you there.`,
      `Time to walk to ${targetName}. ${dist ? `About ${dist} away.` : ''} Let's go!`,
    ]
    let hash = 0
    for (let i = 0; i < targetName.length; i++) hash = (hash * 31 + targetName.charCodeAt(i)) >>> 0
    return phrases[hash % phrases.length]
  }

  const phrases = [
    `Venga, ahora nos vamos hacia ${targetName}. ${dist ? `Está a unos ${dist}.` : ''} Sigue las indicaciones de la pantalla.`,
    `Siguiente parada: ${targetName}. ${dist ? `A unos ${dist} caminando.` : ''} ¡Vamos!`,
    `Ahora nos dirigimos a ${targetName}. ${dist ? `Hay unos ${dist} por delante.` : ''} Sigue por donde te indico.`,
    `¡Perfecto! Próxima parada: ${targetName}. ${dist ? `A unos ${dist} de aquí.` : ''} ¡En marcha!`,
  ]
  let hash = 0
  for (let i = 0; i < targetName.length; i++) hash = (hash * 31 + targetName.charCodeAt(i)) >>> 0
  return phrases[hash % phrases.length]
}

function pickPhrase(arr: string[], name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return arr[hash % arr.length]
}

export function generateAudioScript(
  poi: { name: string; category: string; description?: string; insiderTip?: string },
  lang: Language
): string {
  const desc = poi.description || ''

  const sentences = desc
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 30)

  // Richer narration when AI is unavailable: 5 main sentences + 3 extras
  // (was 3+2) so the template script feels closer to a real audio guide.
  const mainContent = sentences.slice(0, 5).join(' ')
  const extraContent = sentences.slice(5, 8).join(' ')
  const tip = poi.insiderTip?.trim()

  if (lang === 'en') {
    // Always start by asking visitor to look at the image to confirm they're at the right place
    const imageConfirm = `Look at the image on your screen — that's ${poi.name}. Make sure you're at the right spot! `

    const openings = [
      `Right, you've made it! In front of you... is ${poi.name}. Take a second to look around.`,
      `Here we are at ${poi.name}. Pay attention, because this place has quite a story.`,
      `Welcome! You've just arrived at ${poi.name}... and trust me, it's worth it.`,
      `This is ${poi.name}. One of the most interesting stops on our route today.`,
      `So, here you are at ${poi.name}. Have a good look — there's more to this place than meets the eye.`,
    ]
    const connectors = [
      'And did you know that', 'Interestingly enough,', 'Here\'s something worth knowing:',
      'This is the fun part —', 'What many people don\'t realise is that'
    ]
    const closings = [
      `Take a good look around before we move on. No rush!`,
      `Have a proper look — there's a lot to take in here. When you're ready, we'll head to the next stop.`,
      `Don't rush this one. It deserves your full attention. Just let me know when you're ready to continue.`,
      `Spend a moment here and soak it all in. We'll move on whenever you're ready.`,
    ]

    let script = imageConfirm + pickPhrase(openings, poi.name) + ' '
    if (mainContent) script += mainContent + ' '
    if (extraContent) script += pickPhrase(connectors, poi.name + 'x') + ' ' + extraContent.charAt(0).toLowerCase() + extraContent.slice(1) + ' '
    if (tip) script += `Insider tip: ${tip} `
    script += pickPhrase(closings, poi.name + 'z')
    return script
  }

  // Spanish: always start by asking visitor to look at the image to confirm location
  const imageConfirm = `Mira la imagen en pantalla, ¿ves ${poi.name}? ¡Estupendo, estás en el lugar correcto! `

  const openings = [
    `¡Pues ya estás aquí! Tienes delante... ${poi.name}. Tómate un momento para observarlo bien.`,
    `¡Perfecto, has llegado! Esto que ves es ${poi.name}, y... tiene mucha historia que contarte.`,
    `Bien, este es el sitio. Estás en ${poi.name}. Fíjate bien en lo que te rodea, porque merece la pena.`,
    `¡Aquí está! Bienvenido a ${poi.name}. Uno de los lugares más especiales de esta ruta, y eso es decir mucho.`,
    `Ya estás en ${poi.name}. Y mira, hay cosas muy interesantes que contarte de este sitio.`,
    `¡Venga, ya llegaste! Este lugar que tienes delante es ${poi.name}. Échale un buen vistazo primero.`,
  ]
  const connectors = [
    '¿Sabías que', 'Pues mira, resulta que', 'Lo que tiene de especial es que',
    'Hay algo que muy poca gente sabe:', 'Y lo curioso del asunto es que',
    'Por cierto, algo que llama la atención:'
  ]
  const closings = [
    `¡Echa un buen vistazo y tómate el tiempo que necesites! Cuando estés listo, seguimos.`,
    `No te vayas sin explorar bien los detalles... Hay mucho que ver aquí. Avisa cuando quieras continuar.`,
    `Quédate un momento, que este sitio lo merece. Sin prisa. Cuando estés listo, nos vamos a la siguiente parada.`,
    `¡Mira bien a tu alrededor! Y cuando quieras, continuamos con lo que viene.`,
    `Bueno, tómate tu tiempo aquí. Hay mucho que absorber. Cuando estés preparado, seguimos adelante.`,
  ]

  let script = imageConfirm + pickPhrase(openings, poi.name) + ' '
  if (mainContent) script += mainContent + ' '
  if (extraContent) {
    const connector = pickPhrase(connectors, poi.name + 'x')
    script += connector + ' '
    script += extraContent.charAt(0).toLowerCase() + extraContent.slice(1) + ' '
  }
  if (tip) script += `Y un consejo de quien conoce este sitio: ${tip} `
  script += pickPhrase(closings, poi.name + 'z')
  return script
}
