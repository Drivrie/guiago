/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope
declare const __WB_MANIFEST: { url: string; revision: string | null }[]

const CACHE_NAME = 'guiago-v1'
const TILE_CACHE = 'osm-tiles-v1'
const API_CACHE = 'api-cache-v1'

const precacheAssets = __WB_MANIFEST.map(entry => entry.url)

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(precacheAssets.filter(url => !url.includes('*'))))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![CACHE_NAME, TILE_CACHE, API_CACHE].includes(k)).map(k => caches.delete(k)))
    )
  )
  ;(self as ServiceWorkerGlobalScope).clients.claim()
})

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)

  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone())
            return response
          }).catch(() => cached || new Response('', { status: 503 }))
        })
      )
    )
    return
  }

  if (url.hostname.includes('wikipedia.org') || url.hostname.includes('nominatim.openstreetmap.org')) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(API_CACHE).then(c => c.put(event.request, clone))
        }
        return response
      }).catch(() => caches.match(event.request).then(c => c ?? new Response('{}', { headers: { 'Content-Type': 'application/json' } })))
    )
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html').then(c => c ?? new Response('', { status: 503 })))
    )
  }
})
