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
