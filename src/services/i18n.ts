/**
 * i18n extension scaffold.
 *
 * Today the app ships `'es' | 'en'` as the `Language` type (see `types/index.ts`)
 * because every display string, voice cue, keyword list and AI prompt is
 * maintained in those two languages. Adding a fourth or fifth language
 * requires translating ~200 short strings spread over:
 *   - `types/index.ts`          → ROUTE_TYPE_INFO labels & descriptions
 *   - `services/routing.ts`     → buildInstructionEs/En + buildVoiceInstruction
 *   - `services/ai.ts`          → system/user prompts for each AI task
 *   - `services/wikipedia.ts`   → generateAudioScript template strings
 *   - `services/wikigeo.ts`     → ROUTE_KEYWORDS regex per route type
 *
 * Rather than expanding the union here (which cascades TypeScript errors into
 * every consumer), this module centralises the **operational** bits that can
 * already be generalised — TTS locale tags, Wikipedia host domain, accept-
 * language HTTP header — so that when the team is ready to localise UI strings
 * the rest of the plumbing is already per-locale.
 *
 * Usage pattern for callers:
 *   const lang: SupportedLang = 'fr'  // future
 *   fetch(`${wikiApiFor(lang)}?...`)
 *   speechSynthesis.speak(new SpeechSynthesisUtterance(text), { lang: ttsTagFor(lang) })
 */

/** Union we'd like to expand the public Language to, once strings are translated. */
export type SupportedLang = 'es' | 'en' | 'fr' | 'it' | 'de' | 'pt'

/** BCP-47 tag for SpeechSynthesis voice selection. */
export function ttsTagFor(lang: SupportedLang): string {
  switch (lang) {
    case 'es': return 'es-ES'
    case 'en': return 'en-US'
    case 'fr': return 'fr-FR'
    case 'it': return 'it-IT'
    case 'de': return 'de-DE'
    case 'pt': return 'pt-PT'
  }
}

/** Base URL for the MediaWiki action API in the given language. */
export function wikiApiFor(lang: SupportedLang): string {
  return `https://${lang}.wikipedia.org/w/api.php`
}

/** Wikivoyage API endpoint (travel-focused MediaWiki sister project). */
export function wikivoyageApiFor(lang: SupportedLang): string {
  return `https://${lang}.wikivoyage.org/w/api.php`
}

/** `Accept-Language` header value — comma-separated with fallback to English. */
export function acceptLanguageFor(lang: SupportedLang): string {
  return lang === 'en' ? 'en' : `${lang},en;q=0.8`
}

/**
 * Collapse any SupportedLang to the pair the UI strings actually support today.
 * Use this at the boundary between store state and internal services when
 * piloting new locales — it guarantees they *work*, just with English copy.
 */
export function narrowToUiLang(lang: SupportedLang): 'es' | 'en' {
  return lang === 'es' ? 'es' : 'en'
}

/** Coarse "is this language Latin-based Romance?" check — useful for picking
 *  voice characteristics and Wikipedia fallback order. */
export function isRomance(lang: SupportedLang): boolean {
  return lang === 'es' || lang === 'fr' || lang === 'it' || lang === 'pt'
}
