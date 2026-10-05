import { describe, it, expect } from 'vitest'
import { nameSimilarity, guessCategory } from './wikigeo'

describe('nameSimilarity', () => {
  it('accepts the same place under a longer or inflected title', () => {
    expect(nameSimilarity('Rynek Główny', 'Rynek Główny w Krakowie')).toBe(1)
    expect(nameSimilarity('Catedral', 'Catedral de Burgos')).toBe(1)
    expect(nameSimilarity('Wawel Castle', 'Zamek Królewski na Wawelu')).toBeGreaterThanOrEqual(0.5)
  })

  it('rejects namesakes and the city article', () => {
    expect(nameSimilarity('Iglesia de San Juan', 'Iglesia de Santa María')).toBeLessThan(0.5)
    expect(nameSimilarity('Mercado Central', 'Valencia')).toBe(0)
  })
})

describe('guessCategory', () => {
  it('prefers the title over words in the article lead', () => {
    expect(guessCategory('Plaza Mayor', 'Es la plaza principal, junto a la iglesia', 'monumental')).toBe('plaza')
    expect(guessCategory('Kościół św. Anny', 'Barokowy kościół', 'monumental')).toBe('iglesia')
  })

  it('does not read ambiguous English words in the lead as categories', () => {
    // "most" (Polish: bridge) / "place" must not turn a museum into a bridge or square
    expect(guessCategory('Museo del Prado', 'The museum is the most visited place', 'monumental')).toBe('museo')
    expect(guessCategory('Most Karola', 'Kamienny most w Pradze', 'monumental')).toBe('puente')
  })
})
