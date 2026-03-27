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

// Generate a brief audio announcement when starting to walk to next POI
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

    let script = pickPhrase(openings, poi.name) + ' '
    if (mainContent) script += mainContent + ' '
    if (extraContent) script += pickPhrase(connectors, poi.name + 'x') + ' ' + extraContent.charAt(0).toLowerCase() + extraContent.slice(1) + ' '
    script += pickPhrase(closings, poi.name + 'z')
    return script
  }

  // Spanish — conversational, informal, warm tone, with natural pauses via commas and ellipsis
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

  let script = pickPhrase(openings, poi.name) + ' '
  if (mainContent) script += mainContent + ' '
  if (extraContent) {
    const connector = pickPhrase(connectors, poi.name + 'x')
    script += connector + ' '
    script += extraContent.charAt(0).toLowerCase() + extraContent.slice(1) + ' '
  }
  script += pickPhrase(closings, poi.name + 'z')
  return script
}
