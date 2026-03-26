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
