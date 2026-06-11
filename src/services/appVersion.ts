// ---------------------------------------------------------------------------
// App version + update detection
//
// The git short SHA + build date are injected at build time by Vite, so the
// running PWA can show users which version they have ("c075271 · 11 Jun
// 2026 13:37") and detect when a newer one has been deployed.
//
// Detection works by fetching `index.html` with a cache-bust query string and
// reading the `<meta name="app-version">` tag injected at build time. If the
// fetched value differs from __APP_VERSION__, a newer build is live.
// ---------------------------------------------------------------------------

export const APP_VERSION: string = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev')
export const APP_BUILD_DATE: string = (typeof __APP_BUILD_DATE__ !== 'undefined' ? __APP_BUILD_DATE__ : '')

/** Human-friendly build date in the user's locale ("11 jun 2026, 13:37"). */
export function formatBuildDate(lang: 'es' | 'en' = 'es'): string {
  if (!APP_BUILD_DATE) return ''
  try {
    const d = new Date(APP_BUILD_DATE)
    return d.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return APP_BUILD_DATE }
}

/**
 * Returns the version string from the server's currently deployed index.html
 * (parsed from the `<meta name="app-version">` tag), bypassing the service
 * worker / HTTP cache. Returns null on network error.
 */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const url = `${import.meta.env.BASE_URL || '/'}index.html?cb=${Date.now()}`
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) return null
    const html = await resp.text()
    const m = html.match(/<meta\s+name="app-version"\s+content="([^"]+)"/i)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

/** True when the server is serving a newer build than the running app. */
export async function isUpdateAvailable(): Promise<boolean> {
  const latest = await fetchLatestVersion()
  return !!latest && latest !== APP_VERSION
}

/**
 * Force a clean reload: unregister the service worker, delete its caches and
 * navigate so the next page load fetches a completely fresh app. Used by the
 * "Buscar actualizaciones" button so users never get stuck on an old build.
 */
export async function forceUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      // Wipe everything app-related; tile / API caches will refill on demand.
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch (err) {
    console.warn('[appVersion] cache wipe failed:', err)
  }
  // Cache-busted reload (avoids any remaining HTTP cache layer).
  const sep = location.href.includes('?') ? '&' : '?'
  location.replace(`${location.href}${sep}__upd=${Date.now()}`)
}
