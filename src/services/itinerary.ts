import type { City, Language, POI, Route, RouteDuration, RouteType } from '../types'
import { extractItineraryFromText } from './ai'
import { searchPOIByName } from './wikigeo'
import { buildRouteSegments, orderPOIsOptimally } from './routing'

export interface ItineraryStop {
  name: string
  searchName?: string
  notes?: string
  visitMinutes?: number
}

export interface ParsedItinerary {
  city?: string
  country?: string
  title?: string
  intro?: string
  stops: ItineraryStop[]
  source: 'ai' | 'text'
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const BULLET_RE = /^\s*(?:\d{1,2}\s*[.)º°:\-–]|[-–—•*·▪►✔✓→>]|\(?[a-z]\))\s*/iu
const TIME_RE = /^\s*\d{1,2}(?:[:.h]\d{2})?\s*(?:h|hs|am|pm)?\s*[-–—:]?\s+/i
const LEAD_IN_RE = /^(?:visit(?:a|ar|e)?|ver|subir(?: a)?|paseo(?: por)?|pasear(?: por)?|entrada(?: a| al)?|parada(?: en)?|stop(?: at)?|walk(?: to| through| along)?|head(?: to)?|then|next|first|finally|después|luego|primero|finalmente|seguimos(?: por| hacia| hasta)?|llegamos(?: a| al)?|continuamos(?: por| hacia| hasta)?|terminamos(?: en)?|empezamos(?: en| por)?|(?:comer|cenar|desayunar|almorzar|tomar algo|tomar un café|lunch|dinner|breakfast|coffee|drinks)(?: en| at| in)?|y|and|al|a|la|el|los|las|the|to)\s+/i
const CONNECTOR = "(?:de|del|la|las|los|el|of|the|di|du|des|w|we|na|y|e|von|der|zu|św\\.?|san|santa|santo)"
const CAPITALIZED_RE = new RegExp(`\\p{Lu}[\\p{L}'’.\\-]*(?:\\s+(?:${CONNECTOR}\\s+){0,2}\\p{Lu}[\\p{L}'’.\\-]*)*`, 'gu')

// "Puente Romano al atardecer" → "Puente Romano" (descriptive tail in lower case)
const TRAILING_DESC_RE = /\s+(?:al|a la|a las|por la|por el|por la mañana|en|para|antes|después|durante|at|in the|for|before|after|during)\s+\p{Ll}.*$/u
// "Catedral Nueva y Catedral Vieja" → two stops
const PAIR_RE = /^(\p{Lu}.{3,}?)\s+(?:y|e|and|&|i|und|et)\s+(\p{Lu}.{3,})$/u

function cleanStopName(raw: string): string {
  let name = raw.replace(TIME_RE, '').trim()
  for (let i = 0; i < 4; i++) {
    const next = name.replace(LEAD_IN_RE, '')
    if (next === name) break
    name = next
  }
  if (/^\p{Lu}/u.test(name)) name = name.replace(TRAILING_DESC_RE, '')
  return name.replace(/^["'“”«»]+|["'“”«».,;:!?]+$/g, '').trim()
}

/** Proper-noun phrases in a sentence, skipping the capitalised first word of the sentence. */
function capitalizedPhrases(sentence: string): string[] {
  const out: string[] = []
  const trimmed = sentence.trim()
  for (const m of trimmed.matchAll(CAPITALIZED_RE)) {
    const phrase = m[0].replace(/[.\-]+$/, '')
    if (m.index === 0 && !/\s/.test(phrase)) continue
    if (phrase.length >= 4) out.push(phrase)
  }
  return out
}

function minutesIn(text: string): number | undefined {
  const m = text.match(/(\d{1,3})\s*(?:min|minutos|minutes)\b/i)
  return m ? Number(m[1]) : undefined
}

/** Offline / no-AI fallback: understands numbered or bulleted lists, "A → B → C" chains and prose. */
export function parseItineraryText(text: string): ParsedItinerary {
  const stops: ItineraryStop[] = []
  const seen = new Set<string>()
  const add = (name: string, notes: string, source: string) => {
    const clean = cleanStopName(name)
    const pair = clean.match(PAIR_RE)
    if (pair) {
      add(pair[1], notes, source)
      add(pair[2], notes, source)
      return
    }
    const key = clean.toLowerCase()
    if (clean.length < 3 || clean.length > 80 || seen.has(key) || stops.length >= 25) return
    seen.add(key)
    stops.push({ name: clean, notes: notes.trim() || undefined, visitMinutes: minutesIn(source) })
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const listLines = lines.filter(l => BULLET_RE.test(l))

  if (listLines.length >= 2) {
    for (const line of listLines) {
      const item = line.replace(BULLET_RE, '').replace(TIME_RE, '')
      // "Name: notes" / "Name – notes" / "Name (notes)" / "Name. Notes"
      const m = item.match(/^(.{2,90}?)(\s*:\s*|\s*\(\s*|\s+[-–—]\s+|\.\s+|,\s+)(.*)$/s)
      const name = m ? m[1] : item
      let notes = m ? (m[2].includes('(') ? m[3].replace(/\)\s*$/, '') : m[3]) : ''
      const tail = cleanStopName(name) !== name.trim() ? name.trim().match(TRAILING_DESC_RE)?.[0].trim() : undefined
      if (tail) notes = [tail, notes].filter(Boolean).join(' · ')
      if (cleanStopName(name).split(/\s+/).length <= 7) add(name, notes, item)
      else for (const phrase of capitalizedPhrases(item)) add(phrase, item, item)
    }
  } else {
    // Prose or arrow chains: each sentence / chain link may name one or more places
    const chunks = text.split(/\s*(?:→|->|=>|;|[.!?](?=\s|$)|\n)\s*/)
    for (const chunk of chunks) {
      for (const phrase of capitalizedPhrases(chunk)) add(phrase, chunk.length > phrase.length + 15 ? chunk : '', chunk)
    }
  }
  return { stops, source: 'text' }
}

/** AI extraction first (understands prose, knows official names), text parsing as fallback. */
export async function parseItinerary(text: string, lang: Language, userKey: string): Promise<ParsedItinerary> {
  const ai = await extractItineraryFromText(text, lang, userKey).catch(() => null)
  if (ai && ai.stops.length > 0) {
    return {
      city: ai.city || undefined,
      country: ai.country || undefined,
      title: ai.title || undefined,
      intro: ai.intro || undefined,
      source: 'ai',
      stops: ai.stops.map(s => ({
        name: s.name.trim(),
        searchName: s.searchName?.trim() || undefined,
        notes: s.notes?.trim() || undefined,
        visitMinutes: typeof s.visitMinutes === 'number' && s.visitMinutes > 0 ? s.visitMinutes : undefined,
      })),
    }
  }
  return parseItineraryText(text)
}

// ---------------------------------------------------------------------------
// Resolution: names → real places with coordinates inside the city
// ---------------------------------------------------------------------------

const VISIT_MINUTES_BY_CATEGORY: Record<string, number> = {
  museo: 60, catedral: 30, palacio: 40, castillo: 45, convento: 25, iglesia: 15, mercado: 30,
  jardín: 25, plaza: 10, puente: 10, fuente: 5, monumento: 10, mirador: 10, torre: 20, teatro: 15,
}

export async function resolveStop(stop: ItineraryStop, city: City, lang: Language, routeType: RouteType = 'imprescindibles'): Promise<POI | null> {
  const names = [...new Set([stop.searchName, stop.name].filter((n): n is string => !!n && n.trim().length >= 2))]
  for (const name of names) {
    const poi = await searchPOIByName(name, city, routeType, lang)
    if (poi) {
      return {
        ...poi,
        shortDescription: stop.notes || poi.shortDescription,
        estimatedVisitMinutes: stop.visitMinutes ?? VISIT_MINUTES_BY_CATEGORY[poi.category] ?? 20,
        tags: {
          ...(poi.tags || {}),
          ...(stop.notes ? { userNotes: stop.notes } : {}),
          textName: stop.name,
        },
      }
    }
  }
  return null
}

/** Runs an async mapper over items with limited concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

/** Resolves all stops with limited concurrency, reporting each result as soon as it is known. */
export async function resolveStops(
  stops: ItineraryStop[],
  city: City,
  lang: Language,
  onResult: (index: number, poi: POI | null) => void
): Promise<Array<POI | null>> {
  return mapWithConcurrency(stops, 3, async (stop, i) => {
    const poi = await resolveStop(stop, city, lang).catch(() => null)
    onResult(i, poi)
    return poi
  })
}

// ---------------------------------------------------------------------------
// Route building
// ---------------------------------------------------------------------------

const DURATIONS: RouteDuration[] = [60, 120, 180, 240, 480]

export async function buildRouteFromPOIs(
  pois: POI[],
  city: City,
  opts: { lang: Language; title?: string; intro?: string; keepOrder: boolean }
): Promise<Route> {
  // De-duplicate places that two different stop names resolved to
  const unique = pois.filter((p, i) => pois.findIndex(q => q.id === p.id) === i)
  const ordered = opts.keepOrder ? unique : orderPOIsOptimally(unique)
  const { segments, totalDistance, totalDuration } = await buildRouteSegments(ordered, opts.lang)

  const visitMinutes = ordered.reduce((sum, p) => sum + (p.estimatedVisitMinutes ?? 20), 0)
  const totalMinutes = visitMinutes + totalDuration / 60
  const duration = DURATIONS.find(d => d >= totalMinutes) ?? 480

  return {
    id: `${city.id}-texto-${Date.now()}`,
    city,
    routeType: 'imprescindibles',
    duration,
    pois: ordered,
    segments,
    totalDistance,
    totalDuration,
    createdAt: new Date().toISOString(),
    language: opts.lang,
    isOffline: false,
    story: opts.intro,
    title: opts.title,
    preserveOrder: opts.keepOrder,
  }
}
