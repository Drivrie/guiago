// ---------------------------------------------------------------------------
// Audio playback layer — plays a sequence of MP3 Blobs through a SINGLE
// <audio> element, with MediaSession metadata.
//
// Why this matters on iPhone:
//   - Web Speech API stops the moment the screen locks; the iOS PWA had no
//     way to keep talking past the lock screen.
//   - An <audio> element playing real MP3 content is treated by iOS as
//     a media session (like Spotify, Apple Music, podcasts): playback
//     continues with the screen off, the app backgrounded, AirPods
//     connected — and the iOS lock-screen / Control Centre shows play /
//     pause controls.
//   - MediaSession metadata makes those controls show the POI title and
//     image so the user knows which stop is being narrated even from
//     the lock screen.
// ---------------------------------------------------------------------------

import type { POI } from '../types'

/** A playable chunk: a fetched Blob (cacheable) or a direct media URL.
 *  Direct URLs matter because some TTS endpoints (Google Translate) don't
 *  send CORS headers — fetch() fails, but <audio src> plays them fine
 *  (media elements are exempt from CORS for playback). */
export type PlayableChunk = Blob | string

let audio: HTMLAudioElement | null = null
let queue: PlayableChunk[] = []
let queueIdx = 0
let currentUrls: string[] = []   // object URLs to revoke when done
let onEndCb: (() => void) | null = null
let onFailCb: ((reason: string) => void) | null = null
// Whether any chunk of the current queue actually started producing sound. Until then a
// failure means "nothing will be heard" and is reported via onFail (the caller falls back
// to the system voice) instead of silently skipping every chunk and ending in silence.
let startedAny = false
let watchdog: ReturnType<typeof setTimeout> | null = null
const START_TIMEOUT_MS = 10000
let playing = false
let currentRate = 1.0
let listenersAttached = false

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio
  audio = document.createElement('audio')
  audio.preload = 'auto'
  audio.setAttribute('playsinline', '') // iOS: don't open native fullscreen player
  audio.style.display = 'none'
  document.body.appendChild(audio)

  audio.addEventListener('ended', () => {
    queueIdx++
    if (queueIdx < queue.length) {
      playCurrent()
    } else {
      const cb = onEndCb
      cleanup()
      cb?.()
    }
  })

  audio.addEventListener('playing', () => {
    if (queue.length === 0 || audio?.currentSrc === SILENT_WAV) return
    startedAny = true
    clearWatchdog()
  })

  audio.addEventListener('error', (e) => {
    console.warn('[audioPlayback] element error:', e)
    if (queue.length === 0) return
    if (!startedAny) { fail('el audio no se pudo cargar'); return }
    queueIdx++
    if (queueIdx < queue.length) playCurrent()
    else {
      const cb = onEndCb
      cleanup()
      cb?.()
    }
  })

  return audio
}

function playCurrent(): void {
  if (!audio) return
  const chunk = queue[queueIdx]
  if (!chunk) return
  // Blob → object URL (revoked on cleanup). String → direct media URL
  // (Google Translate TTS et al. — playable by <audio> without CORS).
  if (typeof chunk === 'string') {
    audio.src = chunk
  } else {
    const url = URL.createObjectURL(chunk)
    currentUrls.push(url)
    audio.src = url
  }
  audio.playbackRate = currentRate
  audio.play().catch(err => {
    console.warn('[audioPlayback] play() rejected:', err)
    // AbortError = the src was replaced by the next chunk / stop(): not a failure.
    // Anything else before the first sound (e.g. iOS NotAllowedError without a prior
    // gesture, unsupported source) means the visitor would hear nothing.
    if (err?.name !== 'AbortError' && !startedAny) fail(`reproducción bloqueada (${err?.name || 'error'})`)
  })
}

function clearWatchdog(): void {
  if (watchdog) { clearTimeout(watchdog); watchdog = null }
}

/** Nothing could be played: stop and hand over to the caller's fallback. */
function fail(reason: string): void {
  const cb = onFailCb
  const end = onEndCb
  stop()
  if (cb) cb(reason)
  else end?.()
}

function cleanup(): void {
  playing = false
  onEndCb = null
  onFailCb = null
  startedAny = false
  clearWatchdog()
  // Revoke object URLs to free memory.
  for (const u of currentUrls) URL.revokeObjectURL(u)
  currentUrls = []
  queue = []
  queueIdx = 0
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
  }
}

function attachMediaSessionHandlers(): void {
  if (listenersAttached || !('mediaSession' in navigator)) return
  listenersAttached = true
  // These actions appear as buttons on iOS lock-screen / Control Centre /
  // AirPods. Routed through callbacks set by the route page so the same
  // element controls the underlying tour navigation (next POI, previous POI).
  navigator.mediaSession.setActionHandler?.('play', () => { audio?.play().catch(() => undefined) })
  navigator.mediaSession.setActionHandler?.('pause', () => { audio?.pause() })
  navigator.mediaSession.setActionHandler?.('stop', () => { stop() })
  navigator.mediaSession.setActionHandler?.('nexttrack', () => { navHandlers.next?.() })
  navigator.mediaSession.setActionHandler?.('previoustrack', () => { navHandlers.prev?.() })
}

// Callbacks the route page registers so lock-screen Next/Previous buttons
// (MediaSession nexttrack / previoustrack) actually move the tour forward.
const navHandlers: { next?: () => void; prev?: () => void } = {}
export function setNavigationHandlers(handlers: { onNext?: () => void; onPrev?: () => void }): void {
  navHandlers.next = handlers.onNext
  navHandlers.prev = handlers.onPrev
}

function setMediaSessionMetadata(poi: POI): void {
  if (!('mediaSession' in navigator)) return
  attachMediaSessionHandlers()
  const artwork = poi.imageUrl ? [{ src: poi.imageUrl, sizes: '512x512', type: 'image/jpeg' }] : []
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: poi.name,
      artist: 'GuiAgo',
      album: poi.category,
      artwork,
    })
    navigator.mediaSession.playbackState = 'playing'
  } catch (err) {
    console.warn('[audioPlayback] metadata failed:', err)
  }
}

// 1-second silent WAV (RIFF/44.1kHz/mono/16-bit, zero samples) as data URI.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

let unlocked = false

/**
 * iOS unlock — MUST be called synchronously inside a user gesture (tap).
 *
 * iOS only allows audio.play() on an element that has previously played
 * within a user gesture. Our real narration starts AFTER an async fetch
 * (outside the gesture), so we "prime" the shared element here with a
 * silent WAV. Once unlocked, the same element can play queued narration
 * chunks for the rest of the session without further gestures — exactly
 * how music apps chain tracks.
 */
export function unlock(): void {
  if (unlocked) return
  const a = ensureAudio()
  a.src = SILENT_WAV
  // RACE FIX: the previous version paused + removed src inside .then() of
  // the silent WAV. If a real narration arrived BEFORE that .then() fired
  // (cached fetch), it would set src=MP3 first, then the deferred pause()
  // killed it — leaving the user with zero sound. Now we just MARK the
  // element as unlocked; the next play(blobs) call's stop() will replace
  // the WAV's src naturally.
  a.play().then(() => {
    unlocked = true
  }).catch(() => { /* will retry on the next gesture */ })
}

export interface PlayOptions {
  rate?: number
  onEnd?: () => void
  /** Called instead of onEnd when no chunk could be played at all */
  onFail?: (reason: string) => void
  poi?: POI
}

/** Sequentially play a list of audio chunks (Blobs or direct media URLs). */
export function play(chunks: PlayableChunk[], opts: PlayOptions = {}): void {
  stop()
  if (chunks.length === 0) { opts.onEnd?.(); return }
  ensureAudio()
  queue = chunks
  queueIdx = 0
  onEndCb = opts.onEnd ?? null
  onFailCb = opts.onFail ?? null
  startedAny = false
  currentRate = opts.rate ?? 1.0
  if (opts.poi) setMediaSessionMetadata(opts.poi)
  playing = true
  // A provider that never answers would otherwise leave the guide silently "playing"
  watchdog = setTimeout(() => { if (!startedAny) fail('el audio no respondió a tiempo') }, START_TIMEOUT_MS)
  playCurrent()
}

export function pause(): void {
  audio?.pause()
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
}

export function resume(): void {
  audio?.play().catch(() => undefined)
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
}

export function stop(): void {
  if (audio) { audio.pause(); audio.removeAttribute('src') }
  cleanup()
}

export function isPlaying(): boolean {
  return playing && !!audio && !audio.paused
}

export function setRate(rate: number): void {
  currentRate = Math.max(0.5, Math.min(2.0, rate))
  if (audio) audio.playbackRate = currentRate
}
