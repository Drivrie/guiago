import { describe, it, expect } from 'vitest'
import { parseItineraryText } from './itinerary'

const names = (text: string) => parseItineraryText(text).stops.map(s => s.name)

describe('parseItineraryText', () => {
  it('reads numbered lists with notes, times and durations', () => {
    const { stops } = parseItineraryText(`Ruta por Cracovia:
1. Castillo de Wawel: imprescindible subir a la catedral (90 min)
2. Calle Kanonicza – la más bonita del casco antiguo
3. 12:30 - Visita a la Basílica de Santa María. No te pierdas el toque de trompeta.
4. Sukiennice (Lonja de los Paños)`)
    expect(stops.map(s => s.name)).toEqual(['Castillo de Wawel', 'Calle Kanonicza', 'Basílica de Santa María', 'Sukiennice'])
    expect(stops[0].visitMinutes).toBe(90)
    expect(stops[0].notes).toBe('imprescindible subir a la catedral (90 min)')
    expect(stops[3].notes).toBe('Lonja de los Paños')
  })

  it('reads bulleted lists and strips lead-ins like "Comer en"', () => {
    expect(names(`- Rynek Główny\n- Comer en Pod Wawelem`)).toEqual(['Rynek Główny', 'Pod Wawelem'])
  })

  it('splits two places joined by "y" and trims descriptive tails', () => {
    const { stops } = parseItineraryText(`1. Catedral Nueva y Catedral Vieja, sube a las torres
2. Puente Romano al atardecer`)
    expect(stops.map(s => s.name)).toEqual(['Catedral Nueva', 'Catedral Vieja', 'Puente Romano'])
    expect(stops[2].notes).toBe('al atardecer')
  })

  it('reads arrow chains', () => {
    expect(names('Empezamos en la Plaza Mayor → Catedral Nueva → Casa de las Conchas → Puente Romano'))
      .toEqual(['Plaza Mayor', 'Catedral Nueva', 'Casa de las Conchas', 'Puente Romano'])
  })

  it('extracts proper names from prose, ignoring sentence-initial words', () => {
    expect(names('Por la mañana recomiendo el Alcázar de Segovia. Después bajamos hasta la Catedral de Segovia; luego el Acueducto romano.'))
      .toEqual(['Alcázar de Segovia', 'Catedral de Segovia', 'Acueducto'])
  })

  it('de-duplicates and returns nothing for text without places', () => {
    expect(names('- Plaza Mayor\n- plaza mayor')).toEqual(['Plaza Mayor'])
    expect(names('hoy vamos a pasear un rato sin prisa')).toEqual([])
  })
})
