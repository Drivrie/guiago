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
    const long = ('Frase de prueba bastante larga. ').repeat(100)
    const out = prepareTextForSpeech(long, 'es')
    expect(out.length).toBeLessThanOrEqual(1205)
  })
})
