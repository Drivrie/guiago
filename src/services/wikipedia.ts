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

export function generateAudioScript(poi: { name: string; category: string; description?: string }, lang: Language): string {
  const desc = poi.description || ''

  if (lang === 'en') {
    let script = `Welcome to ${poi.name}. `
    if (poi.category) script += `This is a ${poi.category}. `
    if (desc) {
      // Take first 2-3 sentences for audio
      const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 20).slice(0, 3)
      script += sentences.join('. ') + '. '
    }
    script += `Take your time to explore and enjoy this wonderful place!`
    return script
  }

  // Spanish (default)
  let script = `Bienvenido a ${poi.name}. `
  if (poi.category) script += `Este es un ${poi.category}. `
  if (desc) {
    const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 20).slice(0, 3)
    script += sentences.join('. ') + '. '
  }
  script += `¡Tómate tu tiempo para explorar y disfrutar de este lugar tan especial!`
  return script
}
