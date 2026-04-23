import { openDB, type IDBPDatabase } from 'idb'
import type { Route } from '../types'

const DB_NAME = 'guiago-db'
// v2 adds the `wikidata_facts` store for structured POI enrichment caching
// (architect, year, style, UNESCO status…). Keyed by `${qid}-${lang}` so we
// share cache entries for the same Wikidata entity across cities.
const DB_VERSION = 2

const STORES = {
  ROUTES: 'routes',
  AUDIO_SCRIPTS: 'audio_scripts',
  POI_DESCRIPTIONS: 'poi_descriptions',
  CITY_DATA: 'city_data',
  WIKIDATA_FACTS: 'wikidata_facts'
} as const

type GuiAgoDBSchema = {
  routes: {
    key: string
    value: Route
  }
  audio_scripts: {
    key: string
    value: { id: string; text: string; lang: string; createdAt: string }
  }
  poi_descriptions: {
    key: string
    value: { id: string; description: string; lang: string; source: string; updatedAt: string }
  }
  city_data: {
    key: string
    value: { id: string; data: unknown; updatedAt: string }
  }
  wikidata_facts: {
    key: string
    value: { id: string; facts: unknown; lang: string; fetchedAt: string }
  }
}

let dbInstance: IDBPDatabase<GuiAgoDBSchema> | null = null

async function getDB(): Promise<IDBPDatabase<GuiAgoDBSchema>> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB<GuiAgoDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Routes store
      if (!db.objectStoreNames.contains(STORES.ROUTES)) {
        db.createObjectStore(STORES.ROUTES, { keyPath: 'id' })
      }

      // Audio scripts store
      if (!db.objectStoreNames.contains(STORES.AUDIO_SCRIPTS)) {
        db.createObjectStore(STORES.AUDIO_SCRIPTS, { keyPath: 'id' })
      }

      // POI descriptions store
      if (!db.objectStoreNames.contains(STORES.POI_DESCRIPTIONS)) {
        db.createObjectStore(STORES.POI_DESCRIPTIONS, { keyPath: 'id' })
      }

      // City data store
      if (!db.objectStoreNames.contains(STORES.CITY_DATA)) {
        db.createObjectStore(STORES.CITY_DATA, { keyPath: 'id' })
      }

      // Wikidata facts cache (added in v2)
      if (!db.objectStoreNames.contains(STORES.WIKIDATA_FACTS)) {
        db.createObjectStore(STORES.WIKIDATA_FACTS, { keyPath: 'id' })
      }
    }
  })

  return dbInstance
}

// Routes
export async function saveRoute(route: Route): Promise<void> {
  const db = await getDB()
  await db.put(STORES.ROUTES, route)
}

export async function getRoute(id: string): Promise<Route | null> {
  const db = await getDB()
  const route = await db.get(STORES.ROUTES, id)
  return route ?? null
}

export async function getAllRoutes(): Promise<Route[]> {
  const db = await getDB()
  return db.getAll(STORES.ROUTES)
}

export async function deleteRoute(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORES.ROUTES, id)
}

// Audio scripts
export async function saveAudioScript(poiId: string, text: string, lang: string = 'es'): Promise<void> {
  const db = await getDB()
  await db.put(STORES.AUDIO_SCRIPTS, {
    id: `${poiId}-${lang}`,
    text,
    lang,
    createdAt: new Date().toISOString()
  })
}

export async function getAudioScript(poiId: string, lang: string = 'es'): Promise<string | null> {
  const db = await getDB()
  const item = await db.get(STORES.AUDIO_SCRIPTS, `${poiId}-${lang}`)
  return item?.text ?? null
}

export async function deleteAudioScript(poiId: string, lang: string = 'es'): Promise<void> {
  const db = await getDB()
  await db.delete(STORES.AUDIO_SCRIPTS, `${poiId}-${lang}`)
}

// POI descriptions
export async function savePOIDescription(
  poiId: string,
  description: string,
  lang: string = 'es',
  source: string = 'wikipedia'
): Promise<void> {
  const db = await getDB()
  await db.put(STORES.POI_DESCRIPTIONS, {
    id: `${poiId}-${lang}`,
    description,
    lang,
    source,
    updatedAt: new Date().toISOString()
  })
}

export async function getPOIDescription(poiId: string, lang: string = 'es'): Promise<string | null> {
  const db = await getDB()
  const item = await db.get(STORES.POI_DESCRIPTIONS, `${poiId}-${lang}`)
  return item?.description ?? null
}

// City data
export async function saveCityData(cityId: string, data: unknown): Promise<void> {
  const db = await getDB()
  await db.put(STORES.CITY_DATA, {
    id: cityId,
    data,
    updatedAt: new Date().toISOString()
  })
}

export async function getCityData(cityId: string): Promise<unknown> {
  const db = await getDB()
  const item = await db.get(STORES.CITY_DATA, cityId)
  return item?.data ?? null
}

// ---------------------------------------------------------------------------
// Wikidata facts cache
// ---------------------------------------------------------------------------
// TTL: 30 days. Wikidata facts (year built, architect, UNESCO status…) change
// rarely; a month is a good balance between freshness and avoiding repeat
// SPARQL round-trips on every POI load. Stale entries return null so the
// caller refetches transparently.
const WIKIDATA_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function saveWikidataFacts(
  qid: string,
  facts: unknown,
  lang: string = 'es'
): Promise<void> {
  if (!qid) return
  const db = await getDB()
  await db.put(STORES.WIKIDATA_FACTS, {
    id: `${qid}-${lang}`,
    facts,
    lang,
    fetchedAt: new Date().toISOString(),
  })
}

export async function getCachedWikidataFacts<T = unknown>(
  qid: string,
  lang: string = 'es'
): Promise<T | null> {
  if (!qid) return null
  try {
    const db = await getDB()
    const entry = await db.get(STORES.WIKIDATA_FACTS, `${qid}-${lang}`)
    if (!entry) return null
    const age = Date.now() - new Date(entry.fetchedAt).getTime()
    if (age > WIKIDATA_TTL_MS) return null
    return entry.facts as T
  } catch {
    return null
  }
}

// Storage utilities
export async function checkStorageAvailable(): Promise<boolean> {
  try {
    const db = await getDB()
    return !!db
  } catch {
    return false
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null

  try {
    const estimate = await navigator.storage.estimate()
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0
    }
  } catch {
    return null
  }
}

export async function clearAllData(): Promise<void> {
  const db = await getDB()
  await Promise.all([
    db.clear(STORES.ROUTES),
    db.clear(STORES.AUDIO_SCRIPTS),
    db.clear(STORES.POI_DESCRIPTIONS),
    db.clear(STORES.CITY_DATA),
    db.clear(STORES.WIKIDATA_FACTS)
  ])
}

export function estimateRouteStorage(poisCount: number): number {
  // Rough estimate: ~50KB per POI (description + audio script + metadata)
  return poisCount * 50 * 1024
}
