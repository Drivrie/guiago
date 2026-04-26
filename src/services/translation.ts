import type { Language } from '../types'

const TRANSLATE_API_KEY = import.meta.env.VITE_TRANSLATE_API_KEY
const TRANSLATE_API_URL = 'https://translation.googleapis.com/language/translate/v2'

interface TranslateResponse {
  data: {
    translations: Array<{ translatedText: string }>
  }
}

export async function translateText(
  text: string,
  targetLang: Language,
  sourceLang?: string
): Promise<string> {
  if (!text || !TRANSLATE_API_KEY) {
    console.warn('Translation API key not configured or empty text.')
    return text
  }
  try {
    const params = new URLSearchParams({
      q: text,
      target: targetLang,
      source: sourceLang || 'auto',
      key: TRANSLATE_API_KEY,
    })
    const response = await fetch(`${TRANSLATE_API_URL}?${params}`)
    if (!response.ok) throw new Error(`Translation API error: ${response.status}`)
    const data: TranslateResponse = await response.json()
    return data.data.translations[0].translatedText
  } catch (error) {
    console.error('Translation error:', error)
    return text
  }
}
