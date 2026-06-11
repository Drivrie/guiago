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

export type NeuralProviderId = 'openai' | 'streamelements' | 'none'

const LS_KEY_PROVIDER = 'guiago-tts-provider'
const LS_KEY_OPENAI = 'guiago-openai-tts-key'
const LS_KEY_VOICE_ES = 'guiago-tts-voice-es'
const LS_KEY_VOICE_EN = 'guiago-tts-voice-en'

// ---------------------------------------------------------------------------
// Settings (persisted in localStorage so the choice survives reloads).
// ---------------------------------------------------------------------------

export function getProvider(): NeuralProviderId {
  const stored = localStorage.getItem(LS_KEY_PROVIDER) as NeuralProviderId | null
  if (stored === 'openai' || stored === 'streamelements' || stored === 'none') return stored
  // Default: StreamElements (free, no key required, fixes the iOS lock-screen
  // bug, sounds dramatically better than Web Speech). Users can switch to
  // OpenAI in settings for premium quality, or 'none' to keep Web Speech.
  return 'streamelements'
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
export const STREAMELEMENTS_VOICES: Record<'es' | 'en', { id: string; label: string }[]> = {
  es: [
    { id: 'Lupe', label: 'Lupe (mujer · cálida)' },
    { id: 'Mia', label: 'Mia (mujer · joven)' },
    { id: 'Penelope', label: 'Penélope (mujer · neutra)' },
    { id: 'Conchita', label: 'Conchita (mujer · clásica)' },
    { id: 'Enrique', label: 'Enrique (hombre · grave)' },
    { id: 'Miguel', label: 'Miguel (hombre · neutro)' },
  ],
  en: [
    { id: 'Brian', label: 'Brian (man · UK)' },
    { id: 'Joanna', label: 'Joanna (woman · US)' },
    { id: 'Salli', label: 'Salli (woman · US)' },
    { id: 'Matthew', label: 'Matthew (man · US)' },
    { id: 'Amy', label: 'Amy (woman · UK)' },
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

export function getVoice(lang: 'es' | 'en'): string {
  const key = lang === 'es' ? LS_KEY_VOICE_ES : LS_KEY_VOICE_EN
  const stored = localStorage.getItem(key)
  if (stored) return stored
  // Sensible defaults per provider
  return getProvider() === 'openai' ? 'nova' : (lang === 'es' ? 'Lupe' : 'Brian')
}

export function setVoice(lang: 'es' | 'en', voice: string): void {
  const key = lang === 'es' ? LS_KEY_VOICE_ES : LS_KEY_VOICE_EN
  localStorage.setItem(key, voice)
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

// Conservative chunk size: StreamElements rejects >550 chars; OpenAI accepts
// up to 4096 but smaller chunks parallelise better and start playing sooner.
const STREAMELEMENTS_MAX = 500
const OPENAI_MAX = 1500

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

async function fetchStreamElements(text: string, lang: 'es' | 'en'): Promise<Blob> {
  const voice = getVoice(lang)
  const url = `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`StreamElements ${resp.status}`)
  return resp.blob()
}

async function fetchOpenAI(text: string, lang: 'es' | 'en'): Promise<Blob> {
  const key = getOpenAIKey()
  if (!key) throw new Error('OpenAI TTS key missing')
  const voice = getVoice(lang)
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
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
  if (!resp.ok) throw new Error(`OpenAI TTS ${resp.status}`)
  return resp.blob()
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
): Promise<Blob[] | null> {
  const provider = getProvider()
  if (provider === 'none' || !text.trim()) return null

  const maxChars = provider === 'openai' ? OPENAI_MAX : STREAMELEMENTS_MAX
  const chunks = chunkText(text, maxChars)

  const fetcher = provider === 'openai' ? fetchOpenAI : fetchStreamElements

  const blobs = await Promise.all(chunks.map(async (chunk, i) => {
    const key = blobKey(poiId, lang, i, provider)
    const cached = await getAudioBlob(key).catch(() => null)
    if (cached) return cached
    try {
      const blob = await fetcher(chunk, lang)
      await saveAudioBlob(key, blob, provider).catch(() => { /* best effort */ })
      return blob
    } catch (err) {
      console.warn(`[neuralTTS] chunk ${i} failed:`, err)
      return null
    }
  }))

  const ok = blobs.filter((b): b is Blob => !!b)
  return ok.length > 0 ? ok : null
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
  if (p === 'streamelements') return 'StreamElements · Neuronal'
  return 'Web Speech (Siri)'
}
