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
// Per-route-type guidance: detailed instructions per theme so the AI actually
// returns DIFFERENT POIs for "gastronomía" vs "historia negra" vs "curiosidades"
// instead of the same iconic landmarks. Includes explicit DO-NOT-INCLUDE lists
// because the model's default behaviour is to recycle the top-3 tourist sights
// for any prompt about a city.
// ---------------------------------------------------------------------------
function routeTypeGuidance(routeType: RouteType, lang: Language): string {
  const es = lang === 'es'
  switch (routeType) {
    case 'imprescindibles':
      return es
        ? `OBJETIVO: los hitos más icónicos y mundialmente reconocidos de la ciudad — los que aparecerían en la portada de Lonely Planet. La parada nº 1 debe ser EL símbolo de la ciudad. Mezcla 1-2 plazas/calles emblemáticas para dar continuidad narrativa.`
        : `GOAL: the most iconic, world-renowned landmarks — the ones that would appear on a Lonely Planet cover. Stop #1 must be THE symbol of the city. Include 1-2 emblematic squares/streets to give narrative flow.`
    case 'monumental':
      return es
        ? `OBJETIVO: monumentos históricos de gran escala — catedrales, basílicas, palacios, castillos, murallas, fortificaciones, conventos famosos. PROHIBIDO: restaurantes, mercados, jardines puramente recreativos, fuentes ornamentales modernas.`
        : `GOAL: large-scale historic monuments — cathedrals, basilicas, palaces, castles, walls, fortifications, famous convents. FORBIDDEN: restaurants, markets, purely recreational gardens, modern ornamental fountains.`
    case 'arquitectura':
      return es
        ? `OBJETIVO: edificios destacados por su VALOR ARQUITECTÓNICO. Cada parada debe ilustrar un ESTILO o ÉPOCA DISTINTOS — gótico, mudéjar, renacentista, barroco, neoclásico, modernismo, racionalismo, contemporáneo. En el campo \`reason\`, NOMBRA el estilo y al arquitecto si es conocido. PROHIBIDO: lugares elegidos por su fama turística genérica si no aportan un valor arquitectónico claro.`
        : `GOAL: buildings selected for their ARCHITECTURAL VALUE. Each stop must illustrate a DIFFERENT STYLE or ERA — Gothic, Mudéjar, Renaissance, Baroque, Neoclassical, Modernism, Rationalism, Contemporary. In the \`reason\` field, NAME the style and the architect when known. FORBIDDEN: places picked for generic tourist fame if they don't add clear architectural value.`
    case 'gastronomia':
      return es
        ? `OBJETIVO: SOLO lugares relacionados con comida y bebida — mercados históricos de abastos, bares de tapas centenarios, tabernas tradicionales, bodegas con visita, chocolaterías y pastelerías legendarias, asadores, sidrerías, cervecerías, neveras de vinos, calles gastronómicas. Incluye 1-2 platos/bebidas concretos a probar en cada sitio y un rango de precio aproximado en el insiderTip. PROHIBIDO ABSOLUTAMENTE: catedrales, palacios, museos, iglesias, castillos, monumentos. Si solo conoces los grandes monumentos de esa ciudad, devuelve menos paradas — NUNCA rellenes con sitios no gastronómicos.`
        : `GOAL: ONLY food-and-drink places — historic food markets, century-old tapas bars, traditional taverns, wineries open to visit, legendary chocolatiers and patisseries, grill restaurants, cider houses, breweries, wine cellars, foodie streets. Include 1-2 specific dishes/drinks to try at each spot, and a rough price range in insiderTip. ABSOLUTELY FORBIDDEN: cathedrals, palaces, museums, churches, castles, monuments. If you only know the city's big monuments, return FEWER stops — NEVER pad with non-gastronomic sites.`
    case 'historia_negra':
      return es
        ? `OBJETIVO: SOLO lugares con historia oscura, trágica o macabra verificable — sitios de ejecuciones públicas, antiguas cárceles e Inquisición, hospitales de la peste, fosas comunes, cementerios con historia, escenarios de crímenes famosos, antiguas judérias tras pogromos, búnkeres y refugios de guerra, memoriales de víctimas, casas embrujadas con leyenda documentada. En el campo \`reason\` NOMBRA víctimas, fechas y eventos concretos. Tono respetuoso pero sin eufemismos. PROHIBIDO: monumentos famosos sin asociación histórica oscura clara, jardines bonitos, mercados de comida, restaurantes turísticos.`
        : `GOAL: ONLY places with verifiable dark, tragic or macabre history — public execution sites, former prisons and Inquisition headquarters, plague hospitals, mass graves, cemeteries with history, scenes of famous crimes, former Jewish ghettos after pogroms, war bunkers and shelters, victims' memorials, haunted houses with documented legends. In the \`reason\` field NAME victims, dates and concrete events. Respectful tone, no euphemisms. FORBIDDEN: famous monuments with no clear dark-history association, pretty gardens, food markets, tourist restaurants.`
    case 'curiosidades':
      return es
        ? `OBJETIVO: SOLO lugares RAROS, INSÓLITOS o SORPRENDENTES — la calle más estrecha, la casa más antigua, el detalle arquitectónico escondido, la estatua con leyenda urbana, un museo extravagante, un pasadizo desconocido, una excentricidad histórica, un easter egg en una fachada. Cada parada debe responder a "¿sabías que...?". PROHIBIDO: catedrales y palacios famosos como entrada principal — solo se aceptan si los presentas por una curiosidad SECUNDARIA muy específica (ej.: "la cripta secreta", "el grafiti medieval en la columna").`
        : `GOAL: ONLY ODD, UNUSUAL or SURPRISING places — the narrowest street, the oldest house, the hidden architectural detail, the statue with an urban legend, a quirky museum, a forgotten passage, a historical eccentricity, an easter egg on a façade. Every stop must answer "did you know that...?". FORBIDDEN: famous cathedrals and palaces as the main entry — only acceptable if you frame them around a VERY SPECIFIC secondary curiosity (e.g. "the secret crypt", "the medieval graffiti on the column").`
    case 'secretos_locales':
      return es
        ? `OBJETIVO: SOLO sitios que un guía LOCAL llevaría a un amigo, no a un turista — plazas de barrio, bares de viejos, patios escondidos, mercadillos de cercanía, calles peatonales fuera del circuito turístico, miradores poco conocidos, cafés donde los vecinos juegan al dominó, panaderías centenarias del barrio. EXCLUYE COMPLETAMENTE los 3-5 lugares más famosos de la ciudad (ej.: en Barcelona NO la Sagrada Familia ni el Park Güell; en París NO la Torre Eiffel; en Madrid NO el Prado ni el Palacio Real). El visitante quiere descubrir lo que NO sale en las guías.`
        : `GOAL: ONLY places a LOCAL guide would take a friend, never a tourist — neighbourhood squares, old-timer bars, hidden courtyards, local markets, pedestrian streets off the tourist circuit, little-known viewpoints, cafés where neighbours play dominoes, century-old bakeries. COMPLETELY EXCLUDE the city's 3-5 most famous sights (e.g. in Barcelona NOT Sagrada Familia or Park Güell; in Paris NOT the Eiffel Tower; in Madrid NOT the Prado or Royal Palace). The visitor wants what's NOT in the guidebooks.`
    case 'naturaleza':
      return es
        ? `OBJETIVO: SOLO espacios verdes y naturales — grandes parques históricos, jardines botánicos, jardines secretos, paseos arbolados, riberas y orillas, miradores naturales, bosques urbanos, lagos y estanques, vías verdes peatonales. Incluye plantas/aves emblemáticas si las conoces, y la mejor estación para visitar en el insiderTip. PROHIBIDO: catedrales, palacios, castillos, museos, restaurantes — salvo el café o quiosco DENTRO del parque.`
        : `GOAL: ONLY green and natural spaces — large historic parks, botanical gardens, secret gardens, tree-lined walks, riverbanks, natural viewpoints, urban forests, lakes and ponds, pedestrian greenways. Include emblematic plants/birds if you know them, and the best season to visit in insiderTip. FORBIDDEN: cathedrals, palaces, castles, museums, restaurants — except a café or kiosk INSIDE the park.`
  }
}

// Per-route-type narration style hints for the arrival audio script.
function narrationStyle(routeType: RouteType, lang: Language): string {
  const es = lang === 'es'
  switch (routeType) {
    case 'historia_negra':
      return es
        ? 'TONO ESPECÍFICO para historia negra: respetuoso pero con suspense; nombra víctimas y fechas concretas; describe qué pasó AQUÍ con detalle; evita los eufemismos; recoge una leyenda o testimonio si existe.'
        : 'SPECIFIC TONE for dark history: respectful but with suspense; name victims and concrete dates; describe what happened HERE in detail; no euphemisms; include a legend or testimony if it exists.'
    case 'gastronomia':
      return es
        ? 'TONO ESPECÍFICO para gastronomía: nombra 1-2 platos o bebidas EMBLEMÁTICOS del lugar, cómo se prepara y cuándo se inventó si lo sabes; cuenta a quién verás dentro (vecinos, oficinistas, viejos parroquianos); rango de precio aproximado; etiqueta local (¿se pide en barra o en mesa?, ¿se da propina?).'
        : 'SPECIFIC TONE for gastronomy: name 1-2 EMBLEMATIC dishes or drinks, how they\'re made and when they were invented if you know; describe who you\'ll see inside (neighbours, office workers, old regulars); rough price range; local etiquette (do you order at the bar or table? do you tip?).'
    case 'curiosidades':
      return es
        ? 'TONO ESPECÍFICO para curiosidades: pon en primer plano LO RARO — la frase debe empezar enganchando ("Lo que tienes delante esconde algo que pocos saben..."); revela el dato sorprendente en el segundo párrafo; cierra con un guiño cómplice.'
        : 'SPECIFIC TONE for curiosities: foreground THE WEIRDNESS — the opening line should hook ("What you see here hides something few people know..."); reveal the surprising fact in the second paragraph; close with a knowing wink.'
    case 'secretos_locales':
      return es
        ? 'TONO ESPECÍFICO para secretos locales: habla COMO UN LOCAL revelando algo personal; explica por qué este sitio importa a los vecinos del barrio; incluye una rutina cotidiana (a qué hora viene quién); no sea grandilocuente — íntimo.'
        : 'SPECIFIC TONE for local secrets: speak LIKE A LOCAL revealing something personal; explain why this matters to the neighbourhood; include a daily routine (who comes at what time); not grandiloquent — intimate.'
    case 'arquitectura':
      return es
        ? 'TONO ESPECÍFICO para arquitectura: nombra el ESTILO y al ARQUITECTO; señala 2-3 elementos visuales concretos a observar (ej.: "fíjate en las gárgolas del lado norte"); contextualiza la época y la técnica constructiva.'
        : 'SPECIFIC TONE for architecture: name the STYLE and the ARCHITECT; point out 2-3 concrete visual elements to observe ("notice the gargoyles on the north side"); contextualise the era and the construction technique.'
    case 'naturaleza':
      return es
        ? 'TONO ESPECÍFICO para naturaleza: describe sonidos, olores, colores estacionales; nombra especies vegetales o de aves emblemáticas; recomienda dónde sentarse y la mejor estación para visitarlo.'
        : 'SPECIFIC TONE for nature: describe sounds, smells, seasonal colours; name emblematic plant or bird species; recommend where to sit and the best season to visit.'
    case 'monumental':
      return es
        ? 'TONO ESPECÍFICO para monumental: contextualiza el poder que construyó este monumento, cuánto se tardó, qué materiales y de dónde; describe 2-3 elementos escultóricos o decorativos concretos a observar.'
        : 'SPECIFIC TONE for monuments: contextualise the power that built this monument, how long it took, what materials and from where; describe 2-3 concrete sculptural or decorative elements to observe.'
    case 'imprescindibles':
    default:
      return ''
  }
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
  // More POIs: 1 per 15 min, min 5, max 15
  const maxPOIs = Math.max(5, Math.min(15, Math.floor(durationMinutes / 15)))
  const typeDesc = ROUTE_TYPE_DESC[routeType][lang]
  // Always use "CityName, Country" to avoid ambiguity (e.g. Roma Poland vs Roma Italy)
  const locationDesc = countryName ? `${cityName}, ${countryName}` : cityName
  const excludeClause =
    excludeNames.length > 0
      ? lang === 'es'
        ? `\nIMPORTANTE: El usuario ya ha visitado estos lugares — exclúyelos completamente: ${excludeNames.slice(0, 15).join(', ')}.`
        : `\nIMPORTANT: The user already visited these places — exclude them completely: ${excludeNames.slice(0, 15).join(', ')}.`
      : ''

  const guidance = routeTypeGuidance(routeType, lang)

  const system =
    lang === 'es'
      ? `Eres un guía turístico profesional de élite, al nivel de los autores de Lonely Planet y National Geographic Traveler y de los guías presenciales de Civitatis y Walkative. Diseñas rutas MEMORABLES, COHERENTES y NARRATIVAS con paradas próximas entre sí (máximo 600-800m) para que fluyan a pie. Conoces a fondo cada ciudad — su historia, su gastronomía, sus barrios, sus historias oscuras. Respondes SOLO con JSON válido, sin texto adicional, sin markdown.`
      : `You are an elite professional tour guide, on par with Lonely Planet and National Geographic Traveler authors and the in-person Civitatis and Walkative guides. You design MEMORABLE, COHERENT and NARRATIVE routes with stops close together (max 600-800m) so they flow on foot. You know each city deeply — its history, its food, its neighbourhoods, its dark stories. You respond ONLY with valid JSON, no additional text, no markdown.`

  const user =
    lang === 'es'
      ? `Diseña una ruta turística de NIVEL LONELY PLANET para ${locationDesc}:
- Tipo de ruta: ${typeDesc}
- Duración total de visita: ${durationMinutes} minutos (sin contar desplazamientos)
- Número de paradas: ${maxPOIs}${excludeClause}

REGLA Nº 1 — DIFERENCIACIÓN ESTRICTA POR TIPO DE RUTA:
${guidance}

REQUISITOS ESTRICTOS:
1. TODOS los lugares deben estar FÍSICAMENTE en ${locationDesc} — no en otras ciudades, regiones ni países. Si dudas, NO lo incluyas.
2. Usa los nombres OFICIALES como aparecen en Wikipedia (idioma local del país o inglés reconocible).
3. Distancia máxima entre paradas consecutivas: 600-800 metros a pie. Si dos POIs están más lejos, sustituye uno por algo más cercano.
4. Orden geográfico óptimo — ruta circular o lineal lógica, SIN cruces ni zigzags.
5. Coherencia temática absoluta — cada parada DEBE encajar en el tipo de ruta. Si no encuentras suficientes paradas válidas del tipo solicitado, devuelve MENOS — NUNCA rellenes con sitios off-theme.
6. Información histórica ESPECÍFICA y verificable: fechas concretas, nombres de protagonistas, eventos reales. Nada de descripciones genéricas.
7. Insider tips REALES: si no conoces algo verificable, devuelve null — NO inventes.

JSON exacto (sin texto fuera del JSON):
{
  "routeStory": "Narrativa de apertura evocadora en 2-3 frases adaptada al tipo de ruta (gastronómica, oscura, secreta, etc.) — atmósfera, hilo conductor, por qué merece la pena hoy. Estilo Lonely Planet — literario pero directo, apasionado.",
  "suggestedPOIs": [
    {
      "name": "Nombre oficial completo en ${locationDesc} como aparece en Wikipedia",
      "category": "categoría precisa adaptada al tipo (mercado/taberna/cementerio/jardín/etc)",
      "reason": "Por qué este lugar concreto en esta posición de la ruta: 1-2 datos específicos y memorables ADAPTADOS al tipo de ruta",
      "insiderTip": "Consejo verificable concreto. null si no estás seguro."
    }
  ]
}`
      : `Design a LONELY PLANET-level tour for ${locationDesc}:
- Route type: ${typeDesc}
- Total visit duration: ${durationMinutes} minutes (excluding walking)
- Number of stops: ${maxPOIs}${excludeClause}

RULE Nº 1 — STRICT DIFFERENTIATION BY ROUTE TYPE:
${guidance}

STRICT REQUIREMENTS:
1. ALL places must be PHYSICALLY in ${locationDesc} — no other cities, regions or countries. If unsure, leave it out.
2. Use OFFICIAL names as they appear on Wikipedia (local language or recognisable English).
3. Maximum distance between consecutive stops: 600-800 metres on foot. If two POIs are further, swap one for something closer.
4. Optimal geographic order — circular or linear logical route, NO crossings or zigzags.
5. Absolute thematic coherence — each stop MUST fit the route type. If you can't find enough valid stops of the requested type, return FEWER — NEVER pad with off-theme places.
6. SPECIFIC, verifiable historical information: concrete dates, protagonist names, real events. No generic descriptions.
7. REAL insider tips: if you don't know something verifiable, return null — DO NOT invent.

Exact JSON (no text outside the JSON):
{
  "routeStory": "Evocative opening narrative in 2-3 sentences adapted to the route type (gastronomic, dark, secret, etc.) — atmosphere, connecting thread, why it's worth it today. Lonely Planet style — literary but direct, passionate.",
  "suggestedPOIs": [
    {
      "name": "Official full name in ${locationDesc} as on Wikipedia",
      "category": "precise category adapted to the type (market/tavern/cemetery/garden/etc)",
      "reason": "Why this specific place at this position in the route: 1-2 specific, memorable facts ADAPTED to the route type",
      "insiderTip": "Verifiable concrete tip. null if unsure."
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
  userKey: string,
  routeType?: RouteType,
): Promise<string | null> {
  const styleHint = routeType ? narrationStyle(routeType, lang) : ''

  const system =
    lang === 'es'
      ? `Eres un guía turístico de nivel Lonely Planet — apasionado, carismático, con anécdotas. Tu estilo es CONVERSACIONAL y VIVO:
- Hablas directamente al visitante: "Fíjate en...", "Levanta la vista...", "¿Sabes lo que pasó aquí?"
- Preguntas retóricas que crean suspense
- Datos CONCRETOS y verificables con entusiasmo: fechas, nombres, eventos — no descripciones genéricas
- Sentido del humor y cariño por los lugares
- Frases cortas, pausas dramáticas con puntos y comas
- Tuteas siempre, en español de España
- Nunca suenas como Wikipedia — suenas como alguien que conoce este lugar de primera mano`
      : `You are a Lonely Planet-level tour guide — passionate, charismatic, full of anecdotes. Your style is CONVERSATIONAL and LIVELY:
- Address the visitor directly: "Look at...", "Raise your eyes...", "Do you know what happened here?"
- Rhetorical questions that build suspense
- CONCRETE, verifiable facts with enthusiasm: dates, names, events — no generic descriptions
- Warmth and humour
- Short sentences, dramatic pauses with periods and commas
- Never sound like Wikipedia — sound like someone who knows this place first-hand`

  const user =
    lang === 'es'
      ? `Genera la narración de audio AL LLEGAR a "${poiName}" (${category}).

${wikiDescription ? `CONTEXTO HISTÓRICO VERIFICADO (extrae fechas, nombres y eventos concretos):\n${wikiDescription.slice(0, 2500)}` : ''}
${reason ? `\nPor qué es especial en esta ruta: ${reason}` : ''}
${insiderTip ? `\nDato insider verificado: ${insiderTip}` : ''}
${styleHint ? `\n${styleHint}` : ''}

ESTRUCTURA OBLIGATORIA (siete bloques en este orden):
0. CONFIRMACIÓN VISUAL (1-2 frases): "Mira la imagen en tu pantalla — ¿ves [descripción breve y reconocible]? Eso es ${poiName}, comprueba que lo tienes delante."
1. HOOK INMEDIATO (1-2 frases): pregunta sorprendente, imagen vívida o dato impactante. NUNCA "Bienvenido" ni "Aquí estamos".
2. HISTORIA CON DATOS (3-4 frases): 3-4 hechos históricos CONCRETOS extraídos del contexto — fechas, nombres, eventos reales. Tono "te lo cuento como a un amigo", no enciclopédico.
3. ANÉCDOTA O CURIOSIDAD (1-2 frases): algo memorable, sorprendente o poco conocido — leyenda, rareza arquitectónica, historia humana. Lo que la gente recuerda al volver del viaje.
4. SIGNIFICADO CULTURAL (1-2 frases): por qué este lugar importa hoy — qué representa, qué simboliza, qué cambió.
5. INSIDER TIP (1 frase): si hay tip verificado, preséntalo como secreto: "Poca gente sabe que..." o "Mi consejo: ...". Si no hay tip fiable, omite este bloque.
6. CIERRE INVITANTE (1-2 frases): "Tómate un minuto para...", "Antes de seguir, fíjate en...", "Acércate y observa..."

LONGITUD: 320-420 palabras. Voz viva, apasionada, español de España, tuteo. Estilo Lonely Planet / Civitatis presencial. SOLO la narración, sin comillas, sin títulos, sin guiones, sin viñetas. Si los datos del contexto son escasos, sé conciso pero específico — no rellenes con tópicos ni inventes datos.`
      : `Generate audio narration ARRIVING AT "${poiName}" (${category}).

${wikiDescription ? `VERIFIED HISTORICAL CONTEXT (extract concrete dates, names and events):\n${wikiDescription.slice(0, 2500)}` : ''}
${reason ? `\nWhy it's special on this route: ${reason}` : ''}
${insiderTip ? `\nVerified insider tip: ${insiderTip}` : ''}
${styleHint ? `\n${styleHint}` : ''}

REQUIRED STRUCTURE (seven blocks in this order):
0. VISUAL CONFIRMATION (1-2 sentences): "Take a look at the image on your screen — do you see [brief, recognisable description]? That's ${poiName}; make sure it's right in front of you."
1. IMMEDIATE HOOK (1-2 sentences): surprising question, vivid image, striking fact. NEVER "Welcome" or "Here we are".
2. STORY WITH FACTS (3-4 sentences): 3-4 CONCRETE historical facts from the context — dates, names, real events. "Telling a friend" tone, not encyclopedic.
3. ANECDOTE OR CURIOSITY (1-2 sentences): something memorable, surprising or little-known — a legend, an architectural quirk, a human story. The thing travellers remember.
4. CULTURAL SIGNIFICANCE (1-2 sentences): why this place matters today — what it stands for, what it symbolises, what it changed.
5. INSIDER TIP (1 sentence): if there's a verified tip, present it as a secret: "Few people know that..." or "My tip: ...". If no reliable tip, skip this block.
6. INVITING CLOSE (1-2 sentences): "Take a minute to...", "Before we move on, look at...", "Step closer and notice..."

LENGTH: 320-420 words. Lively, passionate voice. Lonely Planet / in-person Civitatis style. ONLY the narration, no quotes, no titles, no dashes, no bullets. If the context data is sparse, stay concise but specific — don't pad with clichés or invent facts.`

  try {
    return await callAI(system, user, getAIKey(userKey), 1500)
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

${description ? `INFORMACIÓN DE BASE VERIFICADA (extrae fechas, nombres, eventos concretos):\n${description.slice(0, 2500)}` : ''}

ESTRUCTURA OBLIGATORIA (seis bloques):
0. CONFIRMACIÓN VISUAL (1-2 frases): "Mira la imagen en pantalla — ¿ves [descripción visual breve y reconocible]? Eso es ${poiName}."
1. HOOK INMEDIATO (1 frase): pregunta sorprendente, imagen vívida o dato impactante.
2. HISTORIA CON DATOS (3-4 frases): 3-4 hechos CONCRETOS extraídos de la información — fechas, protagonistas, eventos reales. NO genéricos.
3. ANÉCDOTA O CURIOSIDAD (1-2 frases): leyenda, detalle arquitectónico, historia humana — lo que se recuerda al volver del viaje.
4. INSIDER TIP (1 frase): consejo práctico verificable (mejor hora, entrada, secreto). Si no hay nada fiable, omite este bloque — NO inventes.
5. CIERRE INVITANTE (1-2 frases): "Fíjate en...", "Antes de seguir, observa..."

300-380 palabras. Voz cálida, apasionada, español de España, tuteo. Estilo Lonely Planet / Civitatis. SOLO la narración, sin comillas, sin títulos, sin viñetas.`
      : `Generate an audio explanation about "${poiName}"${cityName ? ` in ${cityName}` : ''}.

${description ? `VERIFIED BACKGROUND INFO (extract concrete dates, names, events):\n${description.slice(0, 2500)}` : ''}

REQUIRED STRUCTURE (six blocks):
0. VISUAL CONFIRMATION (1-2 sentences): "Look at the image on screen — do you see [brief recognisable visual description]? That's ${poiName}."
1. IMMEDIATE HOOK (1 sentence): surprising question, vivid image or striking fact.
2. STORY WITH FACTS (3-4 sentences): 3-4 CONCRETE facts from the background info — dates, protagonists, real events. NOT generic.
3. ANECDOTE OR CURIOSITY (1-2 sentences): legend, architectural detail, human story — the thing travellers remember at home.
4. INSIDER TIP (1 sentence): verifiable practical tip (best time, entry, secret). If nothing reliable, skip this block — do NOT invent.
5. INVITING CLOSE (1-2 sentences): "Look at...", "Before moving on, notice..."

300-380 words. Warm, passionate voice. Lonely Planet / Civitatis style. ONLY the narration, no quotes, no titles, no bullets.`

  try {
    return await callAI(system, user, getAIKey(userKey), 1500)
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
