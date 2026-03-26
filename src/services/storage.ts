import { openDB, type IDBPDatabase } from 'idb'
import type { Route } from '../types'

const DB_NAME = 'guiago-db'
const DB_VERSION = 1

const STORES = {
  ROUTES: 'routes',
  AUDIO_SCRIPTS: 'audio_scripts',
  POI_DESCRIPTIONS: 'poi_descriptions',
  CITY_DATA: 'city_data'
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
    db.clear(STORES.CITY_DATA)
  ])
}

export function estimateRouteStorage(poisCount: number): number {
  // Rough estimate: ~50KB per POI (description + audio script + metadata)
  return poisCount * 50 * 1024
}
