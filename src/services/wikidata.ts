// ---------------------------------------------------------------------------
// Wikidata helper — fame signal for POIs
//
// Each Wikipedia article maps to a Wikidata entity (a QID). The number of
// language editions that link to the entity (`sitelinks`) is the best
// machine-readable proxy for an entity's worldwide fame: the Eiffel Tower has
// 200+ sitelinks; a neighbourhood chapel typically has 1-3.
//
// We use this to re-rank Wikipedia geosearch candidates so the route picks
// the most internationally renowned landmarks (Lonely Planet / National
// Geographic tier), not just the first Wikipedia result that happens to
// match the route-type keywords.
// ---------------------------------------------------------------------------

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'

/**
 * Fetch sitelinks counts for a batch of QIDs. Returns a map QID → sitelinks
 * count. Missing QIDs are absent from the map. Best-effort: network errors
 * never throw — they just yield an empty/partial map so route generation
 * keeps working without the fame signal.
 */
export async function fetchSitelinksCounts(qids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (qids.length === 0) return map

  // wbgetentities accepts up to 50 ids per call.
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50)
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'sitelinks',
      format: 'json',
      origin: '*',
    })
    try {
      const resp = await fetch(`${WIKIDATA_API}?${params}`)
      if (!resp.ok) continue
      const data = await resp.json() as {
        entities?: Record<string, { sitelinks?: Record<string, unknown> }>
      }
      for (const [qid, entity] of Object.entries(data.entities || {})) {
        const count = entity?.sitelinks ? Object.keys(entity.sitelinks).length : 0
        if (count > 0) map.set(qid, count)
      }
    } catch (err) {
      console.warn('[wikidata] sitelinks fetch failed:', err)
    }
  }
  return map
}
