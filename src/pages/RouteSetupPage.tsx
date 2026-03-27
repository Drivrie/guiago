import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RouteTypeSelector } from '../components/RouteTypeSelector'
import { DurationSelector } from '../components/DurationSelector'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../stores/appStore'
import { getPOIsByCity } from '../services/overpass'
import { searchCities } from '../services/nominatim'
import { getCityDescription } from '../services/wikipedia'
import { searchPOIsWikipedia } from '../services/wikigeo'
import { getRoute } from '../services/routing'
import { orderPOIsOptimally } from '../services/routing'
import type { Route, RouteType, RouteDuration, POI, RouteSegment } from '../types'
import { ROUTE_TYPE_INFO } from '../types'

// Fallback order: if requested type yields no POIs, try these alternatives
const ROUTE_FALLBACKS: Record<RouteType, RouteType[]> = {
  monumental: ['arquitectura', 'curiosidades', 'naturaleza'],
  historia_negra: ['curiosidades', 'monumental', 'arquitectura'],
  curiosidades: ['monumental', 'historia_negra', 'arquitectura'],
  gastronomia: ['curiosidades', 'monumental', 'naturaleza'],
  arquitectura: ['monumental', 'curiosidades', 'historia_negra'],
  naturaleza: ['curiosidades', 'monumental', 'gastronomia'],
}

const POPULAR_ROUTE_SUGGESTIONS = [
  { icon: '🏛️', type: 'monumental' as RouteType, duration: 120 as RouteDuration, label_es: 'Tour monumental 2h', label_en: '2h monuments tour' },
  { icon: '💀', type: 'historia_negra' as RouteType, duration: 120 as RouteDuration, label_es: 'Historia oscura 2h', label_en: '2h dark history' },
  { icon: '🔍', type: 'curiosidades' as RouteType, duration: 60 as RouteDuration, label_es: 'Curiosidades 1h', label_en: '1h curiosities' },
  { icon: '🏗️', type: 'arquitectura' as RouteType, duration: 180 as RouteDuration, label_es: 'Arquitectura 3h', label_en: '3h architecture' },
]

export function RouteSetupPage() {
  const { cityName } = useParams<{ cityName: string }>()
  const navigate = useNavigate()
  const {
    language, selectedCity, setCity, selectedRouteType, setRouteType,
    selectedDuration, setDuration, setPOIs, setRoute, setLoading, setError, isLoading,
    loadingMessage, error
  } = useAppStore()

  const [cityImage, setCityImage] = useState<string | null>(null)
  const [cityDesc, setCityDesc] = useState<string>('')
  const [generatingRoute, setGeneratingRoute] = useState(false)
  const [step, setStep] = useState<'type' | 'duration'>('type')
  const [fallbackInfo, setFallbackInfo] = useState<{ requested: RouteType; found: RouteType } | null>(null)

  // Load city if needed
  useEffect(() => {
    if (!selectedCity && cityName) {
      searchCities(decodeURIComponent(cityName), language).then(cities => {
        if (cities[0]) setCity(cities[0])
      })
    }
  }, [cityName, selectedCity, language, setCity])

  // Load city info
  useEffect(() => {
    if (!selectedCity) return
    getCityDescription(selectedCity.name, language).then(result => {
      if (result) {
        setCityImage(result.imageUrl || null)
        setCityDesc(result.extract?.slice(0, 150) + '...' || '')
      }
    })
  }, [selectedCity, language])

  async function generateRoute() {
    if (!selectedCity || !selectedRouteType || !selectedDuration) return

    setGeneratingRoute(true)
    setFallbackInfo(null)
    const maxPOIs = Math.floor(selectedDuration / 15) // ~15 min per POI
    setLoading(true, language === 'es' ? 'Buscando lugares de interés...' : 'Finding points of interest...')

    try {
      // Helper: search Wikipedia + Overpass for a given route type
      async function searchForType(rType: RouteType): Promise<POI[]> {
        let results = await searchPOIsWikipedia(selectedCity!, rType, maxPOIs, language)
        if (results.length < 3) {
          setLoading(true, language === 'es' ? 'Buscando en OpenStreetMap...' : 'Searching OpenStreetMap...')
          const overpassPOIs = await getPOIsByCity(selectedCity!, rType, selectedDuration!)
          const existingNames = new Set(results.map(p => p.name.toLowerCase()))
          for (const op of overpassPOIs) {
            if (!existingNames.has(op.name.toLowerCase())) {
              results.push(op)
              existingNames.add(op.name.toLowerCase())
            }
          }
        }
        return results
      }

      // 1. Try requested route type first
      let pois = await searchForType(selectedRouteType)
      let usedRouteType = selectedRouteType

      // 2. If not enough POIs, try fallback types
      if (pois.length < 3) {
        const fallbacks = ROUTE_FALLBACKS[selectedRouteType] || []
        for (const fbType of fallbacks) {
          setLoading(true, language === 'es'
            ? `Buscando alternativas de tipo "${ROUTE_TYPE_INFO.find(r => r.id === fbType)?.[language === 'es' ? 'labelEs' : 'labelEn'] || fbType}"...`
            : `Searching for "${fbType}" alternatives...`)
          const fbPOIs = await searchForType(fbType)
          if (fbPOIs.length >= 3) {
            pois = fbPOIs
            usedRouteType = fbType
            setFallbackInfo({ requested: selectedRouteType, found: fbType })
            break
          }
        }
      }

      if (pois.length === 0) {
        setError(language === 'es'
          ? 'No se encontraron lugares de interés en esta ciudad. Prueba con otra ciudad o tipo de ruta.'
          : 'No points of interest found in this city. Try another city or route type.')
        setGeneratingRoute(false)
        setLoading(false)
        return
      }

      // 2. Order POIs optimally
      pois = orderPOIsOptimally(pois, selectedCity.lat, selectedCity.lon)
      setPOIs(pois)

      setLoading(true, language === 'es' ? 'Calculando la ruta...' : 'Calculating route...')

      // 3. Build route segments (OSRM)
      const segments: RouteSegment[] = []
      let totalDistance = 0
      let totalDuration = 0

      for (let i = 0; i < pois.length - 1; i++) {
        const from = pois[i]
        const to = pois[i + 1]
        const result = await getRoute([[from.lat, from.lon], [to.lat, to.lon]])
        if (result) {
          const steps = result.legs.flatMap(leg => leg.steps.map(s => ({
            instruction: s.instruction,
            distance: s.distance.value,
            duration: s.duration.value,
            direction: s.maneuver ? undefined : undefined,
          })))
          segments.push({
            from, to,
            steps,
            distance: result.distance,
            duration: result.duration,
            geometry: result.geometry.coordinates
          })
          totalDistance += result.distance
          totalDuration += result.duration
        } else {
          // Fallback: straight line
          segments.push({
            from, to, steps: [], distance: 0, duration: 0, geometry: [[from.lon, from.lat], [to.lon, to.lat]]
          })
        }
      }

      // 4. Build route object
      const route: Route = {
        id: `${selectedCity.id}-${selectedRouteType}-${Date.now()}`,
        city: selectedCity,
        routeType: selectedRouteType,
        duration: selectedDuration,
        pois,
        segments,
        totalDistance,
        totalDuration,
        createdAt: new Date().toISOString(),
        language,
        isOffline: false
      }

      setRoute(route)
      navigate('/route/active')
    } catch (err) {
      setError(language === 'es'
        ? 'Error al generar la ruta. Comprueba tu conexión.'
        : 'Error generating route. Check your connection.')
    } finally {
      setGeneratingRoute(false)
      setLoading(false)
    }
  }

  const currentRouteInfo = selectedRouteType ? ROUTE_TYPE_INFO.find(r => r.id === selectedRouteType) : null

  return (
    <div className="min-h-screen bg-stone-50 safe-top">
      {isLoading && <LoadingSpinner fullScreen message={loadingMessage} />}

      {/* City hero */}
      <div className="relative h-52 bg-stone-800 overflow-hidden">
        {cityImage ? (
          <img src={cityImage} alt={selectedCity?.name} className="w-full h-full object-cover opacity-70" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-orange-400 to-amber-600 opacity-80" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="absolute top-safe-top left-4 mt-4 w-10 h-10 bg-black/30 backdrop-blur-sm rounded-xl flex items-center justify-center text-white"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="absolute bottom-4 left-4 right-4">
          <h1 className="text-white text-3xl font-black">{selectedCity?.name || cityName}</h1>
          {cityDesc && <p className="text-white/70 text-sm mt-1 line-clamp-2">{cityDesc}</p>}
        </div>
      </div>

      <div className="px-5 py-6 pb-32">
        {/* Fallback route notice */}
        {fallbackInfo && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-xl flex-shrink-0">💡</span>
            <div className="flex-1">
              <p className="text-amber-800 text-sm font-semibold">
                {language === 'es' ? 'No encontramos exactamente lo que pediste' : "We couldn't find exactly what you requested"}
              </p>
              <p className="text-amber-700 text-xs mt-0.5">
                {language === 'es'
                  ? `No hay suficientes puntos de tipo "${ROUTE_TYPE_INFO.find(r => r.id === fallbackInfo.requested)?.[language === 'es' ? 'labelEs' : 'labelEn']}" en esta ciudad. Te proponemos la ruta más similar disponible: "${ROUTE_TYPE_INFO.find(r => r.id === fallbackInfo.found)?.[language === 'es' ? 'labelEs' : 'labelEn']}".`
                  : `Not enough "${ROUTE_TYPE_INFO.find(r => r.id === fallbackInfo.requested)?.labelEn}" spots here. We're showing the closest available route: "${ROUTE_TYPE_INFO.find(r => r.id === fallbackInfo.found)?.labelEn}".`}
              </p>
            </div>
            <button onClick={() => setFallbackInfo(null)} className="text-amber-400 text-lg leading-none flex-shrink-0">×</button>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-xl flex-shrink-0">⚠️</span>
            <div className="flex-1">
              <p className="text-red-700 text-sm font-medium">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 text-lg leading-none flex-shrink-0">×</button>
          </div>
        )}

        {/* Sugerencias populares */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
            {language === 'es' ? 'Sugerencias populares' : 'Popular suggestions'}
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {POPULAR_ROUTE_SUGGESTIONS.map(suggestion => (
              <button
                key={`${suggestion.type}-${suggestion.duration}`}
                onClick={() => {
                  setRouteType(suggestion.type)
                  setDuration(suggestion.duration)
                  setStep('duration')
                }}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all active:scale-95 ${
                  selectedRouteType === suggestion.type && selectedDuration === suggestion.duration
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                <span>{suggestion.icon}</span>
                <span>{language === 'es' ? suggestion.label_es : suggestion.label_en}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Step 1: Route type */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-stone-800 mb-1">
            {language === 'es' ? 'Elige tu tipo de ruta' : 'Choose your route type'}
          </h2>
          <p className="text-stone-400 text-sm mb-4">
            {language === 'es' ? '¿Qué quieres descubrir hoy?' : 'What do you want to discover today?'}
          </p>
          <RouteTypeSelector
            selected={selectedRouteType}
            onSelect={type => { setRouteType(type); setStep('duration') }}
          />
        </div>

        {/* Step 2: Duration */}
        {selectedRouteType && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-stone-800 mb-1">
              {language === 'es' ? '¿Cuánto tiempo tienes?' : 'How much time do you have?'}
            </h2>
            <p className="text-stone-400 text-sm mb-4">
              {language === 'es' ? 'Adaptamos la ruta a tu disponibilidad' : 'We adapt the route to your availability'}
            </p>
            <DurationSelector
              selected={selectedDuration}
              onSelect={setDuration}
            />
          </div>
        )}

        {/* Summary */}
        {selectedRouteType && selectedDuration && currentRouteInfo && (
          <div className="bg-orange-50 rounded-2xl p-4 mb-6 border border-orange-100">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{currentRouteInfo.icon}</span>
              <div>
                <p className="font-bold text-stone-800">
                  {language === 'es' ? currentRouteInfo.labelEs : currentRouteInfo.labelEn}
                </p>
                <p className="text-sm text-stone-500">
                  {language === 'es' ? `Duración: ${selectedDuration === 480 ? 'Día completo' : selectedDuration === 240 ? 'Medio día' : `${selectedDuration / 60}h`}` :
                    `Duration: ${selectedDuration === 480 ? 'Full day' : selectedDuration === 240 ? 'Half day' : `${selectedDuration / 60}h`}`}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Generate button */}
      {selectedRouteType && selectedDuration && (
        <div className="fixed bottom-0 left-0 right-0 p-5 bg-white/90 backdrop-blur-sm border-t border-stone-100 safe-bottom">
          <Button
            fullWidth
            size="lg"
            onClick={generateRoute}
            loading={generatingRoute}
          >
            {language === 'es' ? '🚀 Generar ruta' : '🚀 Generate route'}
          </Button>
        </div>
      )}
    </div>
  )
}
