import type { WikiResult, Language } from '../types'

const WIKI_API = {
  es: 'https://es.wikipedia.org/w/api.php',
  en: 'https://en.wikipedia.org/w/api.php'
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

export async function getPOIDescription(name: string, lang: Language = 'es'): Promise<string> {
  try {
    const result = await getPOIInfo(name, lang)
    if (result?.extract) {
      return result.extract
    }

    // Fallback: generate a generic description
    return generateFallbackDescription(name, lang)
  } catch (error) {
    console.error('Error getting POI description:', error)
    return generateFallbackDescription(name, lang)
  }
}

export async function getPOIInfo(name: string, lang: Language = 'es'): Promise<WikiResult | null> {
  try {
    const base = WIKI_API[lang]

    // First try direct title lookup
    const directParams = new URLSearchParams({
      action: 'query',
      titles: name,
      prop: 'extracts|pageimages',
      exintro: 'true',
      exchars: '1500',
      pithumbsize: '600',
      format: 'json',
      origin: '*'
    })

    const directResponse = await fetch(`${base}?${directParams}`)
    if (directResponse.ok) {
      const data: WikiApiResponse = await directResponse.json()
      const pages = data?.query?.pages
      if (pages) {
        const page = Object.values(pages)[0]
        if (page && page.pageid && !page.missing) {
          return {
            pageid: page.pageid,
            title: page.title!,
            extract: cleanWikiExtract(page.extract || ''),
            imageUrl: page.thumbnail?.source,
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title!.replace(/ /g, '_'))}`
          }
        }
      }
    }

    // If direct lookup fails, do a search
    return await searchArticle(name, lang)
  } catch (error) {
    console.error('Error getting POI info:', error)
    return null
  }
}

export async function getCityDescription(cityName: string, lang: Language = 'es'): Promise<WikiResult | null> {
  return getPOIInfo(cityName, lang)
}

function cleanWikiExtract(extract: string): string {
  if (!extract) return ''

  // Remove HTML tags
  let cleaned = extract.replace(/<[^>]+>/g, '')

  // Fix HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')

  // Remove multiple spaces and newlines
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  // Remove very short extracts
  if (cleaned.length < 50) return ''

  return cleaned
}

function generateFallbackDescription(name: string, lang: Language): string {
  if (lang === 'en') {
    return `${name} is a notable point of interest in this area. Visit to discover its history and significance.`
  }
  return `${name} es un punto de interés destacado en esta zona. Visítalo para descubrir su historia y significado.`
}

// Pick a phrase deterministically based on name (so same POI always gets same intro)
function pickPhrase(arr: string[], name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return arr[hash % arr.length]
}

export function generateAudioScript(
  poi: { name: string; category: string; description?: string },
  lang: Language
): string {
  const desc = poi.description || ''

  // Extract meaningful sentences (skip very short ones)
  const sentences = desc
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 30)

  const mainContent = sentences.slice(0, 3).join(' ')
  const extraContent = sentences.slice(3, 5).join(' ')

  if (lang === 'en') {
    const openings = [
      `Right, you've made it! In front of you is ${poi.name}.`,
      `Here we are at ${poi.name}. Pay attention, this place has a great story.`,
      `Welcome! You've just arrived at ${poi.name}, and trust me, it's worth it.`,
      `This is ${poi.name}. One of the most interesting stops on our route.`,
    ]
    const connectors = ['Did you know that', 'Interestingly,', 'Worth mentioning:', 'Fun fact:']
    const closings = [
      `Take a moment to look around before we move on!`,
      `Have a good look — there's a lot to take in here.`,
      `Don't rush — this one deserves your full attention.`,
    ]

    let script = pickPhrase(openings, poi.name) + ' '
    if (mainContent) script += mainContent + ' '
    if (extraContent) script += pickPhrase(connectors, poi.name + 'x') + ' ' + extraContent + ' '
    script += pickPhrase(closings, poi.name + 'z')
    return script
  }

  // Spanish — conversational, informal, warm tone
  const openings = [
    `¡Pues ya estás aquí! Tienes delante ${poi.name}.`,
    `¡Perfecto, has llegado! Esto que ves es ${poi.name}, y tiene mucha historia.`,
    `Bien, este es el sitio. Estás en ${poi.name}. Préstale atención porque merece la pena.`,
    `¡Aquí está! Bienvenido a ${poi.name}. Uno de los lugares más especiales de esta ruta.`,
    `Ya estás en ${poi.name}. Y mira que hay cosas interesantes que contarte de aquí.`,
  ]
  const connectors = [
    '¿Sabías que', 'Por cierto,', 'Lo curioso del asunto es que',
    'Hay algo que llama la atención:', 'Un dato que pocos conocen:'
  ]
  const closings = [
    `¡Echa un buen vistazo y tómate el tiempo que necesites antes de seguir!`,
    `No te vayas sin explorar bien los detalles. ¡Hay mucho que ver aquí!`,
    `Quédate un momento, que este sitio lo merece. Cuando estés listo, seguimos.`,
    `¡Mira bien a tu alrededor! Y cuando quieras, continuamos con la siguiente parada.`,
  ]

  let script = pickPhrase(openings, poi.name) + ' '
  if (mainContent) script += mainContent + ' '
  if (extraContent) {
    script += pickPhrase(connectors, poi.name + 'x') + ' '
    // Remove leading "que" issues if connector ends mid-sentence
    script += extraContent.charAt(0).toLowerCase() + extraContent.slice(1) + ' '
  }
  script += pickPhrase(closings, poi.name + 'z')
  return script
}
