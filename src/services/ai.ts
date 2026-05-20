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
  countryName: string,
  routeType: RouteType,
  durationMinutes: number,
  lang: Language,
  userKey: string,
  excludeNames: string[] = []
): Promise<AIRouteResult | null> {
  // Target: ~1 POI per 12 min of visit time, min 6, max 14
  // 60 min → 5, 120 min → 10, 180 min → 13, 240 min → 14
  const maxPOIs = Math.max(6, Math.min(14, Math.round(durationMinutes / 12)))
  const typeDesc = ROUTE_TYPE_DESC[routeType][lang]
  // Always use "CityName, Country" to avoid ambiguity (e.g. Roma Poland vs Roma Italy)
  const locationDesc = countryName ? `${cityName}, ${countryName}` : cityName
  const excludeClause =
    excludeNames.length > 0
      ? lang === 'es'
        ? `\nIMPORTANTE: El usuario ya ha visitado estos lugares — exclúyelos completamente: ${excludeNames.slice(0, 15).join(', ')}.`
        : `\nIMPORTANT: The user already visited these places — exclude them completely: ${excludeNames.slice(0, 15).join(', ')}.`
      : ''

  const system =
    lang === 'es'
      ? `Eres un guía turístico profesional de élite, al nivel de los autores de Lonely Planet, National Geographic Traveler y los guías presenciales de Civitatis y Walkative. Conoces en profundidad la historia, cultura, arquitectura y anécdotas de cada ciudad del mundo. Diseñas rutas memorables, coherentes y narrativas, con paradas próximas entre sí (máximo 600-800m) para que sea fluida y disfrutable a pie. Siempre respondes EXCLUSIVAMENTE con JSON válido — sin texto adicional, sin markdown, sin comentarios.`
      : `You are an elite professional tour guide, on par with Lonely Planet and National Geographic Traveler authors and the in-person guides at Civitatis and Walkative. You deeply know the history, culture, architecture and anecdotes of every city in the world. You design memorable, coherent and narrative tours with stops close together (max 600-800m) so they flow smoothly on foot. You always respond EXCLUSIVELY with valid JSON — no additional text, no markdown, no comments.`

  const user =
    lang === 'es'
      ? `Diseña una ruta turística de NIVEL LONELY PLANET / NATIONAL GEOGRAPHIC para ${locationDesc}:
- Temática: ${typeDesc}
- Duración total de visita: ${durationMinutes} minutos (sin contar desplazamientos)
- Número de paradas: ${maxPOIs}${excludeClause}

REGLA Nº 1 — RELEVANCIA REAL:
${routeType === 'secretos_locales'
  ? 'Selecciona joyas locales auténticas — sitios que un guía local llevaría a un amigo, no las trampas turísticas evidentes. PROHIBIDO usar los top-3 más obvios de la ciudad.'
  : `Selecciona los lugares MÁS ICÓNICOS Y MUNDIALMENTE RECONOCIBLES de ${locationDesc}, ordenados estrictamente por fama internacional y relevancia turística — los que aparecerían en la portada de una guía Lonely Planet o National Geographic. NUNCA elijas un lugar de segunda fila si hay un equivalente más emblemático sin visitar. La parada nº 1 debe ser EL símbolo de la ciudad.`}

REQUISITOS ESTRICTOS:
1. TODOS los lugares deben estar FÍSICAMENTE en ${locationDesc} — no en otras ciudades, regiones ni países. Si dudas, NO lo incluyas.
2. Usa los nombres OFICIALES exactamente como aparecen en Wikipedia (idioma local del país o inglés reconocible). Ejemplos: "Wawel Royal Castle" no "Castillo Wawel"; "Catedral de Burgos" no "Cathedral of Burgos".
3. Distancia máxima entre paradas consecutivas: 600-800 metros a pie. Si dos POIs están más lejos, sustituye uno por algo más cercano que mantenga la coherencia.
4. Orden geográfico óptimo — ruta circular o lineal lógica, SIN cruces ni zigzags. La parada nº 1 cerca de un acceso natural (estación, plaza principal) y la última cerca de un buen sitio para acabar.
5. Coherencia temática perfecta — cada parada refuerza el hilo narrativo de la ruta.
6. Información histórica ESPECÍFICA y verificable: fechas concretas, nombres de protagonistas, eventos reales. Nada de descripciones genéricas.
7. Insider tips REALES: hora óptima, taquilla, qué pedir, dónde sentarse, qué evitar. Si no conoces algo verificable para ese sitio, devuelve null — NO inventes.

JSON exacto (sin texto fuera del JSON):
{
  "routeStory": "Narrativa de apertura evocadora en 2-3 frases: atmósfera, hilo conductor, por qué esta ruta merece la pena hoy. Estilo Lonely Planet — literario pero directo, apasionado, que invite a salir ya.",
  "suggestedPOIs": [
    {
      "name": "Nombre oficial completo en ${locationDesc} tal como aparece en Wikipedia (idioma local o inglés)",
      "category": "categoría precisa (catedral/museo/plaza/palacio/jardín/mercado/barrio/iglesia/etc)",
      "reason": "Por qué este lugar concreto en esta posición de la ruta: 1-2 datos históricos o culturales específicos y memorables",
      "insiderTip": "Consejo práctico verificable: mejor hora, entrada gratuita, detalle que pocos notan, qué pedir, mejor punto fotográfico. null si no hay nada relevante o no estás seguro."
    }
  ]
}`
      : `Design a LONELY PLANET / NATIONAL GEOGRAPHIC level tour for ${locationDesc}:
- Theme: ${typeDesc}
- Total visit duration: ${durationMinutes} minutes (excluding walking)
- Number of stops: ${maxPOIs}${excludeClause}

RULE Nº 1 — REAL RELEVANCE:
${routeType === 'secretos_locales'
  ? 'Pick authentic local gems — places a local guide would take a friend, not the obvious tourist traps. DO NOT use the city\'s most obvious top-3 sites.'
  : `Pick the MOST ICONIC AND WORLDWIDE RECOGNISABLE places in ${locationDesc}, strictly ranked by international fame and touristic relevance — the ones that would appear on a Lonely Planet or National Geographic cover. NEVER pick a second-tier place when a more emblematic equivalent has not been visited. Stop #1 must be THE symbol of the city.`}

STRICT REQUIREMENTS:
1. ALL places must be PHYSICALLY in ${locationDesc} — not in other cities, regions or countries. If unsure, leave it out.
2. Use OFFICIAL names exactly as they appear on Wikipedia (local language or widely recognised English). Examples: "Wawel Royal Castle" not "Castillo Wawel"; "Burgos Cathedral" not "Catedral de Burgos".
3. Maximum distance between consecutive stops: 600-800 metres on foot. If two POIs are further, replace one with something closer that fits the theme.
4. Optimal geographic order — circular or linear logical route, NO crossings or zigzags. Stop #1 near a natural entry point (station, main square); last stop near a good place to end.
5. Perfect thematic coherence — every stop reinforces the route's narrative thread.
6. SPECIFIC, verifiable historical information: concrete dates, protagonist names, real events. No generic descriptions.
7. REAL insider tips: optimal time, ticket booth, what to order, where to sit, what to avoid. If you don't know something verifiable for that site, return null — DO NOT invent.

Exact JSON (no text outside the JSON):
{
  "routeStory": "Evocative opening narrative in 2-3 sentences: atmosphere, connecting thread, why this route is worth doing today. Lonely Planet style — literary but direct, passionate, inviting the reader to step out now.",
  "suggestedPOIs": [
    {
      "name": "Official full name in ${locationDesc} as it appears on Wikipedia (local language or English)",
      "category": "precise category (cathedral/museum/square/palace/garden/market/neighborhood/church/etc)",
      "reason": "Why this specific place at this position in the route: 1-2 specific, memorable historical or cultural facts",
      "insiderTip": "Verifiable practical tip: best time, free entry, detail few notice, what to order, best photo spot. null if nothing relevant or unsure."
    }
  ]
}`

  try {
    const text = await callAI(system, user, getAIKey(userKey), 2800)
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

${wikiDescription ? `Contexto histórico verificado (úsalo para extraer fechas, nombres, eventos):\n${wikiDescription.slice(0, 1200)}` : ''}
${reason ? `\nPor qué es especial en esta ruta: ${reason}` : ''}
${insiderTip ? `\nDato insider verificado: ${insiderTip}` : ''}

ESTRUCTURA OBLIGATORIA (siete bloques cortos, en este orden):
0. CONFIRMACIÓN VISUAL (1-2 frases): "Mira la imagen en tu pantalla — ¿ves [descripción breve y reconocible de lo que aparece]? Eso es ${poiName}, comprueba que lo tienes delante."
1. HOOK INMEDIATO (1-2 frases): una pregunta sorprendente, una imagen vívida o un dato impactante que enganche al instante. NUNCA "Bienvenido" o "Aquí estamos".
2. HISTORIA CON DATOS (2-3 frases): 2-3 hechos históricos CONCRETOS extraídos del contexto — fechas, nombres de protagonistas, eventos reales. Estilo "te lo cuento como a un amigo", no enciclopédico.
3. DATO CURIOSO O ANÉCDOTA (1-2 frases): algo memorable, sorprendente o poco conocido — una leyenda, una rareza arquitectónica, una historia humana. Lo que la gente recuerda al volver del viaje.
4. SIGNIFICADO CULTURAL (1 frase): por qué este lugar importa hoy — qué representa para la ciudad, qué simboliza, qué cambió.
5. INSIDER TIP (1 frase): si hay tip verificado, preséntalo como secreto: "Poca gente sabe que..." o "Mi consejo: ...". Si no hay tip fiable, omite este bloque.
6. CIERRE INVITANTE (1 frase): "Tómate un minuto para...", "Antes de seguir, fíjate en...", "Acércate y observa..."

LONGITUD: 220-300 palabras. Voz viva, apasionada, en español de España, tuteo. Estilo Lonely Planet / Civitatis presencial. SOLO la narración, sin comillas, sin títulos, sin guiones, sin viñetas. Si los datos del contexto son escasos, sé conciso pero específico — no rellenes con tópicos.`
      : `Generate audio narration ARRIVING AT "${poiName}" (${category}).

${wikiDescription ? `Verified historical context (use it to extract dates, names, events):\n${wikiDescription.slice(0, 1200)}` : ''}
${reason ? `\nWhy it's special on this route: ${reason}` : ''}
${insiderTip ? `\nVerified insider tip: ${insiderTip}` : ''}

REQUIRED STRUCTURE (seven short blocks, in this order):
0. VISUAL CONFIRMATION (1-2 sentences): "Take a look at the image on your screen — do you see [brief, recognisable description of what's shown]? That's ${poiName}; make sure it's right in front of you."
1. IMMEDIATE HOOK (1-2 sentences): a surprising question, a vivid image or a striking fact. NEVER "Welcome" or "Here we are".
2. STORY WITH FACTS (2-3 sentences): 2-3 CONCRETE historical facts from the context — dates, protagonists' names, real events. "Telling a friend" tone, not encyclopedic.
3. CURIOUS DETAIL OR ANECDOTE (1-2 sentences): something memorable, surprising or little-known — a legend, an architectural quirk, a human story. The thing travellers remember when they get home.
4. CULTURAL SIGNIFICANCE (1 sentence): why this place matters today — what it stands for, what it symbolises, what it changed.
5. INSIDER TIP (1 sentence): if there's a verified tip, present it as a secret: "Few people know that..." or "My tip: ...". If no reliable tip, skip this block.
6. INVITING CLOSE (1 sentence): "Take a minute to...", "Before we move on, look at...", "Step closer and notice..."

LENGTH: 220-300 words. Lively, passionate voice. Lonely Planet / in-person Civitatis style. ONLY the narration, no quotes, no titles, no dashes, no bullets. If the context data is sparse, stay concise but specific — don't pad with clichés.`

  try {
    return await callAI(system, user, getAIKey(userKey), 900)
  } catch (err) {
    console.error('AI audio script error:', err)
    return null
  }
}

/**
 * Generate a conversational POI explanation for the "What to visit today?" search feature.
 * Similar to generateAIAudioScript but tailored for standalone place lookup
 * (the visitor may not be physically there yet — they're discovering or confirming the place).
 * Sources knowledge in the style of Civitatis, Talkative, SmartGuide and Wikivoyage guides.
 */
export async function generateAIPOIExplanation(
  poiName: string,
  cityName: string,
  description: string,
  lang: Language,
  userKey: string
): Promise<string | null> {
  const system =
    lang === 'es'
      ? `Eres un guía turístico experto al estilo de Civitatis, Talkative, SmartGuide o Wikivoyage. Combinas datos históricos fascinantes con consejos prácticos de viajero. Tu voz es cálida, directa y apasionada. Siempre tuteas al visitante. Hablas como alguien que conoce el lugar de primera mano, no como un artículo enciclopédico.`
      : `You are an expert tour guide in the style of Civitatis, Talkative, SmartGuide or Wikivoyage. You combine fascinating historical facts with practical traveler tips. Your voice is warm, direct and passionate. You speak as someone who knows the place first-hand, not like an encyclopedic article.`

  const user =
    lang === 'es'
      ? `Genera una explicación de audio sobre "${poiName}"${cityName ? ` en ${cityName}` : ''}.

${description ? `Información de base verificada (extrae fechas, nombres, eventos):\n${description.slice(0, 1200)}` : ''}

ESTRUCTURA OBLIGATORIA (seis bloques cortos):
0. CONFIRMACIÓN VISUAL (1-2 frases): "Mira la imagen en pantalla — ¿ves [descripción visual breve y reconocible]? Eso es ${poiName}."
1. HOOK INMEDIATO (1 frase): pregunta sorprendente, imagen vívida o dato impactante que enganche al instante.
2. HISTORIA CON DATOS (2-3 frases): 2-3 hechos concretos extraídos de la información de base — fechas, protagonistas, eventos reales. NO genéricos.
3. ANÉCDOTA O CURIOSIDAD (1-2 frases): leyenda, detalle arquitectónico, historia humana — lo que se recuerda al volver del viaje.
4. INSIDER TIP (1 frase): consejo práctico verificable (mejor hora, entrada, secreto). Si no hay nada fiable, omite este bloque — NO inventes.
5. CIERRE INVITANTE (1 frase): "Fíjate en...", "Antes de seguir, observa..."

200-280 palabras. Voz cálida, apasionada, español de España, tuteo. Estilo Lonely Planet / Civitatis. SOLO la narración, sin comillas, sin títulos, sin viñetas.`
      : `Generate an audio explanation about "${poiName}"${cityName ? ` in ${cityName}` : ''}.

${description ? `Verified background info (extract dates, names, events):\n${description.slice(0, 1200)}` : ''}

REQUIRED STRUCTURE (six short blocks):
0. VISUAL CONFIRMATION (1-2 sentences): "Look at the image on screen — do you see [brief recognisable visual description]? That's ${poiName}."
1. IMMEDIATE HOOK (1 sentence): surprising question, vivid image or striking fact.
2. STORY WITH FACTS (2-3 sentences): 2-3 concrete facts from the background info — dates, protagonists, real events. NOT generic.
3. ANECDOTE OR CURIOSITY (1-2 sentences): legend, architectural detail, human story — the thing travellers remember at home.
4. INSIDER TIP (1 sentence): verifiable practical tip (best time, entry, secret). If nothing reliable, skip this block — do NOT invent.
5. INVITING CLOSE (1 sentence): "Look at...", "Before moving on, notice..."

200-280 words. Warm, passionate voice. Lonely Planet / Civitatis style. ONLY the narration, no quotes, no titles, no bullets.`

  try {
    return await callAI(system, user, getAIKey(userKey), 900)
  } catch (err) {
    console.error('AI POI explanation error:', err)
    return null
  }
}

/**
 * General-purpose tourism assistant chat — used by the GuiAgo chatbot.
 * Routes through the same local → Mistral → Pollinations priority chain.
 */
export async function chatWithAssistant(
  userMessage: string,
  lang: Language,
  userKey: string
): Promise<string> {
  const system =
    lang === 'es'
      ? 'Eres un asistente turístico experto de GuiAgo. Ayudas con información sobre lugares turísticos, rutas, cultura local, consejos prácticos y todo lo relacionado con viajes. Respuestas concisas, amigables y útiles en español. Sin formato markdown.'
      : "You are GuiAgo's expert tourism assistant. You help with tourist spots, routes, local culture, practical tips and everything travel-related. Concise, friendly, useful answers in English. No markdown formatting."
  return callAI(system, userMessage, getAIKey(userKey), 400)
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
