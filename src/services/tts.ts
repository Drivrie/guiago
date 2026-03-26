type TTSLang = 'es-ES' | 'en-US'

let currentUtterance: SpeechSynthesisUtterance | null = null
let currentRate = 1.0
let onEndCallback: (() => void) | null = null
let onStartCallback: (() => void) | null = null
let onPauseCallback: (() => void) | null = null

export function isSupported(): boolean {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

export function getVoices(): SpeechSynthesisVoice[] {
  if (!isSupported()) return []
  return window.speechSynthesis.getVoices()
}

export function getBestVoice(lang: TTSLang): SpeechSynthesisVoice | null {
  const voices = getVoices()
  if (voices.length === 0) return null

  const langCode = lang.split('-')[0] // 'es' or 'en'

  // Priority 1: exact match with good quality indicators
  const preferred = voices.find(v =>
    v.lang === lang && (v.localService || v.name.toLowerCase().includes('premium') || v.name.toLowerCase().includes('enhanced'))
  )
  if (preferred) return preferred

  // Priority 2: exact language match
  const exact = voices.find(v => v.lang === lang)
  if (exact) return exact

  // Priority 3: same language family
  const family = voices.find(v => v.lang.startsWith(langCode))
  if (family) return family

  return null
}

export function speak(
  text: string,
  lang: TTSLang = 'es-ES',
  options?: {
    rate?: number
    pitch?: number
    volume?: number
    onEnd?: () => void
    onStart?: () => void
    onPause?: () => void
  }
): void {
  if (!isSupported()) {
    console.warn('TTS not supported in this browser')
    return
  }

  // Stop any current speech
  stop()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = options?.rate ?? currentRate
  utterance.pitch = options?.pitch ?? 1.0
  utterance.volume = options?.volume ?? 1.0

  // Try to use a good voice for the language
  const voice = getBestVoice(lang)
  if (voice) {
    utterance.voice = voice
  }

  // Callbacks
  onEndCallback = options?.onEnd || null
  onStartCallback = options?.onStart || null
  onPauseCallback = options?.onPause || null

  utterance.onstart = () => {
    onStartCallback?.()
  }

  utterance.onend = () => {
    currentUtterance = null
    onEndCallback?.()
  }

  utterance.onerror = (event) => {
    if (event.error !== 'interrupted') {
      console.error('TTS error:', event.error)
    }
    currentUtterance = null
    onEndCallback?.()
  }

  utterance.onpause = () => {
    onPauseCallback?.()
  }

  currentUtterance = utterance
  window.speechSynthesis.speak(utterance)
}

export function stop(): void {
  if (!isSupported()) return
  window.speechSynthesis.cancel()
  currentUtterance = null
}

export function pause(): void {
  if (!isSupported()) return
  window.speechSynthesis.pause()
}

export function resume(): void {
  if (!isSupported()) return
  window.speechSynthesis.resume()
}

export function isSpeaking(): boolean {
  if (!isSupported()) return false
  return window.speechSynthesis.speaking
}

export function isPaused(): boolean {
  if (!isSupported()) return false
  return window.speechSynthesis.paused
}

export function setRate(rate: number): void {
  currentRate = Math.max(0.5, Math.min(2.0, rate))
}

export function getRate(): number {
  return currentRate
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isSupported()) {
      resolve([])
      return
    }

    const voices = getVoices()
    if (voices.length > 0) {
      resolve(voices)
      return
    }

    // Voices might not be loaded yet
    window.speechSynthesis.onvoiceschanged = () => {
      resolve(getVoices())
    }

    // Timeout fallback
    setTimeout(() => resolve(getVoices()), 1000)
  })
}

export const SPEED_OPTIONS = [
  { label: '0.8x', value: 0.8 },
  { label: '1x', value: 1.0 },
  { label: '1.2x', value: 1.2 },
  { label: '1.5x', value: 1.5 }
]

// Convert text to audio-friendly format (expand abbreviations, etc.)
export function prepareTextForSpeech(text: string, lang: 'es' | 'en' = 'es'): string {
  let prepared = text

  if (lang === 'es') {
    // Expand common Spanish abbreviations
    prepared = prepared
      .replace(/\bS\.A\./g, 'Sociedad Anónima')
      .replace(/\bD\./g, 'Don')
      .replace(/\bDña\./g, 'Doña')
      .replace(/\bDr\./g, 'Doctor')
      .replace(/\bSr\./g, 'Señor')
      .replace(/\bSra\./g, 'Señora')
      .replace(/\bAv\./g, 'Avenida')
      .replace(/\bC\//g, 'Calle')
      .replace(/\bPl\./g, 'Plaza')
  } else {
    prepared = prepared
      .replace(/\bSt\./g, 'Street')
      .replace(/\bAve\./g, 'Avenue')
      .replace(/\bDr\./g, 'Doctor')
      .replace(/\bMr\./g, 'Mister')
      .replace(/\bMrs\./g, 'Missus')
  }

  // Remove markdown-like formatting
  prepared = prepared.replace(/\*\*(.*?)\*\*/g, '$1')
  prepared = prepared.replace(/\*(.*?)\*/g, '$1')

  // Limit length for audio (avoid very long texts)
  const maxLength = 1500
  if (prepared.length > maxLength) {
    // Find last complete sentence within limit
    const truncated = prepared.substring(0, maxLength)
    const lastSentence = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?')
    )
    if (lastSentence > 0) {
      prepared = truncated.substring(0, lastSentence + 1)
    } else {
      prepared = truncated + '...'
    }
  }

  return prepared
}
