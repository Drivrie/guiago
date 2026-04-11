// GuiAgo Service Worker
const CACHE_NAME = 'guiago-v3'
const TILE_CACHE = 'osm-tiles-v1'
const API_CACHE = 'api-v3'

const STATIC_ASSETS = [
  '/guiago/',
  '/guiago/index.html',
  '/guiago/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE && k !== API_CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // OSM tiles - cache first (tiles rarely change)
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone())
            return response
          })
        })
      )
    )
    return
  }

  // Wikipedia/Nominatim/Overpass - network first with cache fallback
  if (
    url.hostname.includes('wikipedia.org') ||
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('overpass-api.de')
  ) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(API_CACHE).then(cache => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
    return
  }

  // index.html - always network first so users get the latest app version
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
    return
  }

  // JS/CSS assets have hashed filenames - cache first (they never change once deployed)
  if (event.request.destination === 'script' || event.request.destination === 'style') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached
        return fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()))
          }
          return response
        })
      })
    )
  }
})

