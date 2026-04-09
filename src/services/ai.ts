import type { RouteType, Language } from '../types'
import { getActiveLocalModel, isLocalModelLoaded, callLocalModel } from './localAI'

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Pollinations.ai — free, no account, no key, CORS-enabled, always available
const POLLINATIONS_API = 'https://text.pollinations.ai/'

// Mistral AI — optional key for higher quality / limits
const MISTRAL_API = 'https://api.mistral.ai/v1/chat/completions'
const MISTRAL_MODEL = 'open-mistral-nemo'

// Built-in Mistral key from build-time env var (set in GitHub Secrets as VITE_MISTRAL_KEY)
const BUILT_IN_MISTRAL_KEY = (import.meta.env.VITE_MISTRAL_KEY as string | undefined) || ''

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/** AI is always available (Pollinations needs no key). Returns true always. */
export function hasAIKey(_userKey: string): boolean { return true }

/** Resolves effective key: user key → built-in env key → '' (Pollinations) */
export function getAIKey(userKey: string): string { return userKey?.trim() || BUILT_IN_MISTRAL_KEY }

/** Whether a built-in Mistral key is baked in via VITE_MISTRAL_KEY */
export function hasBuiltInKey(): boolean { return !!BUILT_IN_MISTRAL_KEY }

/** Which AI engine is active given a userKey */
export function activeEngine(userKey: string): 'local' | 'mistral_user' | 'mistral_builtin' | 'pollinations' {
  if (getActiveLocalModel() && isLocalModelLoaded()) return 'local'
  if (userKey?.trim()) return 'mistral_user'
  if (BUILT_IN_MISTRAL_KEY) return 'mistral_builtin'
  return 'pollinations'
}

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
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`AI request timed out after ${ms}ms`)), ms)
    ),
  ])
}

// ---------------------------------------------------------------------------
// Internal callers
// ---------------------------------------------------------------------------

async function callPollinations(system: string, user: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
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
      private: true,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))
  if (!resp.ok) throw new Error(`Pollinations ${resp.status}`)
  return resp.text()
}

async function callMistral(
  system: string,
  user: string,
  apiKey: string,
  maxTokens = 1200
): Promise<string> {
  const resp = await withTimeout(
    fetch(MISTRAL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        max_tokens: maxTokens,
        temperature: 0.75,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    }),
    20000
  )
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message || `HTTP ${resp.status}`)
  }
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content?.trim() || ''
}

/**
 * Calls AI: local model (offline) → user key → built-in Mistral key → Pollinations fallback.
 */
async function callAI(system: string, user: string, userKey: string, maxTokens = 1200): Promise<string> {
  // 1. Try on-device local model first (works fully offline)
  if (getActiveLocalModel() && isLocalModelLoaded()) {
    try {
      return await callLocalModel(system, user, maxTokens)
    } catch (err) {
      console.warn('[AI] Local model failed, falling back to online:', err)
    }
  }
  // 2. Online path: user key or built-in Mistral key
  const effectiveKey = userKey || BUILT_IN_MISTRAL_KEY
  if (effectiveKey) {
    try {
      return await callMistral(system, user, effectiveKey, maxTokens)
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
  // More POIs: 1 per 15 min, min 5, max 15
  const maxPOIs = Math.max(5, Math.min(15, Math.floor(durationMinutes / 15)))
  const typeDesc = ROUTE_TYPE_DESC[routeType][lang]
  const excludeClause =
    excludeNames.length > 0
      ? lang === 'es'
        ? `\nIMPORTANTE: El usuario ya ha visitado estos lugares — exclúyelos completamente: ${excludeNames.slice(0, 15).join(', ')}.`
        : `\nIMPORTANT: The user already visited these places — exclude them completely: ${excludeNames.slice(0, 15).join(', ')}.`
      : ''

  const system =
    lang === 'es'
      ? `Eres un guía turístico profesional de élite, del nivel de los mejores guías de Civitatis o Walkative. Conoces en profundidad la historia, cultura, arquitectura y secretos de todas las ciudades del mundo. Creas rutas turísticas memorables, coherentes y narrativas. Diseñas rutas ÁGILES: paradas próximas entre sí (máximo 600-800m entre paradas consecutivas) para que la ruta sea fluida y disfrutable. Siempre respondes exclusivamente con JSON válido, sin texto adicional, sin markdown.`
      : `You are an elite professional tour guide, on par with the best guides from Civitatis or Walkative. You deeply know the history, culture, architecture and secrets of cities worldwide. You create memorable, coherent and narrative tours. You design AGILE routes: stops close to each other (max 600-800m between consecutive stops) for a smooth, enjoyable walk. Always respond exclusively with valid JSON, no additional text, no markdown.`

  const user =
    lang === 'es'
      ? `Diseña una ruta turística de MÁXIMA CALIDAD para ${cityName}:
- Temática: ${typeDesc}
- Duración total de visita: ${durationMinutes} minutos (sin contar desplazamientos)
- Número de paradas: ${maxPOIs}${excludeClause}

REQUISITOS ESTRICTOS (al nivel de Civitatis o Walkative):
1. TODOS los lugares deben estar físicamente EN ${cityName}, no en pueblos ni ciudades cercanas
2. Distancia máxima entre paradas consecutivas: 600-800 metros a pie
3. Orden geográfico óptimo para caminar sin rodeos — ruta circular o lineal lógica
4. Coherencia temática perfecta — cada parada refuerza el hilo narrativo
5. Información histórica específica y verificable, no genérica
6. Consejos insider reales: horarios óptimos, entradas, trucos locales, qué evitar

JSON exacto (sin texto fuera del JSON):
{
  "routeStory": "Narrativa de apertura evocadora en 2-3 frases: describe la atmósfera, el hilo conductor y por qué esta ruta es especial. Estilo literario, apasionado, que invite a explorar.",
  "suggestedPOIs": [
    {
      "name": "Nombre oficial completo y exacto del lugar en ${cityName}",
      "category": "categoría precisa (catedral/museo/plaza/palacio/jardín/mercado/barrio/iglesia/etc)",
      "reason": "Por qué es imprescindible en esta ruta: 1-2 datos históricos o culturales fascinantes y específicos",
      "insiderTip": "Consejo práctico y concreto: hora mejor para visitar, entrada gratuita, detalle que pocos conocen, qué pedir, dónde sentarse. null si no hay nada relevante."
    }
  ]
}`
      : `Design a MAXIMUM QUALITY tour for ${cityName}:
- Theme: ${typeDesc}
- Total visit duration: ${durationMinutes} minutes (excluding walking)
- Number of stops: ${maxPOIs}${excludeClause}

STRICT REQUIREMENTS (Civitatis / Walkative level):
1. ALL places must be physically IN ${cityName} — not nearby towns or cities
2. Max walking distance between consecutive stops: 600-800 meters
3. Optimal geographic order — no unnecessary backtracking, logical circular or linear route
4. Perfect thematic coherence — every stop reinforces the narrative thread
5. Specific, verifiable historical information — not generic descriptions
6. Real insider tips: optimal visit times, tickets, local tricks, what to avoid

Exact JSON (no text outside JSON):
{
  "routeStory": "Evocative opening narrative in 2-3 sentences: describe the atmosphere, the connecting thread, why this route is special. Literary, passionate style that invites exploration.",
  "suggestedPOIs": [
    {
      "name": "Official full exact name of the place in ${cityName}",
      "category": "precise category (cathedral/museum/square/palace/garden/market/neighborhood/church/etc)",
      "reason": "Why it's essential on this route: 1-2 fascinating, specific historical or cultural facts",
      "insiderTip": "Practical, concrete tip: best time to visit, free entry, detail few people know, what to order, where to sit. null if nothing relevant."
    }
  ]
}`

  try {
    const text = await callAI(system, user, getAIKey(userKey), 1800)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const result = JSON.parse(jsonMatch[0]) as AIRouteResult
    // Basic validation
    if (!result.suggestedPOIs || !Array.isArray(result.suggestedPOIs)) return null
    return result
  } catch (err) {
    console.error('AI route generation error:', err)
    return null
  }
}

/** Generate a natural, conversational audio narration for a POI (live tour guide style) */
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
      ? `Eres un guía turístico apasionado y carismático, como los mejores guías de Civitatis o Rick Steves en español. Tu estilo de narración es completamente CONVERSACIONAL y VIVO:
- Hablas directamente al visitante: "Fíjate en...", "Levanta la vista y verás...", "¿Sabes lo que pasó aquí?"
- Usas preguntas retóricas para crear suspense: "¿Te imaginas lo que fue...?"
- Das datos concretos y sorprendentes con entusiasmo, no como un libro de texto
- Tienes sentido del humor y cariño por los lugares
- Usas frases cortas y pausas dramáticas con puntos y comas
- Tuteas siempre, en español de España
- Nunca suenas como Wikipedia — suenas como alguien que ama este lugar`
      : `You are a passionate and charismatic tour guide, like the best Civitatis or Rick Steves guides. Your narration style is completely CONVERSATIONAL and LIVELY:
- Address the visitor directly: "Look at...", "Raise your eyes and you'll see...", "Do you know what happened here?"
- Use rhetorical questions to build suspense: "Can you imagine what it was like...?"
- Share concrete, surprising facts with enthusiasm, not like a textbook
- You have warmth and humor
- Short sentences and dramatic pauses with periods and commas
- Never sound like Wikipedia — sound like someone who loves this place`

  const user =
    lang === 'es'
      ? `Genera la narración de audio AL LLEGAR a "${poiName}" (${category}).

${wikiDescription ? `Contexto histórico: ${wikiDescription.slice(0, 350)}` : ''}
${reason ? `Por qué es especial: ${reason}` : ''}
${insiderTip ? `Dato insider: ${insiderTip}` : ''}

ESTRUCTURA OBLIGATORIA:
1. Abre con algo que capture atención AL INSTANTE: una pregunta sorprendente, una imagen vívida, o un dato impactante. NO empieces con "Bienvenido" ni "Aquí estamos".
2. Cuenta 1-2 datos fascinantes y concretos de forma conversacional, como si se los contaras a un amigo
3. Si hay insider tip, preséntalo como un secreto exclusivo: "Poca gente lo sabe, pero..."
4. Cierra con algo que invite a disfrutar el momento: "Tómate un minuto para...", "Antes de seguir, mira hacia..."

120-160 palabras. SOLO la narración, sin comillas, sin títulos, sin guiones. Voz viva, apasionada, personal.`
      : `Generate audio narration ARRIVING AT "${poiName}" (${category}).

${wikiDescription ? `Historical context: ${wikiDescription.slice(0, 350)}` : ''}
${reason ? `Why it's special: ${reason}` : ''}
${insiderTip ? `Insider tip: ${insiderTip}` : ''}

REQUIRED STRUCTURE:
1. Open with something that grabs attention INSTANTLY: a surprising question, a vivid image, or a shocking fact. Do NOT start with "Welcome" or "Here we are".
2. Share 1-2 fascinating, concrete facts conversationally, as if telling a friend
3. If there's an insider tip, present it as an exclusive secret: "Not many people know that..."
4. Close with something that invites them to enjoy the moment: "Take a minute to...", "Before we move on, look towards..."

120-160 words. ONLY the narration, no quotes, no titles, no dashes. Lively, passionate, personal voice.`

  try {
    return await callAI(system, user, getAIKey(userKey), 500)
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
    const resp = await withTimeout(
      fetch(MISTRAL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: MISTRAL_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
      }),
      10000
    )
    return resp.ok
  } catch {
    return false
  }
}
