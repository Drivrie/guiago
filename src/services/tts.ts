import type { Language } from '../types'

type TTSLang = 'es-ES' | 'en-US'

let currentRate = 1.0
let isActive = false
let stopRequested = false

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
  const langCode = lang.split('-')[0]

  // Priority 1: premium/enhanced local voice (best quality)
  const premium = voices.find(v =>
    v.lang.startsWith(langCode) &&
    (v.name.toLowerCase().includes('premium') ||
     v.name.toLowerCase().includes('enhanced') ||
     v.name.toLowerCase().includes('samantha') ||
     v.name.toLowerCase().includes('mónica') ||
     v.name.toLowerCase().includes('monica'))
  )
  if (premium) return premium

  // Priority 2: local service voice for the language
  const local = voices.find(v => v.lang === lang && v.localService)
  if (local) return local

  // Priority 3: any voice matching the language
  const any = voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(langCode))
  return any || null
}

// Split text into sentence-sized chunks (max ~180 chars) to prevent iOS volume fade bug
function splitIntoChunks(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end of string
  const raw = text.split(/(?<=[.!?¡¿])\s+/)
  const chunks: string[] = []
  let current = ''

  for (const part of raw) {
    if (!part.trim()) continue
    if (current.length + part.length > 180 && current.length > 0) {
      chunks.push(current.trim())
      current = part
    } else {
      current += (current ? ' ' : '') + part
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(c => c.length > 0)
}

// Speak chunks sequentially — iOS fix: cancel+speak for each chunk avoids volume fade
function speakChunks(
  chunks: string[],
  index: number,
  lang: TTSLang,
  rate: number,
  onEnd: () => void,
  onStart?: () => void
): void {
  if (stopRequested || index >= chunks.length) {
    isActive = false
    if (!stopRequested) onEnd()
    return
  }

  const utterance = new SpeechSynthesisUtterance(chunks[index])
  utterance.lang = lang
  utterance.rate = rate
  utterance.pitch = 1.0
  utterance.volume = 1.0  // Always max volume — prevents iOS fade

  const voice = getBestVoice(lang)
  if (voice) utterance.voice = voice

  if (index === 0) {
    utterance.onstart = () => onStart?.()
  }

  utterance.onend = () => {
    if (stopRequested) {
      isActive = false
      return
    }
    // Variable pause: sentence end = 400ms, comma = 150ms, else 80ms
    const last = chunks[index].trimEnd().slice(-1)
    const delay = (last === '.' || last === '!' || last === '?') ? 400
      : (last === '…' || chunks[index].trimEnd().endsWith('...')) ? 600
      : (last === ':' || last === ';') ? 200
      : (last === ',') ? 150
      : 80
    setTimeout(() => speakChunks(chunks, index + 1, lang, rate, onEnd, onStart), delay)
  }

  utterance.onerror = (e) => {
    if (e.error === 'interrupted') return
    console.warn('TTS chunk error:', e.error)
    // Skip failed chunk and continue
    setTimeout(() => speakChunks(chunks, index + 1, lang, rate, onEnd, onStart), 100)
  }

  // iOS workaround: always cancel before speaking to prevent queue buildup
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

export function speak(
  text: string,
  lang: TTSLang = 'es-ES',
  options?: {
    rate?: number
    onEnd?: () => void
    onStart?: () => void
  }
): void {
  if (!isSupported()) return

  stop()
  stopRequested = false
  isActive = true

  const rate = options?.rate ?? currentRate
  const chunks = splitIntoChunks(text)

  if (chunks.length === 0) return

  speakChunks(
    chunks,
    0,
    lang,
    rate,
    () => { isActive = false; options?.onEnd?.() },
    options?.onStart
  )
}

export function stop(): void {
  if (!isSupported()) return
  stopRequested = true
  isActive = false
  window.speechSynthesis.cancel()
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
  return isActive && window.speechSynthesis.speaking
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
    if (!isSupported()) { resolve([]); return }
    const voices = getVoices()
    if (voices.length > 0) { resolve(voices); return }
    window.speechSynthesis.onvoiceschanged = () => resolve(getVoices())
    setTimeout(() => resolve(getVoices()), 1500)
  })
}

export const SPEED_OPTIONS = [
  { label: '0.8x', value: 0.8 },
  { label: '1x', value: 1.0 },
  { label: '1.2x', value: 1.2 },
  { label: '1.5x', value: 1.5 }
]

// --- Tour guide audio script generation ---

export function generateAudioScript(
  poi: { name: string; category: string; description?: string; tags?: Record<string, string> },
  lang: Language
): string {
  const { name, category, description = '', tags = {} } = poi
  const isHistorical = /catedral|castillo|palacio|museo|monumento/i.test(category)
  const isGastronomy = /restaurante|mercado|bar|taberna/i.test(category)
  const isNature = /parque|jardín|naturaleza/i.test(category)

  type LangKey = 'es' | 'en'
  const safeLang: LangKey = (lang === 'en') ? 'en' : 'es'

  const openings: Record<string, Record<LangKey, string[]>> = {
    historical: {
      es: [
        `Estás frente a ${name}, un ${category} con más de ${tags.year || 'varios siglos'} de historia.`,
        `Aquí tienes ${name}, uno de los ${category} más importantes de ${tags.city || 'esta ciudad'}.`,
        `Bienvenido a ${name}, un lugar que ha sido testigo de ${tags.historicalEvent || 'grandes eventos históricos'}.`,
      ],
      en: [
        `You are now in front of ${name}, a ${category} with over ${tags.year || 'centuries'} of history.`,
        `Here is ${name}, one of the most important ${category} in ${tags.city || 'this city'}.`,
        `Welcome to ${name}, a place that has witnessed ${tags.historicalEvent || 'great historical events'}.`,
      ],
    },
    gastronomy: {
      es: [
        `Llegamos a ${name}, un lugar ideal para probar la gastronomía local.`,
        `Aquí tienes ${name}, famoso por sus platos tradicionales como ${tags.specialty || 'las delicias de la región'}.`,
      ],
      en: [
        `We arrive at ${name}, a perfect place to try local cuisine.`,
        `Here is ${name}, famous for its traditional dishes like ${tags.specialty || 'local delicacies'}.`,
      ],
    },
    nature: {
      es: [
        `Ahora estás en ${name}, un espacio natural lleno de vida y belleza.`,
        `Disfruta de ${name}, un lugar perfecto para conectar con la naturaleza.`,
      ],
      en: [
        `Now you are at ${name}, a natural space full of life and beauty.`,
        `Enjoy ${name}, a perfect place to connect with nature.`,
      ],
    },
    default: {
      es: [`Ahora estás en ${name}, un lugar interesante para explorar.`],
      en: [`Now you are at ${name}, an interesting place to explore.`],
    },
  }

  const closings: Record<LangKey, string[]> = {
    es: [
      'Tómate tu tiempo para explorar. Cuando estés listo, seguiremos.',
      'Disfruta del lugar. Avisa cuando quieras continuar.',
      'Quédate un momento, que este sitio lo merece. Sin prisa.',
    ],
    en: [
      "Take your time to explore. Let me know when you're ready to continue.",
      'Enjoy the place. Notify me when you want to move on.',
      'Stay a moment, this place deserves it. No rush.',
    ],
  }

  let type = 'default'
  if (isHistorical) type = 'historical'
  else if (isGastronomy) type = 'gastronomy'
  else if (isNature) type = 'nature'

  const typeOpenings = openings[type][safeLang]
  const opening = typeOpenings[Math.floor(Math.random() * typeOpenings.length)]
  const closing = closings[safeLang][Math.floor(Math.random() * closings[safeLang].length)]

  let script = opening
  if (description) script += ` ${description}`
  script += ` ${closing}`
  return script
}

export function speakInstructions(instructions: string[], lang: Language): void {
  const ttslang: TTSLang = lang === 'en' ? 'en-US' : 'es-ES'
  for (const instruction of instructions) {
    speak(instruction, ttslang)
  }
}

// Prepare text: expand abbreviations, clean markdown
export function prepareTextForSpeech(text: string, lang: 'es' | 'en' = 'es'): string {
  let t = text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  if (lang === 'es') {
    t = t
      .replace(/\bS\.A\./g, 'Sociedad Anónima')
      .replace(/\bD\.\s/g, 'Don ')
      .replace(/\bDña\.\s/g, 'Doña ')
      .replace(/\bDr\.\s/g, 'Doctor ')
      .replace(/\bSr\.\s/g, 'Señor ')
      .replace(/\bSra\.\s/g, 'Señora ')
      .replace(/\bAv\.\s/g, 'Avenida ')
      .replace(/\bC\/\s/g, 'Calle ')
      .replace(/\bPl\.\s/g, 'Plaza ')
      .replace(/\bS\.\s*([IVX]+)\b/g, 'siglo $1')
      .replace(/\bpágs?\.\s/g, 'página ')
      .replace(/aprox\./g, 'aproximadamente')
  } else {
    t = t
      .replace(/\bSt\.\s/g, 'Street ')
      .replace(/\bAve\.\s/g, 'Avenue ')
      .replace(/\bDr\.\s/g, 'Doctor ')
      .replace(/\bMr\.\s/g, 'Mister ')
      .replace(/\bMrs\.\s/g, 'Missus ')
      .replace(/\bc\.\s/g, 'circa ')
  }

  // Truncate to ~1200 chars finding last complete sentence
  if (t.length > 1200) {
    const sub = t.substring(0, 1200)
    const last = Math.max(sub.lastIndexOf('.'), sub.lastIndexOf('!'), sub.lastIndexOf('?'))
    t = last > 600 ? sub.substring(0, last + 1) : sub + '...'
  }

  return t
}
