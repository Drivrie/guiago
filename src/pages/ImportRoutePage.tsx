import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapView } from '../components/MapView'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../stores/appStore'
import { searchCities, getCityDetails } from '../services/nominatim'
import { parseItinerary, resolveStops, resolveStop, buildRouteFromPOIs } from '../services/itinerary'
import type { ItineraryStop, ParsedItinerary } from '../services/itinerary'
import type { City, POI } from '../types'

type Phase = 'input' | 'analyzing' | 'review' | 'building'

interface StopItem {
  stop: ItineraryStop
  status: 'pending' | 'found' | 'missing'
  poi: POI | null
  include: boolean
  editName: string
}

const EXAMPLE_ES = `Ruta de un día por Salamanca:
1. Plaza Mayor: empezar temprano para verla sin gente
2. Casa de las Conchas – fíjate en las más de 300 conchas de la fachada
3. Universidad de Salamanca (busca la rana en la fachada)
4. Catedral Nueva y Catedral Vieja, sube a las torres de Ieronimus
5. Puente Romano al atardecer`

const EXAMPLE_EN = `One day in Salamanca:
1. Plaza Mayor: go early to see it without crowds
2. Casa de las Conchas – look for the 300+ shells on the facade
3. University of Salamanca (find the frog on the facade)
4. New Cathedral and Old Cathedral, climb the Ieronimus towers
5. Roman Bridge at sunset`

export function ImportRoutePage() {
  const navigate = useNavigate()
  const {
    language, selectedCity, userLocation, anthropicApiKey,
    setCity, setPOIs, setRoute, setCurrentPOIIndex,
  } = useAppStore()
  const es = language === 'es'

  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [cityInput, setCityInput] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedItinerary | null>(null)
  const [city, setCityState] = useState<City | null>(null)
  const [items, setItems] = useState<StopItem[]>([])
  const [keepOrder, setKeepOrder] = useState(true)
  const runIdRef = useRef(0)

  function updateItem(index: number, patch: Partial<StopItem>) {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip) setText(clip)
    } catch {
      setError(es ? 'No se pudo leer el portapapeles. Mantén pulsado el cuadro de texto y elige «Pegar».' : 'Could not read the clipboard. Long-press the text box and choose "Paste".')
    }
  }

  async function resolveCity(p: ParsedItinerary): Promise<City | null> {
    if (cityInput.trim()) return (await searchCities(cityInput.trim(), language))[0] ?? null
    if (p.city) {
      const found = (await searchCities(p.country ? `${p.city}, ${p.country}` : p.city, language))[0]
        ?? (await searchCities(p.city, language))[0]
      if (found) return found
    }
    if (selectedCity) return selectedCity
    if (userLocation) return getCityDetails(userLocation[0], userLocation[1])
    return null
  }

  async function analyze() {
    if (text.trim().length < 5) return
    const runId = ++runIdRef.current
    setError(null)
    setPhase('analyzing')
    setStatusMsg(es ? '📖 Leyendo el recorrido…' : '📖 Reading the itinerary…')

    const p = await parseItinerary(text, language, anthropicApiKey)
    if (runId !== runIdRef.current) return
    if (p.stops.length === 0) {
      setError(es
        ? 'No he encontrado lugares en el texto. Prueba con una lista: un lugar por línea.'
        : 'No places found in the text. Try a list: one place per line.')
      setPhase('input')
      return
    }

    setStatusMsg(es ? '🌍 Localizando la ciudad…' : '🌍 Finding the city…')
    const c = await resolveCity(p)
    if (runId !== runIdRef.current) return
    if (!c) {
      setError(es
        ? '¿En qué ciudad es el recorrido? Escríbela en el campo «Ciudad» y vuelve a intentarlo.'
        : 'Which city is this route in? Type it in the "City" field and try again.')
      setPhase('input')
      return
    }

    setParsed(p)
    setCityState(c)
    setItems(p.stops.map(stop => ({ stop, status: 'pending', poi: null, include: true, editName: stop.searchName || stop.name })))
    setPhase('review')

    await resolveStops(p.stops, c, language, (i, poi) => {
      if (runId !== runIdRef.current) return
      updateItem(i, { status: poi ? 'found' : 'missing', poi, include: !!poi })
    })
  }

  async function retryItem(index: number) {
    const item = items[index]
    if (!city || !item.editName.trim()) return
    updateItem(index, { status: 'pending' })
    const poi = await resolveStop({ ...item.stop, name: item.editName.trim(), searchName: undefined }, city, language).catch(() => null)
    updateItem(index, { status: poi ? 'found' : 'missing', poi, include: !!poi })
  }

  function moveItem(index: number, delta: -1 | 1) {
    setItems(prev => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function backToInput() {
    runIdRef.current++
    if (city) setCityInput(city.name)
    setPhase('input')
  }

  const selectedPOIs = items.filter(it => it.include && it.poi).map(it => it.poi!)
  const pendingCount = items.filter(it => it.status === 'pending').length

  async function createRoute() {
    if (!city || selectedPOIs.length < 2) return
    setPhase('building')
    setStatusMsg(es ? '🚶 Calculando el recorrido a pie…' : '🚶 Calculating the walking route…')
    try {
      const route = await buildRouteFromPOIs(selectedPOIs, city, {
        lang: language,
        title: parsed?.title || (es ? 'Mi recorrido' : 'My itinerary'),
        intro: parsed?.intro,
        keepOrder,
      })
      setCity(city)
      setPOIs(route.pois)
      setRoute(route)
      setCurrentPOIIndex(0)
      // Same flow as generated routes: review photos/stops, then start the guide
      navigate('/route/preview')
    } catch {
      setError(es ? 'No se pudo crear la ruta. Comprueba tu conexión.' : 'Could not create the route. Check your connection.')
      setPhase('review')
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 safe-top">
      {(phase === 'analyzing' || phase === 'building') && <LoadingSpinner fullScreen message={statusMsg} />}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          onClick={() => (phase === 'review' ? backToInput() : navigate(-1))}
          className="w-9 h-9 bg-white rounded-xl shadow-sm border border-stone-100 flex items-center justify-center text-stone-600"
          aria-label={es ? 'Volver' : 'Back'}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0">
          <p className="text-stone-900 font-black text-lg">{es ? 'Pegar un recorrido' : 'Paste an itinerary'}</p>
          <p className="text-stone-500 text-xs">
            {es ? 'Convierte cualquier texto en una ruta guiada' : 'Turn any text into a guided route'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* ---------------- INPUT ---------------- */}
      {phase !== 'review' && (
        <div className="px-4 pb-32">
          <p className="text-stone-600 text-sm mb-3">
            {es
              ? 'Pega un itinerario de un blog, una guía, un mensaje o tus notas. Usaré los lugares que aparecen, en su orden, con lo que el texto cuenta de cada uno.'
              : "Paste an itinerary from a blog, a guide, a message or your notes. I'll use the places it mentions, in order, along with what the text says about each one."}
          </p>

          <div className="relative">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={11}
              placeholder={es ? EXAMPLE_ES : EXAMPLE_EN}
              className="w-full bg-white border border-stone-200 rounded-2xl px-4 py-3 text-sm text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-orange-300 resize-y"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={pasteFromClipboard}
                className="flex-1 py-2.5 bg-white border border-stone-200 rounded-xl text-sm font-semibold text-stone-600 active:scale-95 transition-transform"
              >
                📋 {es ? 'Pegar' : 'Paste'}
              </button>
              <button
                onClick={() => setText(es ? EXAMPLE_ES : EXAMPLE_EN)}
                className="flex-1 py-2.5 bg-white border border-stone-200 rounded-xl text-sm font-semibold text-stone-600 active:scale-95 transition-transform"
              >
                💡 {es ? 'Ver ejemplo' : 'Example'}
              </button>
              {text && (
                <button
                  onClick={() => setText('')}
                  className="px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm font-semibold text-stone-400 active:scale-95 transition-transform"
                  aria-label={es ? 'Borrar' : 'Clear'}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <label className="block mt-5">
            <span className="text-stone-500 text-xs font-semibold uppercase tracking-wider">
              {es ? 'Ciudad (opcional)' : 'City (optional)'}
            </span>
            <input
              type="text"
              value={cityInput}
              onChange={e => setCityInput(e.target.value)}
              placeholder={selectedCity
                ? (es ? `Si no la indicas: del texto o ${selectedCity.name}` : `If empty: from the text or ${selectedCity.name}`)
                : (es ? 'Si no la indicas, se deduce del texto o de tu ubicación' : 'If empty, taken from the text or your location')}
              className="mt-1.5 w-full bg-white border border-stone-200 rounded-xl px-4 py-3 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </label>
        </div>
      )}

      {phase === 'input' && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-sm border-t border-stone-100 safe-bottom">
          <Button fullWidth size="lg" onClick={analyze} disabled={text.trim().length < 5}>
            ✨ {es ? 'Analizar recorrido' : 'Analyze itinerary'}
          </Button>
        </div>
      )}

      {/* ---------------- REVIEW ---------------- */}
      {phase === 'review' && city && (
        <div className="px-4 pb-40">
          {/* City + summary */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📍</span>
              <div className="flex-1 min-w-0">
                <p className="font-black text-stone-900 truncate">{parsed?.title || city.name}</p>
                <p className="text-stone-500 text-xs truncate">{city.name}{city.country ? `, ${city.country}` : ''}</p>
              </div>
              <button onClick={backToInput} className="text-orange-600 text-xs font-semibold px-3 py-1.5 bg-orange-50 rounded-xl">
                {es ? 'Cambiar' : 'Change'}
              </button>
            </div>
            {parsed?.intro && <p className="text-stone-600 text-sm italic mt-3 leading-relaxed">{parsed.intro}</p>}
            <p className="text-stone-400 text-xs mt-3">
              {pendingCount > 0
                ? (es ? `Buscando ${pendingCount} lugar(es) en Wikipedia y OpenStreetMap…` : `Looking up ${pendingCount} place(s) on Wikipedia and OpenStreetMap…`)
                : (es
                  ? `${items.filter(i => i.status === 'found').length} de ${items.length} lugares localizados`
                  : `${items.filter(i => i.status === 'found').length} of ${items.length} places located`)}
              {parsed?.source === 'text' && (es ? ' · lectura sin IA' : ' · read without AI')}
            </p>
          </div>

          {/* Map of located stops — lets the user spot a wrong match at a glance */}
          {selectedPOIs.length > 0 && (
            <div className="rounded-2xl overflow-hidden border border-stone-100 shadow-sm mb-3" style={{ height: 200 }}>
              <MapView pois={selectedPOIs} currentPOIIndex={-1} className="w-full h-full" />
            </div>
          )}

          {/* Stops */}
          <div className="flex flex-col gap-2">
            {items.map((item, idx) => (
              <div
                key={`${item.stop.name}-${idx}`}
                className={`bg-white rounded-2xl border shadow-sm p-3 ${item.include ? 'border-stone-100' : 'border-stone-100 opacity-60'}`}
              >
                <div className="flex items-start gap-3">
                  {item.poi?.imageUrl ? (
                    <img src={item.poi.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0 text-orange-500 font-black">
                      {idx + 1}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-stone-800 text-sm truncate">{item.poi?.name || item.stop.name}</p>
                    {item.poi && item.poi.name !== item.stop.name && (
                      <p className="text-stone-400 text-xs truncate">{es ? 'En el texto: ' : 'In the text: '}{item.stop.name}</p>
                    )}
                    <p className="text-xs mt-0.5">
                      {item.status === 'pending' && <span className="text-stone-400">⏳ {es ? 'Buscando…' : 'Searching…'}</span>}
                      {item.status === 'found' && (
                        <span className="text-green-600">
                          ✓ <span className="capitalize">{item.poi?.category}</span>
                          {item.poi?.tags?.source === 'osm' ? ' · OpenStreetMap' : ' · Wikipedia'}
                        </span>
                      )}
                      {item.status === 'missing' && <span className="text-red-500">✗ {es ? 'No localizado en esta ciudad' : 'Not found in this city'}</span>}
                    </p>
                    {item.stop.notes && <p className="text-stone-500 text-xs mt-1 line-clamp-2">{item.stop.notes}</p>}
                  </div>
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => item.poi && updateItem(idx, { include: !item.include })}
                      disabled={!item.poi}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${item.include ? 'bg-orange-500 text-white' : 'bg-stone-100 text-stone-400'}`}
                      aria-label={item.include ? (es ? 'Quitar de la ruta' : 'Remove from route') : (es ? 'Incluir en la ruta' : 'Include in route')}
                    >
                      {item.include ? '✓' : '+'}
                    </button>
                    {keepOrder && (
                      <div className="flex gap-0.5">
                        <button onClick={() => moveItem(idx, -1)} className="w-4 text-stone-400 text-xs" aria-label={es ? 'Subir' : 'Move up'}>▲</button>
                        <button onClick={() => moveItem(idx, 1)} className="w-4 text-stone-400 text-xs" aria-label={es ? 'Bajar' : 'Move down'}>▼</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Not found: let the user fix the name (e.g. official or local name) and retry */}
                {item.status === 'missing' && (
                  <div className="flex gap-2 mt-2">
                    <input
                      value={item.editName}
                      onChange={e => updateItem(idx, { editName: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && retryItem(idx)}
                      className="flex-1 min-w-0 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                      placeholder={es ? 'Nombre oficial o local' : 'Official or local name'}
                    />
                    <button
                      onClick={() => retryItem(idx)}
                      className="px-3 py-2 bg-stone-800 text-white text-xs font-semibold rounded-xl active:scale-95 transition-transform"
                    >
                      {es ? 'Buscar' : 'Search'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'review' && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-sm border-t border-stone-100 safe-bottom">
          <button
            onClick={() => setKeepOrder(k => !k)}
            className="w-full flex items-center gap-3 mb-3 text-left"
          >
            <div className={`w-10 h-5 rounded-full flex items-center transition-colors px-0.5 flex-shrink-0 ${keepOrder ? 'bg-orange-500' : 'bg-stone-300'}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${keepOrder ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
            <span className="text-stone-600 text-sm">
              {keepOrder
                ? (es ? 'Seguir el orden del texto' : 'Follow the order of the text')
                : (es ? 'Optimizar el orden para caminar menos' : 'Optimise order to walk less')}
            </span>
          </button>
          <Button fullWidth size="lg" onClick={createRoute} disabled={selectedPOIs.length < 2}>
            🚀 {selectedPOIs.length < 2
              ? (es ? 'Se necesitan al menos 2 lugares' : 'At least 2 places needed')
              : (es ? `Crear ruta (${selectedPOIs.length} paradas)` : `Create route (${selectedPOIs.length} stops)`)}
          </Button>
        </div>
      )}
    </div>
  )
}
