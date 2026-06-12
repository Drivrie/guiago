// ---------------------------------------------------------------------------
// Wikimedia Commons — multiple photos per POI.
//
// A single Wikipedia thumbnail undersells most landmarks. Commons geosearch
// returns photos taken AT the POI's coordinates (facades, interiors, details,
// different seasons) — the same gallery experience commercial guides offer.
// ---------------------------------------------------------------------------

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

export interface CommonsImage {
  url: string
  thumbUrl: string
  title: string
}

const cache = new Map<string, CommonsImage[]>()

/**
 * Photos geotagged within `radiusM` of the POI. Best-effort: returns [] on
 * any failure. Results cached in-memory per session (galleries are small).
 */
export async function fetchNearbyImages(
  lat: number,
  lon: number,
  limit: number = 8,
  radiusM: number = 120,
): Promise<CommonsImage[]> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
  const cached = cache.get(key)
  if (cached) return cached
  try {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'geosearch',
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(radiusM),
      ggslimit: String(limit * 2), // overfetch: some hits aren't photos
      ggsnamespace: '6',           // File: namespace
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '640',
      format: 'json',
      origin: '*',
    })
    const resp = await fetch(`${COMMONS_API}?${params}`)
    if (!resp.ok) return []
    const data = await resp.json() as {
      query?: {
        pages?: Record<string, {
          title?: string
          imageinfo?: Array<{ url?: string; thumburl?: string }>
        }>
      }
    }
    const out: CommonsImage[] = []
    for (const page of Object.values(data.query?.pages || {})) {
      const info = page.imageinfo?.[0]
      if (!info?.url || !/\.(jpe?g|png|webp)$/i.test(info.url)) continue
      out.push({
        url: info.url,
        thumbUrl: info.thumburl || info.url,
        title: (page.title || '').replace(/^File:/, '').replace(/\.\w+$/, ''),
      })
      if (out.length >= limit) break
    }
    cache.set(key, out)
    return out
  } catch {
    return []
  }
}
