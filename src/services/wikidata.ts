/**
 * Wikidata enrichment service.
 *
 * Fetches structured facts (architect, year, style, UNESCO status, height,
 * official site) for a POI when a Wikidata QID is available — either directly
 * from OSM tags (`wikidata=Q...`) or by following the Wikipedia article's
 * sitelink.
 *
 * These facts are then injected into the AI narration prompt and surfaced in
 * the POI detail view, turning generic descriptions ("Es una iglesia
 * histórica") into specific ones ("Iglesia gótica del siglo XIV diseñada por
 * Pierre de Montreuil, en la lista del Patrimonio Mundial").
 */

import type { Language } from '../types'
import { getCachedWikidataFacts, saveWikidataFacts } from './storage'

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'

/** Structured tourist facts derived from Wikidata claims. */
export interface POIFacts {
  qid?: string
  /** Year of inception/construction (P571), as a 4-digit string. */
  inceptionYear?: string
  /** Architect names (P84). */
  architects?: string[]
  /** Architectural style label (P149). */
  style?: string
  /** True if the POI itself or its parent is a UNESCO World Heritage Site (P1435 or P3259). */
  isUnesco?: boolean
  /** Building height in metres (P2048). */
  heightMeters?: number
  /** Official website URL (P856). */
  officialWebsite?: string
  /** Designation / heritage status label, e.g. "Bien de Interés Cultural". */
  heritageStatus?: string
}

interface SitelinkResponse {
  query?: {
    pages?: Record<string, {
      pageprops?: { wikibase_item?: string }
    }>
  }
}

/**
 * Look up the Wikidata QID for a Wikipedia article title.
 * Single round-trip; returns null on miss.
 */
export async function getQidFromWikipedia(
  wikipediaTitle: string,
  lang: Language = 'es'
): Promise<string | null> {
  try {
    const apiBase = `https://${lang === 'es' ? 'es' : 'en'}.wikipedia.org/w/api.php`
    const params = new URLSearchParams({
      action: 'query',
      titles: wikipediaTitle,
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      format: 'json',
      origin: '*',
    })
    const resp = await fetch(`${apiBase}?${params}`)
    if (!resp.ok) return null
    const data = (await resp.json()) as SitelinkResponse
    const pages = data.query?.pages
    if (!pages) return null
    const page = Object.values(pages)[0]
    return page?.pageprops?.wikibase_item || null
  } catch {
    return null
  }
}

interface WikidataEntityResponse {
  entities?: Record<string, {
    claims?: Record<string, Array<{
      mainsnak?: {
        datavalue?: {
          type?: string
          value?: unknown
        }
      }
    }>>
    sitelinks?: Record<string, { title?: string }>
  }>
}

interface WikidataLabelResponse {
  entities?: Record<string, {
    labels?: Record<string, { value?: string }>
  }>
}

/** Resolve a list of QIDs to their human-readable labels in the target language. */
async function labelsForQids(qids: string[], lang: Language): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (qids.length === 0) return out
  const unique = Array.from(new Set(qids)).slice(0, 50) // API limit
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: unique.join('|'),
    props: 'labels',
    languages: `${lang}|en`,
    format: 'json',
    origin: '*',
  })
  try {
    const resp = await fetch(`${WIKIDATA_API}?${params}`)
    if (!resp.ok) return out
    const data = (await resp.json()) as WikidataLabelResponse
    const entities = data.entities || {}
    for (const qid of unique) {
      const labels = entities[qid]?.labels
      const label = labels?.[lang]?.value || labels?.en?.value
      if (label) out.set(qid, label)
    }
  } catch { /* tolerate network errors silently */ }
  return out
}

/**
 * Fetch structured facts for a POI from Wikidata.
 *
 * Cache layer: IndexedDB (30-day TTL) via `storage.ts`. POIs viewed more than
 * once in the same city, or across offline-first sessions, skip the network
 * round-trip entirely — typical POI load goes from ~300 ms to <5 ms.
 *
 * Returns null when the QID cannot be resolved or the entity has no relevant
 * claims — caller should treat absence as "no enrichment available".
 */
export async function getPOIFacts(qid: string, lang: Language = 'es'): Promise<POIFacts | null> {
  if (!qid?.startsWith('Q')) return null
  // 1. Cache first
  const cached = await getCachedWikidataFacts<POIFacts>(qid, lang)
  if (cached) return cached
  try {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: qid,
      props: 'claims',
      format: 'json',
      origin: '*',
    })
    const resp = await fetch(`${WIKIDATA_API}?${params}`)
    if (!resp.ok) return null
    const data = (await resp.json()) as WikidataEntityResponse
    const entity = data.entities?.[qid]
    if (!entity?.claims) return null
    const claims = entity.claims

    const facts: POIFacts = { qid }

    // P571 — inception (date)
    const inception = claims.P571?.[0]?.mainsnak?.datavalue?.value as { time?: string } | undefined
    if (inception?.time) {
      const m = inception.time.match(/(\+|-)(\d{4})/)
      if (m) facts.inceptionYear = m[2]
    }

    // P84 — architect (entity refs)
    const architectQids: string[] = (claims.P84 || [])
      .map(c => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id)
      .filter((q): q is string => !!q)

    // P149 — architectural style (entity ref)
    const styleQid = (claims.P149?.[0]?.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id

    // P856 — official website (URL string)
    const websiteRaw = claims.P856?.[0]?.mainsnak?.datavalue?.value
    if (typeof websiteRaw === 'string') facts.officialWebsite = websiteRaw

    // P2048 — height (quantity)
    const heightRaw = claims.P2048?.[0]?.mainsnak?.datavalue?.value as { amount?: string } | undefined
    if (heightRaw?.amount) {
      const n = parseFloat(heightRaw.amount)
      if (!isNaN(n) && n > 0) facts.heightMeters = n
    }

    // P1435 — heritage designation (entity ref). UNESCO World Heritage Site = Q9259
    const heritageQids: string[] = (claims.P1435 || [])
      .map(c => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id)
      .filter((q): q is string => !!q)
    facts.isUnesco = heritageQids.includes('Q9259') || !!claims.P3259  // P3259 = part of WHS

    // Resolve labels in batch for entity-ref properties
    const allRefs = [...architectQids, ...heritageQids, ...(styleQid ? [styleQid] : [])]
    if (allRefs.length > 0) {
      const labels = await labelsForQids(allRefs, lang)
      facts.architects = architectQids.map(q => labels.get(q)).filter((s): s is string => !!s)
      if (styleQid) facts.style = labels.get(styleQid)
      // First non-UNESCO heritage label as the human-readable status
      const heritageLabel = heritageQids
        .filter(q => q !== 'Q9259')
        .map(q => labels.get(q))
        .find((s): s is string => !!s)
      if (heritageLabel) facts.heritageStatus = heritageLabel
    }

    // Return null only if we have *nothing* useful; otherwise cache and return
    const hasContent =
      facts.inceptionYear || facts.architects?.length || facts.style ||
      facts.isUnesco || facts.heightMeters || facts.officialWebsite || facts.heritageStatus
    if (!hasContent) return null
    // Fire-and-forget cache write — we don't want to block the caller on IDB.
    saveWikidataFacts(qid, facts, lang).catch(() => { /* tolerate quota errors */ })
    return facts
  } catch (err) {
    console.warn('Wikidata fetch failed:', err)
    return null
  }
}

/**
 * Format a POIFacts object as a compact "factsheet" string suitable for
 * injection into an AI prompt or for display under the POI title.
 *
 * Example output (es):
 *   "Construido en 1882 · Arquitecto: Antoni Gaudí · Estilo: modernismo
 *    catalán · 172 m · Patrimonio de la Humanidad de la UNESCO"
 */
export function formatFactsheet(facts: POIFacts, lang: Language = 'es'): string {
  const parts: string[] = []
  const isEs = lang === 'es'

  if (facts.inceptionYear) {
    parts.push(isEs ? `Construido en ${facts.inceptionYear}` : `Built in ${facts.inceptionYear}`)
  }
  if (facts.architects?.length) {
    const label = isEs ? 'Arquitecto' : 'Architect'
    parts.push(`${label}: ${facts.architects.slice(0, 2).join(', ')}`)
  }
  if (facts.style) {
    parts.push(isEs ? `Estilo: ${facts.style}` : `Style: ${facts.style}`)
  }
  if (facts.heightMeters) {
    parts.push(`${Math.round(facts.heightMeters)} m`)
  }
  if (facts.isUnesco) {
    parts.push(isEs ? 'Patrimonio de la Humanidad de la UNESCO' : 'UNESCO World Heritage Site')
  } else if (facts.heritageStatus) {
    parts.push(facts.heritageStatus)
  }

  return parts.join(' · ')
}
