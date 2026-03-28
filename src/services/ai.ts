import type { RouteType, Language } from '../types'

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Pollinations.ai — free, no account, no key, CORS-enabled, always available
// Uses GPT-4o-mini under the hood. private:true prevents public feed exposure.
const POLLINATIONS_API = 'https://text.pollinations.ai/'

// Mistral AI — optional user-provided key for higher limits / reliability
const MISTRAL_API = 'https://api.mistral.ai/v1/chat/completions'
const MISTRAL_MODEL = 'open-mistral-nemo'

// ---------------------------------------------------------------------------
// Key helpers (AI is always available via Pollinations — key is just an upgrade)
// ---------------------------------------------------------------------------

/** AI is always available (Pollinations needs no key). Returns true always. */
export function hasAIKey(_userKey: string): boolean { return true }

/** Returns user's optional Mistral key (empty = use Pollinations) */
export function getAIKey(userKey: string): string { return userKey?.trim() || '' }

/** AI is always built-in via Pollinations */
export function hasBuiltInKey(): boolean { return true }

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface AIGeneratedPOI {
  name: string
  category: string
  reason: string
  insiderTip?: string | null
}

export interface AIRouteResult {
  routeStory: string
  suggestedPOIs: AIGeneratedPOI[]
}

// ---------------------------------------------------------------------------
// Route type descriptions
// ---------------------------------------------------------------------------

const ROUTE_TYPE_DESC: Record<RouteType, { es: string; en: string }> = {
  imprescindibles: {
    es: 'los lugares absolutamente imprescindibles y más emblemáticos que todo visitante debe ver antes de irse',
    en: 'the absolute must-see highlights and most iconic places every visitor should experience before leaving',
  },
  secretos_locales: {
    es: 'lugares secretos, rincones ocultos y joyas escondidas que los turistas raramente descubren pero que los locales adoran',
    en: 'hidden gems, secret spots and authentic places tourists rarely discover but locals love',
  },
  monumental: {
    es: 'monumentos históricos, edificios emblemáticos y grandes obras del patrimonio arquitectónico',
    en: 'historic monuments, iconic buildings and great works of architectural heritage',
  },
  historia_negra: {
    es: 'historia oscura, misterios, tragedias, ejecuciones, leyendas oscuras y episodios olvidados',
    en: 'dark history, mysteries, tragedies, executions, dark legends and forgotten episodes',
  },
  curiosidades: {
    es: 'curiosidades insólitas, datos sorprendentes, lugares peculiares e historias desconocidas',
    en: 'unusual curiosities, surprising facts, peculiar places and unknown stories',
  },
  gastronomia: {
    es: 'gastronomía local auténtica, mercados emblemáticos, bares de tapas clásicos y cultura culinaria',
    en: 'authentic local gastronomy, iconic markets, classic tapas bars and culinary culture',
  },
  arquitectura: {
    es: 'arquitectura destacada de distintas épocas, estilos y escuelas: gótico, barroco, modernismo, contemporáneo',
    en: 'remarkable architecture from different eras and styles: Gothic, Baroque, Modernism, contemporary',
  },
  naturaleza: {
    es: 'parques, jardines históricos, espacios naturales y entornos verdes urbanos de especial belleza',
    en: 'parks, historic gardens, natural spaces and beautiful urban green environments',
  },
}

// ---------------------------------------------------------------------------
// Internal callers
// ---------------------------------------------------------------------------

async function callPollinations(system: string, user: string): Promise<string> {
  const resp = await fetch(POLLINATIONS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      model: 'openai',
      seed: Math.floor(Math.random() * 9999),
      private: true,   // don't appear in pollinations public feed
    }),
  })
  if (!resp.ok) throw new Error(`Pollinations ${resp.status}`)
  return resp.text()   // Pollinations returns plain text, not a JSON envelope
}

async function callMistral(
  system: string,
  user: string,
  apiKey: string,
  maxTokens = 1200
): Promise<string> {
  const resp = await fetch(MISTRAL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message || `HTTP ${resp.status}`)
  }
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content?.trim() || ''
}

/**
 * Calls AI: uses user's Mistral key if provided (higher limits), otherwise
 * falls back to Pollinations (free, no key, always available).
 */
async function callAI(system: string, user: string, userKey: string, maxTokens = 1200): Promise<string> {
  if (userKey) {
    try {
      return await callMistral(system, user, userKey, maxTokens)
    } catch (err) {
      console.warn('Mistral failed, falling back to Pollinations:', err)
    }
  }
  return callPollinations(system, user)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate a Civitatis-quality curated route with AI */
export async function generateAIRoute(
  cityName: string,
  routeType: RouteType,
  durationMinutes: number,
  lang: Language,
  userKey: string,
  excludeNames: string[] = []
): Promise<AIRouteResult | null> {
  const maxPOIs = Math.max(3, Math.min(12, Math.floor(durationMinutes / 20)))
  const typeDesc = ROUTE_TYPE_DESC[routeType][lang]
  const excludeClause =
    excludeNames.length > 0
      ? lang === 'es'
        ? `\nIMPORTANTE: El usuario ya ha visitado estos lugares, exclúyelos completamente: ${excludeNames.slice(0, 15).join(', ')}.`
        : `\nIMPORTANT: The user already visited these places, exclude them completely: ${excludeNames.slice(0, 15).join(', ')}.`
      : ''

  const system =
    lang === 'es'
      ? `Eres un guía turístico profesional de élite, del nivel de los mejores guías de Civitatis o Walkative. Conoces en profundidad la historia, cultura, arquitectura y secretos de todas las ciudades del mundo. Creas rutas turísticas memorables, coherentes y narrativas. Siempre respondes exclusivamente con JSON válido, sin texto adicional, sin markdown.`
      : `You are an elite professional tour guide, on par with the best guides from Civitatis or Walkative. You deeply know the history, culture, architecture and secrets of cities worldwide. You create memorable, coherent and narrative tours. Always respond exclusively with valid JSON, no additional text, no markdown.`

  const user =
    lang === 'es'
      ? `Diseña una ruta turística de calidad profesional para ${cityName}:
- Temática: ${typeDesc}
- Duración total: ${durationMinutes} minutos de visita
- Número de paradas: ${maxPOIs}${excludeClause}

La ruta debe ser como las de Civitatis: coherente temáticamente, con un hilo narrativo claro, lugares reales y verificables.

JSON exacto a devolver (sin texto fuera del JSON):
{
  "routeStory": "Descripción evocadora de la ruta en 2-3 frases",
  "suggestedPOIs": [
    {
      "name": "Nombre oficial completo y exacto del lugar",
      "category": "categoría (catedral/museo/plaza/palacio/jardín/etc)",
      "reason": "Por qué es imprescindible: historia o dato en 1-2 frases",
      "insiderTip": "Consejo práctico no habitual en guías (string o null)"
    }
  ]
}`
      : `Design a professional-quality tour for ${cityName}:
- Theme: ${typeDesc}
- Total duration: ${durationMinutes} minutes
- Number of stops: ${maxPOIs}${excludeClause}

Like Civitatis: thematically coherent, clear narrative thread, real verifiable places.

Exact JSON to return (no text outside the JSON):
{
  "routeStory": "Evocative route description in 2-3 sentences",
  "suggestedPOIs": [
    {
      "name": "Official full exact name of the place",
      "category": "exact category (cathedral/museum/square/palace/garden/etc)",
      "reason": "Why it's essential: key history or fact in 1-2 sentences",
      "insiderTip": "Practical tip not usually in tourist guides (string or null)"
    }
  ]
}`

  try {
    const text = await callAI(system, user, getAIKey(userKey), 1500)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0]) as AIRouteResult
  } catch (err) {
    console.error('AI route generation error:', err)
    return null
  }
}

/** Generate a professional audio narration for a POI (Civitatis style) */
export async function generateAIAudioScript(
  poiName: string,
  category: string,
  wikiDescription: string,
  reason: string,
  insiderTip: string | null | undefined,
  lang: Language,
  userKey: string
): Promise<string | null> {
  const system =
    lang === 'es'
      ? `Eres un guía turístico profesional apasionado, al estilo de Civitatis. Tu voz es cálida, cercana y entusiasta. Hablas en español de España con "tú". No lees datos: compartes tu amor por el lugar. Usas pausas naturales con comas, puntos y frases cortas.`
      : `You are a passionate professional tour guide, Civitatis style. Your voice is warm and enthusiastic. You share love for the place, not just facts. Use natural pauses with commas, periods and short sentences.`

  const user =
    lang === 'es'
      ? `Genera la narración de audio al llegar a "${poiName}" (${category}).

${wikiDescription ? `Descripción: ${wikiDescription.slice(0, 400)}` : ''}
${reason ? `Por qué es especial: ${reason}` : ''}
${insiderTip ? `Dato insider: ${insiderTip}` : ''}

Narración de 180-230 palabras: abre con bienvenida natural, 2-3 datos fascinantes conversacionales, si hay insider tip añádelo con "Poca gente sabe que...", termina con "Cuando estés listo/a, seguimos...". SOLO la narración, sin comillas ni encabezados.`
      : `Generate audio narration arriving at "${poiName}" (${category}).

${wikiDescription ? `Description: ${wikiDescription.slice(0, 400)}` : ''}
${reason ? `Why special: ${reason}` : ''}
${insiderTip ? `Insider tip: ${insiderTip}` : ''}

180-230 word narration: natural welcome, 2-3 conversational facts, if insider tip add "Not many people know that...", end with "Whenever you're ready, we'll move on...". ONLY the narration, no quotes or headings.`

  try {
    return await callAI(system, user, getAIKey(userKey), 600)
  } catch (err) {
    console.error('AI audio script error:', err)
    return null
  }
}

/** Validate a user-provided Mistral API key */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  const key = apiKey?.trim()
  if (!key) return false
  try {
    const resp = await fetch(MISTRAL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: MISTRAL_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    return resp.ok
  } catch {
    return false
  }
}
