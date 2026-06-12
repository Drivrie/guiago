// ---------------------------------------------------------------------------
// Neural TTS — replaces Siri/Web Speech with real MP3 narration.
//
// CRITICAL: this exists for two reasons.
//
// 1. Audio QUALITY. The on-device Siri/Web Speech voice is the largest
//    audible gap between GuiAgo and commercial guides (Hearonymus,
//    Civitatis): it sounds robotic, monotone and pauses oddly. Neural
//    voices (OpenAI tts-1, ElevenLabs, StreamElements Polly) sound like a
//    real human guide.
//
// 2. SCREEN-LOCK SURVIVAL on iOS. Web Speech is killed the moment the
//    iPhone locks — the guide just goes silent mid-sentence. But an HTML5
//    <audio> element with real audio content is treated by iOS as a media
//    session (like Spotify or a podcast) and keeps playing with the
//    screen off, the app backgrounded, AirPods connected — even appearing
//    on the lock-screen with play/pause controls. This is the only fix
//    that actually works on iPhone.
//
// Provider order, all transparent to the caller:
//   - 'openai'         user-pasted OpenAI key → tts-1 (premium, ~$0.015/1k)
//   - 'streamelements' free, no key, decent neural voices (default)
//   - 'none'           neural TTS disabled → caller should fall back to
//                       Web Speech (existing behaviour)
// ---------------------------------------------------------------------------

import { saveAudioBlob, getAudioBlob } from './storage'
import type { PlayableChunk } from './audioPlayback'

export type NeuralProviderId = 'openai' | 'pollinations' | 'none'

const LS_KEY_PROVIDER = 'guiago-tts-provider'
const LS_KEY_OPENAI = 'guiago-openai-tts-key'
const LS_KEY_VOICE_ES = 'guiago-tts-voice-es'
const LS_KEY_VOICE_EN = 'guiago-tts-voice-en'

// ---------------------------------------------------------------------------
// Settings (persisted in localStorage so the choice survives reloads).
// ---------------------------------------------------------------------------

export function getProvider(): NeuralProviderId {
  const stored = localStorage.getItem(LS_KEY_PROVIDER) as string | null
  if (stored === 'openai' || stored === 'pollinations' || stored === 'none') return stored
  // 'streamelements' (old default) migrated to 'pollinations': SE started
  // returning 403 to browser requests, which made the guide silently mute.
  return 'pollinations'
}

export function setProvider(id: NeuralProviderId): void {
  localStorage.setItem(LS_KEY_PROVIDER, id)
}

export function getOpenAIKey(): string {
  return localStorage.getItem(LS_KEY_OPENAI) || ''
}

export function setOpenAIKey(key: string): void {
  localStorage.setItem(LS_KEY_OPENAI, key.trim())
}

// Voice catalogues — kept small so the picker stays usable on a phone.
// Pollinations proxies OpenAI's audio voices for free (no key), so both
// providers share the same voice ids.
export const POLLINATIONS_VOICES: Record<'es' | 'en', { id: string; label: string }[]> = {
  es: [
    { id: 'nova', label: 'Nova (mujer · cálida)' },
    { id: 'shimmer', label: 'Shimmer (mujer · clara)' },
    { id: 'alloy', label: 'Alloy (neutra)' },
    { id: 'onyx', label: 'Onyx (hombre · grave)' },
    { id: 'echo', label: 'Echo (hombre · neutro)' },
    { id: 'fable', label: 'Fable (narrador)' },
  ],
  en: [
    { id: 'nova', label: 'Nova (woman · warm)' },
    { id: 'shimmer', label: 'Shimmer (woman · clear)' },
    { id: 'alloy', label: 'Alloy (neutral)' },
    { id: 'onyx', label: 'Onyx (man · deep)' },
    { id: 'echo', label: 'Echo (man · neutral)' },
    { id: 'fable', label: 'Fable (storyteller)' },
  ],
}

export const OPENAI_VOICES: Record<'es' | 'en', { id: string; label: string }[]> = {
  es: [
    { id: 'nova', label: 'Nova (mujer · cálida)' },
    { id: 'shimmer', label: 'Shimmer (mujer · clara)' },
    { id: 'alloy', label: 'Alloy (neutra)' },
    { id: 'onyx', label: 'Onyx (hombre · grave)' },
    { id: 'echo', label: 'Echo (hombre · neutro)' },
  ],
  en: [
    { id: 'nova', label: 'Nova (woman · warm)' },
    { id: 'shimmer', label: 'Shimmer (woman · clear)' },
    { id: 'alloy', label: 'Alloy (neutral)' },
    { id: 'onyx', label: 'Onyx (man · deep)' },
    { id: 'echo', label: 'Echo (man · neutral)' },
  ],
}

const VALID_VOICES = new Set(['nova', 'shimmer', 'alloy', 'onyx', 'echo', 'fable'])

export function getVoice(lang: 'es' | 'en'): string {
  const key = lang === 'es' ? LS_KEY_VOICE_ES : LS_KEY_VOICE_EN
  const stored = localStorage.getItem(key)
  // Old StreamElements voice names (Lupe, Brian…) are invalid for the
  // OpenAI-style providers — silently reset them to the default.
  if (stored && VALID_VOICES.has(stored)) return stored
  return 'nova'
}

export function setVoice(lang: 'es' | 'en', voice: string): void {
  const key = lang === 'es' ? LS_KEY_VOICE_ES : LS_KEY_VOICE_EN
  localStorage.setItem(key, voice)
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

// Chunk sizes: Pollinations carries the text in the URL (keep well under
// URL-length limits); OpenAI accepts up to 4096 chars but smaller chunks
// parallelise better and start playing sooner.
const POLLINATIONS_MAX = 700
const OPENAI_MAX = 1500

// Every TTS fetch gets a hard timeout so a hanging provider can never leave
// the guide silently "buffering" forever — the caller falls back to Web
// Speech instead.
const FETCH_TIMEOUT_MS = 20000

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Throws unless the response actually contains audio (providers sometimes
 *  return 200 + an HTML/text error page, which would "play" as silence). */
async function audioBlobOrThrow(resp: Response, provider: string): Promise<Blob> {
  if (!resp.ok) throw new Error(`${provider} HTTP ${resp.status}`)
  const type = resp.headers.get('content-type') || ''
  const blob = await resp.blob()
  const looksAudio = type.startsWith('audio/') || type === 'application/octet-stream' || blob.type.startsWith('audio/')
  if (!looksAudio || blob.size < 1000) throw new Error(`${provider} returned non-audio (${type}, ${blob.size}B)`)
  return blob
}

/** Splits text into sentence-aligned chunks under the provider's char limit. */
export function chunkText(text: string, maxChars: number): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+/)
  const out: string[] = []
  let current = ''
  for (const s of sentences) {
    if (s.length > maxChars) {
      // Single sentence longer than the limit: hard-split on commas/spaces.
      if (current) { out.push(current.trim()); current = '' }
      let rest = s
      while (rest.length > maxChars) {
        const cut = rest.lastIndexOf(' ', maxChars)
        const at = cut > maxChars * 0.5 ? cut : maxChars
        out.push(rest.slice(0, at).trim())
        rest = rest.slice(at)
      }
      if (rest.trim()) current = rest.trim()
      continue
    }
    if (current.length + s.length + 1 > maxChars) {
      out.push(current.trim()); current = s
    } else {
      current = current ? `${current} ${s}` : s
    }
  }
  if (current.trim()) out.push(current.trim())
  return out.filter(Boolean)
}

async function fetchPollinations(text: string, lang: 'es' | 'en'): Promise<Blob> {
  const voice = getVoice(lang)
  // Pollinations openai-audio: GET with the text in the path returns MP3.
  // No key, no account, CORS-enabled — same provider the app already uses
  // for text generation.
  const url = `https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=${encodeURIComponent(voice)}`
  const resp = await fetchWithTimeout(url)
  return audioBlobOrThrow(resp, 'Pollinations')
}

/** Google Translate TTS — robust fallback. CRITICAL: the endpoint does NOT
 *  send CORS headers, so fetch() always fails in a browser. But <audio src>
 *  plays it fine (media elements are CORS-exempt for playback), so we return
 *  the DIRECT URL instead of fetching. Trade-off: no IndexedDB caching for
 *  this provider. Chunks must stay under ~190 chars (endpoint truncates). */
function googleTranslateUrl(text: string, lang: 'es' | 'en'): string {
  const tl = lang === 'es' ? 'es' : 'en'
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${tl}&client=tw-ob`
}

// Last in-session error so the UI can show ROOT cause instead of a generic
// "neural failed" message. Cleared on each successful synthesize().
let lastError: string = ''
export function getLastError(): string { return lastError }

async function fetchOpenAI(text: string, lang: 'es' | 'en'): Promise<Blob> {
  const key = getOpenAIKey()
  if (!key) throw new Error('OpenAI TTS key missing')
  const voice = getVoice(lang)
  const resp = await fetchWithTimeout('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      response_format: 'mp3',
    }),
  })
  return audioBlobOrThrow(resp, 'OpenAI TTS')
}

/** Cache key includes provider+voice so changing voice in settings re-renders. */
function blobKey(poiId: string, lang: 'es' | 'en', chunkIdx: number, provider: NeuralProviderId): string {
  return `${provider}|${getVoice(lang)}|${lang}|${poiId}|${chunkIdx}`
}

/**
 * Returns a list of audio Blobs (one per chunk) that, played in sequence,
 * speak the whole `text`. Caches each chunk in IndexedDB so replays cost
 * zero network. Chunks are fetched in PARALLEL so total wall-clock time
 * ≈ slowest single chunk, not their sum.
 *
 * Returns null if the active provider is 'none' or all fetches failed —
 * caller should fall back to Web Speech.
 */
export async function synthesize(
  text: string,
  lang: 'es' | 'en',
  poiId: string,
): Promise<PlayableChunk[] | null> {
  const provider = getProvider()
  if (provider === 'none' || !text.trim()) {
    lastError = provider === 'none' ? 'Voz neuronal desactivada' : 'Texto vacío'
    return null
  }

  const isOpenAI = provider === 'openai'
  // Use the SHORTEST chunk size across the fallback chain so the same chunk
  // text fits every provider — Google TTS truncates anything over ~190 chars.
  const maxChars = isOpenAI ? OPENAI_MAX : 180
  const chunks = chunkText(text, maxChars)

  const errorReasons: string[] = []

  // SEQUENTIAL with per-chunk retry — parallel fetching is what triggered
  // Pollinations' per-IP rate limit (HTTP 429). Sequential is slower for
  // long narrations but the first chunk starts playing as soon as the whole
  // set resolves, and most chunks come from the IndexedDB cache anyway.
  const out: PlayableChunk[] = []
  let pollinationsDown = false

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const key = blobKey(poiId, lang, i, provider)
    const cached = await getAudioBlob(key).catch(() => null)
    if (cached) { out.push(cached); continue }

    let resolved: PlayableChunk | null = null

    if (isOpenAI) {
      try {
        const blob = await fetchOpenAI(chunk, lang)
        await saveAudioBlob(key, blob, provider).catch(() => { /* best effort */ })
        resolved = blob
      } catch (err) {
        errorReasons.push(`OpenAI: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      // 1. Pollinations (cacheable blob), with ONE retry after a pause on 429.
      if (!pollinationsDown) {
        for (let attempt = 0; attempt < 2 && !resolved; attempt++) {
          try {
            const blob = await fetchPollinations(chunk, lang)
            await saveAudioBlob(key, blob, provider).catch(() => { /* best effort */ })
            resolved = blob
            break
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            errorReasons.push(`Pollinations: ${msg}`)
            if (msg.includes('429') && attempt === 0) {
              await new Promise(r => setTimeout(r, 1500))
            } else {
              // Hard failure (or second 429): stop hammering the endpoint
              // for the remaining chunks of this narration.
              pollinationsDown = true
              break
            }
          }
        }
      }
      // 2. Google Translate TTS — direct URL playback (no fetch, no CORS
      //    requirement, no caching). Extremely reliable for short chunks.
      if (!resolved) {
        resolved = googleTranslateUrl(chunk, lang)
      }
    }

    if (!resolved) {
      lastError = errorReasons[0] || 'Sin respuesta de los proveedores de voz'
      return null
    }
    out.push(resolved)
  }

  lastError = errorReasons[0] || ''
  return out.length > 0 ? out : null
}

/** True when a neural provider is configured (used to choose the audio path). */
export function isNeuralActive(): boolean {
  const p = getProvider()
  if (p === 'none') return false
  if (p === 'openai' && !getOpenAIKey()) return false
  return true
}

/** Human-readable label for the current provider (used in UI). */
export function getProviderLabel(): string {
  const p = getProvider()
  if (p === 'openai') return 'OpenAI TTS · Neuronal'
  if (p === 'pollinations') return 'Voz neuronal · gratis'
  return 'Web Speech (Siri)'
}
