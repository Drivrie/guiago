// ---------------------------------------------------------------------------
// Narration service — builds, caches and prefetches POI audio scripts.
//
// A professional audio guide never makes the visitor wait at the stop while
// the narration "loads". This module makes arrivals instant:
//  1. Generated scripts are persisted in IndexedDB (saveAudioScript), so a
//     replay or a revisit costs zero network.
//  2. prefetchNarration() lets the route screen pre-generate the NEXT stop's
//     narration in the background while the user is still walking.
//  3. In-flight de-duplication: if the user arrives while the prefetch is
//     still running, both callers await the same promise — no double work.
// ---------------------------------------------------------------------------

import { getPOIDescription, generateAudioScript } from './wikipedia'
import { getAudioScript, saveAudioScript } from './storage'
import { generateAIAudioScript, hasAIKey, getAIKey } from './ai'
import type { POI, Language } from '../types'

const inFlight = new Map<string, Promise<string>>()

function flightKey(poi: POI, lang: Language): string {
  return `${poi.id}|${lang}`
}

/**
 * Returns the narration script for a POI: persistent cache → in-flight
 * promise → fresh generation (Wikipedia+Wikivoyage context → AI narration →
 * template fallback). Generated scripts are persisted for replays/offline.
 */
export async function buildNarration(poi: POI, lang: Language, userKey: string): Promise<string> {
  const cached = await getAudioScript(poi.id, lang).catch(() => null)
  if (cached) return cached

  const key = flightKey(poi, lang)
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const desc = await getPOIDescription(poi.name, lang)

    let script: string | null = null
    if (hasAIKey(userKey)) {
      script = await generateAIAudioScript(
        poi.name,
        poi.category,
        desc || '',
        poi.shortDescription || '',
        poi.tags?.['insiderTip'] || undefined,
        lang,
        getAIKey(userKey),
        poi.routeType,
      )
    }
    if (!script) {
      script = generateAudioScript(
        {
          name: poi.name,
          category: poi.category,
          description: desc || undefined,
          insiderTip: poi.tags?.['insiderTip'] || undefined,
        },
        lang
      )
    }

    await saveAudioScript(poi.id, script, lang).catch(() => { /* cache is best-effort */ })
    return script
  })().finally(() => inFlight.delete(key))

  inFlight.set(key, promise)
  return promise
}

/**
 * Fire-and-forget background pre-generation. Call with the NEXT stop while
 * the user walks to it — by the time they arrive, the narration is already
 * in IndexedDB and plays instantly.
 */
export function prefetchNarration(poi: POI | undefined, lang: Language, userKey: string): void {
  if (!poi) return
  buildNarration(poi, lang, userKey).catch(() => { /* prefetch is best-effort */ })
}
