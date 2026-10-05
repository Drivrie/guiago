import type { City, NominatimResult } from '../types'

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const HEADERS = {
  'User-Agent': 'GuiAgo/1.0 tourist-guide-app (contact@guiago.app)',
  'Accept-Language': 'es,en'
}

function parseNominatimResult(result: NominatimResult): City {
  const address = result.address || {}
  const cityName = address.city || address.town || address.village || result.name
  const country = address.country || ''
  const countryCode = address.country_code?.toUpperCase() || ''

  let boundingBox: [number, number, number, number] | undefined
  if (result.boundingbox && result.boundingbox.length === 4) {
    boundingBox = [
      parseFloat(result.boundingbox[0]),
      parseFloat(result.boundingbox[1]),
      parseFloat(result.boundingbox[2]),
      parseFloat(result.boundingbox[3])
    ]
  }

  return {
    id: String(result.place_id),
    name: cityName,
    displayName: result.display_name,
    country,
    countryCode,
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
    boundingBox,
    wikipediaTitle: cityName
  }
}

export async function searchCities(query: string, lang: string = 'es'): Promise<City[]> {
  if (!query || query.trim().length < 2) return []

  try {
    const params = new URLSearchParams({
      q: query.trim(),
      format: 'json',
      addressdetails: '1',
      limit: '6',
      featuretype: 'city,town',
      'accept-language': lang,
      extratags: '1',
      namedetails: '1'
    })

    const url = `${NOMINATIM_BASE}/search?${params}`
    const response = await fetch(url, {
      headers: { ...HEADERS, 'Accept-Language': lang }
    })

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`)
    }

    const data: NominatimResult[] = await response.json()

    // Filter to only cities/towns/municipalities and remove duplicates
    const seen = new Set<string>()
    const cities: City[] = []

    for (const result of data) {
      if (!['city', 'town', 'village', 'municipality', 'administrative'].includes(result.type) &&
          !['city', 'town', 'village', 'municipality'].includes(result.class)) {
        // Allow administrative places too
        if (result.class !== 'place' && result.class !== 'boundary') continue
      }

      const city = parseNominatimResult(result)
      const key = `${city.name.toLowerCase()}-${city.countryCode}`

      if (!seen.has(key)) {
        seen.add(key)
        cities.push(city)
      }
    }

    return cities
  } catch (error) {
    console.error('Error searching cities:', error)
    return []
  }
}

export async function getCityDetails(lat: number, lon: number): Promise<City | null> {
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'json',
      addressdetails: '1',
      zoom: '10'
    })

    const url = `${NOMINATIM_BASE}/reverse?${params}`
    const response = await fetch(url, { headers: HEADERS })

    if (!response.ok) {
      throw new Error(`Nominatim reverse error: ${response.status}`)
    }

    const data = await response.json()
    if (!data || data.error) return null

    return parseNominatimResult(data as NominatimResult)
  } catch (error) {
    console.error('Error getting city details:', error)
    return null
  }
}

interface OverpassCityElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags: {
    name?: string
    'name:es'?: string
    'name:en'?: string
    place?: string
    population?: string
    capital?: string
    'is_in:country'?: string
    'is_in:country_code'?: string
    wikipedia?: string
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function getFlagEmoji(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return '🏙️'
  const pts = countryCode.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0))
  return String.fromCodePoint(...pts)
}

export async function getNearbyCities(
  lat: number,
  lon: number,
  lang: string = 'es'
): Promise<(City & { distanceKm: number })[]> {
  const query = `[out:json][timeout:15];
(
  node["place"~"^(city)$"]["name"](around:500000,${lat},${lon});
  node["place"~"^(town)$"]["name"](around:150000,${lat},${lon});
);
out tags 80;`

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`
  })

  if (!response.ok) throw new Error(`Overpass error: ${response.status}`)

  const data = await response.json()
  const elements: OverpassCityElement[] = data.elements || []

  const withMeta = elements
    .filter(el => {
      const elLat = el.lat ?? el.center?.lat
      const elLon = el.lon ?? el.center?.lon
      return elLat !== undefined && elLon !== undefined && el.tags?.name
    })
    .map(el => {
      const elLat = (el.lat ?? el.center?.lat)!
      const elLon = (el.lon ?? el.center?.lon)!
      const distKm = haversineKm(lat, lon, elLat, elLon)
      const pop = parseInt(el.tags.population || '0', 10)
      const isCapital = el.tags.capital === 'yes' || el.tags.capital === '4'
      return { el, elLat, elLon, distKm, pop, isCapital }
    })

  // Sort: capitals first, then by population desc
  withMeta.sort((a, b) => {
    if (a.isCapital && !b.isCapital) return -1
    if (!a.isCapital && b.isCapital) return 1
    return b.pop - a.pop
  })

  const seen = new Set<string>()
  const cities: (City & { distanceKm: number })[] = []

  for (const { el, elLat, elLon, distKm } of withMeta) {
    const name = (lang === 'es' ? el.tags['name:es'] : el.tags['name:en']) || el.tags.name || ''
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const countryCode = el.tags['is_in:country_code']?.toUpperCase() || ''
    const country = el.tags['is_in:country'] || ''

    cities.push({
      id: String(el.id),
      name,
      displayName: name,
      country,
      countryCode,
      lat: elLat,
      lon: elLon,
      population: parseInt(el.tags.population || '0', 10) || undefined,
      wikipediaTitle: el.tags.wikipedia?.split(':').slice(1).join(':') || name,
      distanceKm: Math.round(distKm)
    })

    if (cities.length >= 9) break
  }

  return cities
}

export async function getCityImageUrl(cityName: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: cityName,
      prop: 'pageimages',
      format: 'json',
      pithumbsize: '800',
      origin: '*'
    })

    const url = `https://es.wikipedia.org/w/api.php?${params}`
    const response = await fetch(url)

    if (!response.ok) return null

    const data = await response.json()
    const pages = data?.query?.pages
    if (!pages) return null

    const page = Object.values(pages)[0] as { thumbnail?: { source?: string } }
    return page?.thumbnail?.source || null
  } catch {
    return null
  }
}

// Nominatim usage policy: max 1 request per second. Calls reserve consecutive slots.
let nextNominatimSlot = 0
async function nominatimThrottle(): Promise<void> {
  const slot = Math.max(Date.now(), nextNominatimSlot)
  nextNominatimSlot = slot + 1100
  const wait = slot - Date.now()
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
}

export interface NominatimPlace {
  id: string
  name: string
  lat: number
  lon: number
  category: string
  type: string
  extratags: Record<string, string>
}

function cityViewbox(city: City): string {
  if (city.boundingBox) {
    const [minLat, maxLat, minLon, maxLon] = city.boundingBox
    const latPad = Math.max((maxLat - minLat) * 0.25, 0.01)
    const lonPad = Math.max((maxLon - minLon) * 0.25, 0.01)
    return `${minLon - lonPad},${maxLat + latPad},${maxLon + lonPad},${minLat - latPad}`
  }
  const pad = 0.08
  return `${city.lon - pad},${city.lat + pad},${city.lon + pad},${city.lat - pad}`
}

/**
 * Finds a named place (monument, church, restaurant, square…) inside a city using OSM data.
 * Covers places that have no Wikipedia article. Results are restricted to the city's area.
 */
export async function searchPlaceInCity(
  name: string,
  city: City,
  lang: string = 'es'
): Promise<NominatimPlace | null> {
  const query = name.trim()
  if (query.length < 2) return null
  try {
    await nominatimThrottle()
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '5',
      viewbox: cityViewbox(city),
      bounded: '1',
      extratags: '1',
      'accept-language': lang,
    })
    const resp = await fetch(`${NOMINATIM_BASE}/search?${params}`)
    if (!resp.ok) return null
    const data = await resp.json() as Array<{
      osm_type?: string; osm_id?: number
      name?: string; display_name: string; lat: string; lon: string
      category?: string; type?: string; importance?: number
      extratags?: Record<string, string> | null
    }>
    // Skip whole administrative areas / streets when a proper place exists
    const ranked = data
      .filter(r => r.category !== 'boundary' && r.category !== 'place')
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    const best = ranked[0] ?? data.find(r => r.category === 'place' && r.type !== 'city' && r.type !== 'town')
    if (!best) return null
    return {
      id: `osm-${best.osm_type || 'x'}-${best.osm_id ?? `${best.lat},${best.lon}`}`,
      name: best.name || best.display_name.split(',')[0],
      lat: parseFloat(best.lat),
      lon: parseFloat(best.lon),
      category: best.category || '',
      type: best.type || '',
      extratags: best.extratags || {},
    }
  } catch {
    return null
  }
}

