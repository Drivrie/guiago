import { describe, it, expect } from 'vitest'
import { prepareTextForSpeech } from './tts'

describe('prepareTextForSpeech', () => {
  it('strips markdown emphasis', () => {
    expect(prepareTextForSpeech('Esto es **muy** importante', 'es')).toBe('Esto es muy importante')
  })

  it('expands Spanish abbreviations', () => {
    expect(prepareTextForSpeech('Visita la C/ Mayor', 'es')).toContain('Calle Mayor')
  })

  it('expands English abbreviations', () => {
    expect(prepareTextForSpeech('Walk down St. James', 'en')).toContain('Street James')
  })

  it('truncates very long text at a sentence boundary', () => {
    const long = ('Frase de prueba bastante larga. ').repeat(300)
    const out = prepareTextForSpeech(long, 'es')
    // Limit is ~4000 chars (≈ 4-5 min of speech) so the 320-420 word AI
    // narrations are NEVER cut; only truly runaway text is trimmed.
    expect(out.length).toBeLessThanOrEqual(4005)
    expect(out.trimEnd().endsWith('.')).toBe(true)
  })

  it('does NOT truncate a full-length AI narration (~2800 chars)', () => {
    const narration = ('Una frase del guía con datos interesantes. ').repeat(65)
    const out = prepareTextForSpeech(narration, 'es')
    expect(out.length).toBeGreaterThan(2500)
  })
})
