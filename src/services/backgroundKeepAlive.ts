// ---------------------------------------------------------------------------
// Background keep-alive: keeps audio + TTS guidance running when the screen is
// off or the app is in the background.
//
// Two complementary techniques are used:
//
// 1. **Screen Wake Lock API** (`navigator.wakeLock`): prevents the screen from
//    turning off during an active route. Many mobile browsers release the wake
//    lock when the page becomes hidden (tab switch / screen off), so we
//    re-acquire it on `visibilitychange`.
//
// 2. **Silent looping audio element**: a tiny inaudible loop tied to
//    MediaSession. As long as a `<audio>` element with audible media is
//    playing, the page is treated as "playing media" and the OS will not
//    suspend timers, the speech-synthesis queue, or geolocation watchers
//    when the screen turns off or the user switches apps. This is the
//    standard workaround used by NoSleep.js and is required because the
//    Web Speech API otherwise stops as soon as the page becomes hidden on
//    Chrome / Safari mobile.
// ---------------------------------------------------------------------------

interface WakeLockSentinelLike {
  release: () => Promise<void>
  released?: boolean
  addEventListener?: (type: 'release', cb: () => void) => void
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

let wakeLock: WakeLockSentinelLike | null = null
let silentAudio: HTMLAudioElement | null = null
let visibilityHandler: (() => void) | null = null
let active = false

// 1-second silent WAV loop, encoded as a data URI to avoid an extra network
// request. RIFF / 44.1 kHz / mono / 16-bit / a single block of zero samples.
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

function getSilentAudio(): HTMLAudioElement {
  if (silentAudio) return silentAudio
  const a = document.createElement('audio')
  a.src = SILENT_WAV_DATA_URI
  a.loop = true
  a.preload = 'auto'
  a.volume = 0.001 // effectively silent but non-zero so the page is treated as "playing"
  a.setAttribute('playsinline', '') // iOS: don't open native player UI
  a.style.display = 'none'
  document.body.appendChild(a)
  silentAudio = a
  return a
}

async function requestWakeLock(): Promise<void> {
  const nav = navigator as NavigatorWithWakeLock
  if (!nav.wakeLock) return
  if (wakeLock && !wakeLock.released) return
  try {
    wakeLock = await nav.wakeLock.request('screen')
    wakeLock.addEventListener?.('release', () => {
      // Sentinel auto-released (typically because the page became hidden).
      // We will re-acquire on visibilitychange.
      wakeLock = null
    })
  } catch {
    /* not supported, denied, or document not visible — ignore */
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release()
  } catch { /* ignore */ }
  wakeLock = null
}

/**
 * Begin keeping the device awake and the page foregrounded for media purposes.
 * Safe to call repeatedly; idempotent.
 *
 * MUST be called from within a user gesture (button click) for the silent
 * audio loop to start on iOS / Safari.
 */
export async function startKeepAlive(): Promise<void> {
  if (active) {
    // Even if active, re-request wake lock if it was released
    await requestWakeLock()
    return
  }
  active = true

  // Start silent audio loop (must be from a user gesture on iOS)
  const audio = getSilentAudio()
  try {
    await audio.play()
  } catch { /* user gesture missing — will retry on next call */ }

  // Acquire wake lock
  await requestWakeLock()

  // Re-acquire wake lock and resume silent audio when page becomes visible
  // again (browser releases the sentinel on tab switch / screen off).
  visibilityHandler = () => {
    if (!active) return
    if (document.visibilityState === 'visible') {
      requestWakeLock()
      const a = silentAudio
      if (a && a.paused) a.play().catch(() => {})
    }
  }
  document.addEventListener('visibilitychange', visibilityHandler)
}

/** Stop the keep-alive loop and release all resources. */
export async function stopKeepAlive(): Promise<void> {
  if (!active) return
  active = false
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  if (silentAudio) {
    try { silentAudio.pause() } catch { /* ignore */ }
    silentAudio.remove()
    silentAudio = null
  }
  await releaseWakeLock()
}

/** True if keep-alive is currently active. */
export function isKeepAliveActive(): boolean { return active }
