// ---------------------------------------------------------------------------
// Nearby POIs — multi-source discovery list for "¿Qué hay donde estoy ahora?"
//
// The old implementation took the FIRST Wikipedia geosearch hit in ONE
// language. Routes meanwhile search es + local-country + en Wikipedias with
// hundreds of results — which is why "what's here" missed places that route
// generation later surfaced. This module brings the same multi-source rigor
// to the discovery flow:
//
//   1. Wikipedia geosearch in app language + the country's local language +
//      English (a town in Poland mostly exists on pl.wikipedia).
//   2. OpenStreetMap / Overpass for places Wikipedia doesn't cover at all
//      (markets, viewpoints, historic cafés, street art…).
//
// Results are merged, deduped by name/position and sorted by distance, so
// the user sees an actual LIST of what's around them, not a single guess.
// ---------------------------------------------------------------------------

import { searchPOIsNearby } from './overpass'
import { wikiLangForCountry } from './wikigeo'
import type { Language } from '../types'

export interface NearbyPlace {
  name: string
  lat: number
  lon: number
  distanceM: number
  category: string
  imageUrl?: string
  description?: string
  source: 'wikipedia' | 'osm'
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Single-language MediaWiki geosearch with thumbnails + short descriptions.
 *  Works for both Wikipedia and Wikivoyage (same API shape). Wikivoyage's
 *  geo-tagged pages are PURE travel listings — exactly the tourist-guide
 *  perspective the discovery list needs. */
async function mediaWikiNearby(
  lat: number, lon: number, radiusM: number, host: string
): Promise<NearbyPlace[]> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'geosearch',
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(Math.min(10000, radiusM)),
      ggslimit: '25',
      prop: 'extracts|pageimages|coordinates',
      exintro: 'true',
      exchars: '200',
      explaintext: 'true',
      pithumbsize: '300',
      colimit: '1',
      format: 'json',
      origin: '*',
    })
    const resp = await fetch(`https://${host}/w/api.php?${params}`)
    if (!resp.ok) return []
    const data = await resp.json() as {
      query?: {
        pages?: Record<string, {
          title?: string
          extract?: string
          thumbnail?: { source?: string }
          coordinates?: Array<{ lat: number; lon: number }>
        }>
      }
    }
    const out: NearbyPlace[] = []
    for (const page of Object.values(data.query?.pages || {})) {
      const coords = page.coordinates?.[0]
      if (!page.title || !coords) continue
      out.push({
        name: page.title,
        lat: coords.lat,
        lon: coords.lon,
        distanceM: Math.round(haversineM(lat, lon, coords.lat, coords.lon)),
        category: 'wikipedia',
        imageUrl: page.thumbnail?.source,
        description: page.extract?.trim() || undefined,
        source: 'wikipedia',
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Multi-source nearby search. `countryCode` activates the local-language
 * Wikipedia (the most common reason locally-famous POIs were missing).
 */
export async function findNearbyPlaces(
  lat: number,
  lon: number,
  lang: Language,
  countryCode?: string,
  radiusM: number = 800,
): Promise<NearbyPlace[]> {
  const langs = [lang === 'es' ? 'es' : 'en']
  const local = wikiLangForCountry(countryCode)
  if (local && !langs.includes(local)) langs.push(local)
  if (!langs.includes('en')) langs.push('en')

  const [wikiLists, voyageLists, osmList] = await Promise.all([
    Promise.all(langs.map(l => mediaWikiNearby(lat, lon, radiusM, `${l}.wikipedia.org`))),
    // Wikivoyage: only the app language + English exist with useful coverage.
    Promise.all([lang === 'es' ? 'es' : 'en', 'en']
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map(l => mediaWikiNearby(lat, lon, radiusM, `${l}.wikivoyage.org`))),
    searchPOIsNearby(lat, lon, radiusM).catch(() => []),
  ])

  // Merge: Wikipedia entries first (richer), dedupe by rounded position AND
  // by case-insensitive name. OSM entries fill in what Wikipedia missed.
  const seenPos = new Set<string>()
  const seenName = new Set<string>()
  const merged: NearbyPlace[] = []

  const pushUnique = (p: NearbyPlace) => {
    const posKey = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`
    const nameKey = p.name.toLowerCase().trim()
    if (seenPos.has(posKey) || seenName.has(nameKey)) {
      // Backfill image/description onto the existing entry when available.
      const existing = merged.find(m =>
        `${m.lat.toFixed(4)},${m.lon.toFixed(4)}` === posKey || m.name.toLowerCase().trim() === nameKey)
      if (existing) {
        existing.imageUrl = existing.imageUrl || p.imageUrl
        existing.description = existing.description || p.description
      }
      return
    }
    seenPos.add(posKey)
    seenName.add(nameKey)
    merged.push(p)
  }

  for (const list of wikiLists) for (const p of list) pushUnique(p)
  for (const list of voyageLists) for (const p of list) pushUnique(p)

  // Defensive business filter: even with the tightened Overpass query, any
  // plain food/retail entry that sneaks in (e.g. via a wikipedia tag on a
  // franchise) is dropped — the discovery list is a TOURIST guide, not a
  // directory of places to eat.
  const BUSINESS_RE = /restaurante?|cafeter[ií]a|cafe\b|bar\b|pub\b|fast_food|food_court|supermercado|supermarket|tienda|shop|hotel|hostal|hostel|farmacia|pharmacy|banco|bank\b/i
  for (const p of osmList) {
    if (BUSINESS_RE.test(p.category) || BUSINESS_RE.test(p.name)) continue
    pushUnique({
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      distanceM: Math.round(haversineM(lat, lon, p.lat, p.lon)),
      category: p.category,
      source: 'osm',
    })
  }

  merged.sort((a, b) => a.distanceM - b.distanceM)
  return merged.slice(0, 20)
}
