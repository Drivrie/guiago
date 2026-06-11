// ---------------------------------------------------------------------------
// announce() — short neural-voice announcement helper.
//
// Used for transitional cues during a tour: "Vamos hacia el Real Alcázar,
// está a unos 200 metros. Empezamos a caminar." Keeps the voice CONSISTENT
// with the POI narration (same neural voice, same MediaSession track), so
// the tour doesn't switch jarringly between a human-sounding Polly/OpenAI
// voice and the robotic on-device Siri voice between stops.
//
// Falls back to Web Speech when neural is disabled or unreachable so the
// app never goes silent in the middle of a tour.
// ---------------------------------------------------------------------------

import { synthesize, isNeuralActive } from './neuralTTS'
import * as audioPlayback from './audioPlayback'
import { speak } from './tts'
import type { Language, POI } from '../types'

export interface AnnounceOptions {
  /** Optional POI metadata (lock-screen title + image while announcing). */
  poi?: POI
  /** Stable id used for caching the synthesised MP3. Default: hashed text. */
  cacheId?: string
  /** Called when the announcement finishes (or fails). */
  onEnd?: () => void
}

function hashId(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return `ann-${h.toString(36)}`
}

/**
 * Speak a short text. Uses the neural path when available so the tour keeps
 * the same human voice between POI narrations and transitions. Resolves the
 * previous audio queue (callers must accept that).
 */
export async function announce(text: string, lang: Language, opts: AnnounceOptions = {}): Promise<void> {
  if (!text.trim()) { opts.onEnd?.(); return }
  if (!isNeuralActive()) {
    speak(text, lang === 'es' ? 'es-ES' : 'en-US', { rate: 1.05, onEnd: opts.onEnd })
    return
  }
  try {
    const blobs = await synthesize(text, lang === 'es' ? 'es' : 'en', opts.cacheId || hashId(text))
    if (!blobs) {
      speak(text, lang === 'es' ? 'es-ES' : 'en-US', { rate: 1.05, onEnd: opts.onEnd })
      return
    }
    audioPlayback.play(blobs, { rate: 1.05, poi: opts.poi, onEnd: opts.onEnd })
  } catch (err) {
    console.warn('[announce] neural failed, falling back to Web Speech:', err)
    speak(text, lang === 'es' ? 'es-ES' : 'en-US', { rate: 1.05, onEnd: opts.onEnd })
  }
}
