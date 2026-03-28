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
import { searchPOIsWikipedia, searchPOIByName } from '../services/wikigeo'
import { generateAIRoute, hasAIKey, getAIKey } from '../services/ai'
import { getRoute, getStepByStepInstructions, getDirectRoute, orderPOIsOptimally } from '../services/routing'
import type { Route, RouteType, RouteDuration, POI, RouteSegment } from '../types'
import { ROUTE_TYPE_INFO } from '../types'

// Fallback order when requested type yields no results
const ROUTE_FALLBACKS: Record<RouteType, RouteType[]> = {
  imprescindibles: ['monumental', 'arquitectura', 'curiosidades'],
  secretos_locales: ['curiosidades', 'historia_negra', 'monumental'],
  monumental: ['arquitectura', 'curiosidades', 'imprescindibles'],
  historia_negra: ['curiosidades', 'monumental', 'secretos_locales'],
  curiosidades: ['monumental', 'secretos_locales', 'arquitectura'],
  gastronomia: ['curiosidades', 'monumental', 'naturaleza'],
  arquitectura: ['monumental', 'curiosidades', 'imprescindibles'],
  naturaleza: ['curiosidades', 'monumental', 'gastronomia'],
}

const POPULAR_SUGGESTIONS = [
  { icon: '⭐', type: 'imprescindibles' as RouteType, duration: 120 as RouteDuration, label_es: 'Imprescindibles 2h', label_en: '2h Must-Sees' },
  { icon: '🏛️', type: 'monumental' as RouteType, duration: 180 as RouteDuration, label_es: 'Monumental 3h', label_en: '3h Monuments' },
  { icon: '🗝️', type: 'secretos_locales' as RouteType, duration: 120 as RouteDuration, label_es: 'Secretos 2h', label_en: '2h Secrets' },
  { icon: '💀', type: 'historia_negra' as RouteType, duration: 120 as RouteDuration, label_es: 'Historia oscura 2h', label_en: '2h Dark history' },
]

export function RouteSetupPage() {
  const { cityName } = useParams<{ cityName: string }>()
  const navigate = useNavigate()
  const {
    language, selectedCity, setCity, selectedRouteType, setRouteType,
    selectedDuration, setDuration, setPOIs, setRoute, setLoading, setError,
    isLoading, loadingMessage, error,
    anthropicApiKey, getVisitedPOINames
  } = useAppStore()

  const [cityImage, setCityImage] = useState<string | null>(null)
  const [cityDesc, setCityDesc] = useState<string>('')
  const [generatingRoute, setGeneratingRoute] = useState(false)
  const [fallbackInfo, setFallbackInfo] = useState<{ requested: RouteType; found: RouteType } | null>(null)
  const [aiRouteStory, setAiRouteStory] = useState<string | null>(null)
  const [usingAI, setUsingAI] = useState(false)

  // Load city from URL param
  useEffect(() => {
    if (!selectedCity && cityName) {
      searchCities(decodeURIComponent(cityName), language).then(cities => {
        if (cities[0]) setCity(cities[0])
      })
    }
  }, [cityName, selectedCity, language, setCity])

  // Load city header image + description
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
    setAiRouteStory(null)
    setUsingAI(false)

    const maxPOIs = Math.max(3, Math.min(12, Math.floor(selectedDuration / 20)))
    const visitedNames = getVisitedPOINames(selectedCity.id)
    const aiAvailable = hasAIKey(anthropicApiKey)
    const aiKey = getAIKey(anthropicApiKey)

    setLoading(true, language === 'es' ? 'Buscando lugares de interés...' : 'Finding points of interest...')

    try {
      let pois: POI[] = []
      let usedRouteType = selectedRouteType

      // ============================================================
      // AI-ENHANCED PATH: Mistral generates curated POI list
      // ============================================================
      if (aiAvailable) {
        setLoading(true, language === 'es' ? '🤖 Creando ruta con IA...' : '🤖 Creating AI-powered route...')
        setUsingAI(true)

        const aiResult = await generateAIRoute(
          selectedCity.name,
          selectedRouteType,
          selectedDuration,
          language,
          aiKey,
          visitedNames
        )

        if (aiResult && aiResult.suggestedPOIs.length > 0) {
          setAiRouteStory(aiResult.routeStory)

          // Resolve each AI-suggested POI to real Wikipedia data + coordinates
          setLoading(true, language === 'es' ? '🔍 Verificando lugares en Wikipedia...' : '🔍 Verifying places on Wikipedia...')

          const resolvedPOIs: POI[] = []
          for (const aiPOI of aiResult.suggestedPOIs) {
            const wikiPOI = await searchPOIByName(aiPOI.name, selectedCity, selectedRouteType, language)
            if (wikiPOI) {
              resolvedPOIs.push({
                ...wikiPOI,
                // Enhance with AI metadata
                shortDescription: aiPOI.reason,
                tags: { ...(wikiPOI.tags || {}), insiderTip: aiPOI.insiderTip || '' },
              })
            }
          }

          if (resolvedPOIs.length >= 3) {
            pois = resolvedPOIs
          } else {
            // AI suggestions not verifiable, fall through to Wikipedia geosearch
            setUsingAI(false)
          }
        } else {
          setUsingAI(false)
        }
      }

      // ============================================================
      // WIKIPEDIA GEOSEARCH PATH (fallback or no API key)
      // ============================================================
      if (pois.length < 3) {
        async function searchForType(rType: RouteType): Promise<POI[]> {
          setLoading(true, language === 'es' ? `Buscando en Wikipedia...` : 'Searching Wikipedia...')
          let results = await searchPOIsWikipedia(selectedCity!, rType, maxPOIs, language, visitedNames)
          if (results.length < 3) {
            setLoading(true, language === 'es' ? 'Buscando en OpenStreetMap...' : 'Searching OpenStreetMap...')
            const overpassPOIs = await getPOIsByCity(selectedCity!, rType, selectedDuration!)
            const existingNames = new Set(results.map(p => p.name.toLowerCase()))
            for (const op of overpassPOIs) {
              if (!existingNames.has(op.name.toLowerCase()) &&
                  !visitedNames.some(v => v.toLowerCase() === op.name.toLowerCase())) {
                results.push(op)
                existingNames.add(op.name.toLowerCase())
              }
            }
          }
          return results
        }

        let found = await searchForType(selectedRouteType)

        // Try fallback types if still not enough
        if (found.length < 3) {
          for (const fbType of ROUTE_FALLBACKS[selectedRouteType] || []) {
            const fbRouteInfo = ROUTE_TYPE_INFO.find(r => r.id === fbType)
            setLoading(true, language === 'es'
              ? `Buscando alternativas: "${fbRouteInfo?.labelEs || fbType}"...`
              : `Searching alternatives: "${fbRouteInfo?.labelEn || fbType}"...`)
            const fbPOIs = await searchForType(fbType)
            if (fbPOIs.length >= 3) {
              found = fbPOIs
              usedRouteType = fbType
              setFallbackInfo({ requested: selectedRouteType, found: fbType })
              break
            }
          }
        }

        pois = found
      }

      if (pois.length === 0) {
        setError(language === 'es'
          ? 'No se encontraron lugares de interés. Prueba otra ciudad o tipo de ruta.'
          : 'No points of interest found. Try another city or route type.')
        setGeneratingRoute(false)
        setLoading(false)
        return
      }

      // Order POIs for optimal walking path
      pois = orderPOIsOptimally(pois, selectedCity.lat, selectedCity.lon)
      setPOIs(pois)

      setLoading(true, language === 'es' ? 'Calculando ruta a pie...' : 'Calculating walking route...')

      // Build OSRM segments
      const segments: RouteSegment[] = []
      let totalDistance = 0
      let totalDuration = 0

      for (let i = 0; i < pois.length - 1; i++) {
        const from = pois[i], to = pois[i + 1]
        try {
          const result = await getRoute([[from.lat, from.lon], [to.lat, to.lon]])
          if (result) {
            // Parse steps for navigation
            const steps = getStepByStepInstructions(result)
            segments.push({ from, to, steps, distance: result.distance, duration: result.duration, geometry: result.geometry.coordinates })
            totalDistance += result.distance
            totalDuration += result.duration
          } else {
            // OSRM failed — use direct compass navigation as fallback
            const direct = getDirectRoute(from, to)
            const steps = getStepByStepInstructions(direct)
            segments.push({ from, to, steps, distance: direct.distance, duration: direct.duration, geometry: [[from.lon, from.lat], [to.lon, to.lat]] })
          }
        } catch {
            const direct = getDirectRoute(from, to)
            const steps = getStepByStepInstructions(direct)
            segments.push({ from, to, steps, distance: direct.distance, duration: direct.duration, geometry: [[from.lon, from.lat], [to.lon, to.lat]] })
        }
      }

      const route: Route = {
        id: `${selectedCity.id}-${usedRouteType}-${Date.now()}`,
        city: selectedCity,
        routeType: usedRouteType,
        duration: selectedDuration,
        pois,
        segments,
        totalDistance,
        totalDuration,
        createdAt: new Date().toISOString(),
        language,
        isOffline: false,
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
  const visitedCount = selectedCity ? getVisitedPOINames(selectedCity.id).length : 0

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

      <div className="px-5 py-6 pb-36">

        {/* AI mode badge — shown whenever AI key is available (built-in or user-provided) */}
        {hasAIKey(anthropicApiKey) && (
          <div className="mb-4 bg-gradient-to-r from-orange-50 to-amber-50 rounded-2xl px-4 py-3 flex items-center gap-3 border border-orange-100">
            <span className="text-xl">🤖</span>
            <div className="flex-1">
              <p className="text-orange-800 text-sm font-semibold">
                {language === 'es' ? 'Guía profesional con IA activado' : 'AI professional guide active'}
              </p>
              <p className="text-orange-600 text-xs">
                {language === 'es' ? 'Rutas curadas al estilo Civitatis · Narraciones personalizadas' : 'Civitatis-style curated routes · Personalized narrations'}
              </p>
            </div>
            <span className="text-orange-500 font-black text-sm">✨</span>
          </div>
        )}

        {/* Visit history notice */}
        {visitedCount > 0 && (
          <div className="mb-4 bg-blue-50 rounded-2xl px-4 py-3 flex items-center gap-3 border border-blue-100">
            <span className="text-xl">🔄</span>
            <p className="text-blue-700 text-sm">
              {language === 'es'
                ? `Ya visitaste ${visitedCount} lugares aquí. Tu ruta excluirá los ya vistos.`
                : `You already visited ${visitedCount} places here. Your route will exclude them.`}
            </p>
          </div>
        )}

        {/* Fallback notice */}
        {fallbackInfo && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-xl flex-shrink-0">💡</span>
            <div className="flex-1">
              <p className="text-amber-800 text-sm font-semibold">
                {language === 'es' ? 'No encontramos exactamente lo que pediste' : "We couldn't find exactly what you requested"}
              </p>
              <p className="text-amber-700 text-xs mt-0.5">
                {language === 'es'
                  ? `No hay suficientes puntos de "${ROUTE_TYPE_INFO.find(r => r.id === fallbackInfo.requested)?.labelEs}". Te proponemos: "${ROUTE_TYPE_INFO.find(r => r.id === fallbackInfo.found)?.labelEs}".`
                  : `Not enough "${ROUTE_TYPE_INFO.find(r => r.id === fallbackInfo.requested)?.labelEn}" spots. Showing: "${ROUTE_TYPE_INFO.find(r => r.id === fallbackInfo.found)?.labelEn}".`}
              </p>
            </div>
            <button onClick={() => setFallbackInfo(null)} className="text-amber-400 text-lg leading-none flex-shrink-0">×</button>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-xl flex-shrink-0">⚠️</span>
            <p className="flex-1 text-red-700 text-sm font-medium">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 text-lg leading-none flex-shrink-0">×</button>
          </div>
        )}

        {/* Quick suggestions */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
            {language === 'es' ? 'Sugerencias populares' : 'Popular suggestions'}
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {POPULAR_SUGGESTIONS.map(s => (
              <button
                key={`${s.type}-${s.duration}`}
                onClick={() => { setRouteType(s.type); setDuration(s.duration) }}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all active:scale-95 ${
                  selectedRouteType === s.type && selectedDuration === s.duration
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                <span>{s.icon}</span>
                <span>{language === 'es' ? s.label_es : s.label_en}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Route type selector */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-stone-800 mb-1">
            {language === 'es' ? 'Elige tu tipo de ruta' : 'Choose your route type'}
          </h2>
          <p className="text-stone-400 text-sm mb-4">
            {language === 'es' ? '¿Qué quieres descubrir hoy?' : 'What do you want to discover today?'}
          </p>
          <RouteTypeSelector selected={selectedRouteType} onSelect={type => { setRouteType(type) }} />
        </div>

        {/* Duration selector */}
        {selectedRouteType && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-stone-800 mb-1">
              {language === 'es' ? '¿Cuánto tiempo tienes?' : 'How much time do you have?'}
            </h2>
            <p className="text-stone-400 text-sm mb-4">
              {language === 'es' ? 'Adaptamos la ruta a tu disponibilidad' : 'We adapt the route to your availability'}
            </p>
            <DurationSelector selected={selectedDuration} onSelect={setDuration} />
          </div>
        )}

        {/* Summary card */}
        {selectedRouteType && selectedDuration && currentRouteInfo && (
          <div className="bg-orange-50 rounded-2xl p-4 mb-6 border border-orange-100">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{currentRouteInfo.icon}</span>
              <div>
                <p className="font-bold text-stone-800">
                  {language === 'es' ? currentRouteInfo.labelEs : currentRouteInfo.labelEn}
                </p>
                <p className="text-sm text-stone-500">
                  {language === 'es'
                    ? `${selectedDuration === 480 ? 'Día completo' : selectedDuration === 240 ? 'Medio día' : `${selectedDuration / 60}h`} · ~${Math.floor(selectedDuration / 20)} paradas`
                    : `${selectedDuration === 480 ? 'Full day' : selectedDuration === 240 ? 'Half day' : `${selectedDuration / 60}h`} · ~${Math.floor(selectedDuration / 20)} stops`}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Generate button */}
      {selectedRouteType && selectedDuration && (
        <div className="fixed bottom-0 left-0 right-0 p-5 bg-white/90 backdrop-blur-sm border-t border-stone-100 safe-bottom">
          <Button fullWidth size="lg" onClick={generateRoute} loading={generatingRoute}>
            {hasAIKey(anthropicApiKey)
              ? (language === 'es' ? '🤖 Crear ruta con IA' : '🤖 Create AI route')
              : (language === 'es' ? '🚀 Generar ruta' : '🚀 Generate route')}
          </Button>
        </div>
      )}
    </div>
  )
}
