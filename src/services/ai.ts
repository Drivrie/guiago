import type { RouteType, Language } from '../types'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
// Using the fastest/cheapest model for snappy UX
const MODEL = 'claude-haiku-4-5-20251001'

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

async function callClaude(
  system: string,
  user: string,
  apiKey: string,
  maxTokens = 1200
): Promise<string> {
  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error((err as { error?: { message?: string } }).error?.message || `HTTP ${response.status}`)
  }
  const data = await response.json() as { content?: Array<{ text?: string }> }
  return data.content?.[0]?.text?.trim() || ''
}

// Generate a Civitatis-quality curated route with AI
export async function generateAIRoute(
  cityName: string,
  routeType: RouteType,
  durationMinutes: number,
  lang: Language,
  apiKey: string,
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

La ruta debe ser como las de Civitatis: coherente temáticamente, con un hilo narrativo claro, lugares reales y verificables. Cada parada debe tener valor propio.

JSON exacto a devolver (sin texto fuera del JSON):
{
  "routeStory": "Descripción evocadora de la ruta en 2-3 frases: qué se verá, por qué merece la pena, cuál es el hilo conductor",
  "suggestedPOIs": [
    {
      "name": "Nombre oficial completo y exacto del lugar",
      "category": "categoría exacta (catedral/museo/plaza/palacio/jardín/etc)",
      "reason": "Por qué es imprescindible en esta ruta: historia o dato destacado en 1-2 frases",
      "insiderTip": "Consejo práctico o dato curioso no habitual en guías turísticas (string o null)"
    }
  ]
}`
      : `Design a professional-quality tour for ${cityName}:
- Theme: ${typeDesc}
- Total duration: ${durationMinutes} minutes of visiting
- Number of stops: ${maxPOIs}${excludeClause}

The tour should be like Civitatis: thematically coherent, with a clear narrative thread, real and verifiable places. Each stop must have its own value.

Exact JSON to return (no text outside the JSON):
{
  "routeStory": "Evocative route description in 2-3 sentences: what will be seen, why it's worth it, what's the connecting thread",
  "suggestedPOIs": [
    {
      "name": "Official full exact name of the place",
      "category": "exact category (cathedral/museum/square/palace/garden/etc)",
      "reason": "Why it's essential in this route: key history or fact in 1-2 sentences",
      "insiderTip": "Practical tip or unusual fact not usually in tourist guides (string or null)"
    }
  ]
}`

  try {
    const text = await callClaude(system, user, apiKey, 1500)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0]) as AIRouteResult
  } catch (err) {
    console.error('AI route generation error:', err)
    return null
  }
}

// Generate a professional audio narration for a POI (Civitatis style)
export async function generateAIAudioScript(
  poiName: string,
  category: string,
  wikiDescription: string,
  reason: string,
  insiderTip: string | null | undefined,
  lang: Language,
  apiKey: string
): Promise<string | null> {
  const system =
    lang === 'es'
      ? `Eres un guía turístico profesional apasionado, al estilo de Civitatis. Tu voz es cálida, cercana y entusiasta. Hablas en español de España con "tú". No lees datos: compartes tu amor por el lugar. Usas pausas naturales con comas, puntos y frases cortas. Mencionas detalles concretos y visuales. Tu narración dura exactamente lo que se le indica.`
      : `You are a passionate professional tour guide, in the style of Civitatis or Walkative. Your voice is warm, personal and enthusiastic. You don't read facts — you share your love for the place. You use natural pauses with commas, periods and short sentences. You mention concrete, visual details.`

  const user =
    lang === 'es'
      ? `Genera la narración de audio del guía al llegar a "${poiName}" (${category}).

Información de apoyo:
${wikiDescription ? `Descripción: ${wikiDescription.slice(0, 500)}` : ''}
${reason ? `Por qué es especial: ${reason}` : ''}
${insiderTip ? `Dato insider: ${insiderTip}` : ''}

Escribe una narración de 180-230 palabras que:
1. Abra con una bienvenida entusiasta y muy natural, como si llevaras años viniendo aquí
2. Cuente 2-3 datos fascinantes de forma conversacional, no como un libro de texto
3. Si hay dato insider, inclúyelo con "Poca gente sabe que..." o "Un secreto que te cuento..."
4. Use pausas naturales: "...", comas frecuentes, frases de 10-15 palabras
5. Termine invitando a explorar con calma: "Cuando estés listo/a, seguimos..."

Devuelve SOLO la narración, sin comillas, sin encabezados.`
      : `Generate the audio guide narration for arriving at "${poiName}" (${category}).

Supporting info:
${wikiDescription ? `Description: ${wikiDescription.slice(0, 500)}` : ''}
${reason ? `Why it's special: ${reason}` : ''}
${insiderTip ? `Insider tip: ${insiderTip}` : ''}

Write a 180-230 word narration that:
1. Opens with an enthusiastic, very natural welcome, as if you've been coming here for years
2. Shares 2-3 fascinating facts conversationally, not like a textbook
3. If there's an insider tip, include it with "Not many people know that..." or "A secret I'll share with you..."
4. Uses natural pauses: "...", frequent commas, 10-15 word sentences
5. Ends by inviting them to explore: "Whenever you're ready, we'll move on..."

Return ONLY the narration, no quotes, no headings.`

  try {
    return await callClaude(system, user, apiKey, 600)
  } catch (err) {
    console.error('AI audio script error:', err)
    return null
  }
}

// Validate that an API key works (cheap test call)
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    await callClaude('Respond with: OK', 'Test', apiKey, 10)
    return true
  } catch {
    return false
  }
}
