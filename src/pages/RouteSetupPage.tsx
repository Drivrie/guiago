import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
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
import { getRoute, getStepByStepInstructions, getDirectRoute, orderPOIsOptimally, fitRouteToTimeBudget, pruneOutlierPOIs } from '../services/routing'
import type { Route, RouteType, RouteDuration, POI, RouteSegment } from '../types'

type TravelMode = 'walk' | 'transit'

/** Search radius in metres, scaled to how far you can realistically travel. */
function searchRadius(durationMin: number, mode: TravelMode): number {
  if (mode === 'transit') return 8000
  // Walking: ~84 m/min × duration / 4 (you're not walking continuously)
  return Math.min(5000, Math.max(1500, Math.round(durationMin * 22)))
  // 60→1500, 120→2640, 180→3960, 240→5000
}
import { ROUTE_TYPE_INFO } from '../types'

// Theme-preserving fallback chain. CRITICAL: each type falls back to types
// that share the SAME spirit, so a "gastronomía" route never degrades into
// a "monumental" route (which is what made the app feel like all filters
// returned the same POIs).
const ROUTE_FALLBACKS: Record<RouteType, RouteType[]> = {
  imprescindibles: ['monumental', 'arquitectura', 'curiosidades'],
  secretos_locales: ['curiosidades', 'naturaleza', 'gastronomia'],
  monumental: ['arquitectura', 'imprescindibles'],
  historia_negra: ['curiosidades', 'secretos_locales'],
  curiosidades: ['secretos_locales', 'arquitectura'],
  gastronomia: ['naturaleza', 'curiosidades', 'secretos_locales'],
  arquitectura: ['monumental', 'imprescindibles'],
  naturaleza: ['secretos_locales', 'curiosidades'],
}

// Classifies route types by which DATA SOURCE works best for them:
// - 'landmark': Wikipedia geosearch is the right source (iconic monuments).
// - 'osm': OSM/Overpass is the right source (food, parks — most are NOT on
//   Wikipedia at all).
// - 'narrative': AI curation is the right source (hidden gems, dark history,
//   quirky curiosities — Wikipedia and OSM rarely tag these correctly).
function routeCategory(routeType: RouteType): 'landmark' | 'osm' | 'narrative' {
  switch (routeType) {
    case 'imprescindibles':
    case 'monumental':
    case 'arquitectura':
      return 'landmark'
    case 'gastronomia':
    case 'naturaleza':
      return 'osm'
    case 'secretos_locales':
    case 'historia_negra':
    case 'curiosidades':
      return 'narrative'
  }
}

// Hard off-theme category exclusions used as a final safety net after all
// search paths. If a POI's category falls in the off-theme set for the
// requested type, it's dropped — even if it scored well in Wikipedia/Overpass.
const OFF_THEME_CATEGORIES: Record<RouteType, RegExp | null> = {
  imprescindibles: null,
  monumental: null,
  arquitectura: null,
  gastronomia: /catedral|cathedral|basílica|basilica|iglesia|church|sinagoga|synagogue|mezquita|mosque|convento|convent|monasterio|monastery|cementerio|cemetery|castillo|castle|palacio|palace|museo|museum/i,
  historia_negra: /jardín|garden|parque|park|fuente|fountain|mercado|market|restaurante|restaurant|cafetería|cafe|bar/i,
  curiosidades: null,
  secretos_locales: null,
  naturaleza: /catedral|cathedral|basílica|basilica|palacio|palace|castillo|castle|museo|museum|sinagoga|synagogue|mezquita|mosque|cementerio|cemetery|restaurante|restaurant|bar|cafetería|cafe/i,
}

function filterByThemeCategory(pois: POI[], routeType: RouteType): POI[] {
  const off = OFF_THEME_CATEGORIES[routeType]
  if (!off) return pois
  return pois.filter(p => {
    const hay = `${p.category} ${p.name}`.toLowerCase()
    return !off.test(hay)
  })
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
  const routerLocation = useLocation()
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
  const [travelMode, setTravelMode] = useState<TravelMode>('walk')
  // Inherit avoidVisited from TodayPage nav state if present, default true
  const [avoidVisited, setAvoidVisited] = useState<boolean>(
    (routerLocation.state as { avoidVisited?: boolean } | null)?.avoidVisited ?? true
  )

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

    // Collect more candidates than needed — fitting trims to what actually fits in time+distance.
    // Target: at least 20 candidates so the nearest-neighbor + time-budget algorithm has choices.
    const candidateTarget = 20
    const radius = searchRadius(selectedDuration, travelMode)
    const visitedNames = avoidVisited ? getVisitedPOINames(selectedCity.id) : []
    const aiAvailable = hasAIKey(anthropicApiKey)
    const aiKey = getAIKey(anthropicApiKey)

    setLoading(true, language === 'es' ? 'Buscando lugares de interés...' : 'Finding points of interest...')

    try {
      let pois: POI[] = []
      let usedRouteType = selectedRouteType

      // ============================================================
      // STEP 1 — AI path: ask AI for curated POI suggestions
      // ============================================================
      if (aiAvailable) {
        setLoading(true, language === 'es' ? '🤖 Creando ruta con IA...' : '🤖 Creating AI-powered route...')
        setUsingAI(true)

        const aiResult = await generateAIRoute(
          selectedCity.name,
          selectedCity.country,
          selectedRouteType,
          selectedDuration,
          language,
          aiKey,
          visitedNames
        )

        if (aiResult && aiResult.suggestedPOIs.length > 0) {
          setAiRouteStory(aiResult.routeStory)

          // Resolve each AI-suggested POI to real Wikipedia coordinates.
          // ALL lookups run in PARALLEL — sequentially this took 15-30 s
          // (each POI = 2-6 HTTP round-trips); in parallel it takes the
          // duration of the slowest single lookup (~2-4 s).
          setLoading(true, language === 'es' ? '🔍 Verificando lugares en Wikipedia...' : '🔍 Verifying places on Wikipedia...')

          const lookups = await Promise.allSettled(
            aiResult.suggestedPOIs.map(aiPOI =>
              searchPOIByName(aiPOI.name, selectedCity, selectedRouteType, language)
                .then(wikiPOI => ({ aiPOI, wikiPOI }))
            )
          )

          const resolvedPOIs: POI[] = []
          for (const settled of lookups) {
            if (settled.status !== 'fulfilled') continue
            const { aiPOI, wikiPOI } = settled.value
            if (!wikiPOI) continue
            const distDeg = Math.sqrt(
              Math.pow(wikiPOI.lat - selectedCity.lat, 2) +
              Math.pow(wikiPOI.lon - selectedCity.lon, 2)
            )
            if (distDeg > 0.5) {
              console.warn(`Rejected out-of-city POI: ${wikiPOI.name} (${wikiPOI.lat},${wikiPOI.lon}) for ${selectedCity.name}`)
              continue
            }
            resolvedPOIs.push({
              ...wikiPOI,
              shortDescription: aiPOI.reason,
              tags: { ...(wikiPOI.tags || {}), insiderTip: aiPOI.insiderTip || '' },
            })
          }

          // Accept any AI-resolved POIs — STEP 2 always supplements from
          // Wikipedia, so even a single good AI suggestion is worth keeping.
          if (resolvedPOIs.length > 0) {
            pois = resolvedPOIs
          }
          if (resolvedPOIs.length < 3) {
            setUsingAI(false)
          }
        } else {
          setUsingAI(false)
        }
      }

      // ============================================================
      // STEP 2 — Source-specific supplement, ordered by what each route
      // category needs most.
      // OSM types (gastronomia, naturaleza): Overpass FIRST — Wikipedia
      //   barely has these POIs. Wikipedia second only for famous markets.
      // Landmark types: Wikipedia geosearch first, Overpass second.
      // Narrative types: both as supplement (AI is the primary source).
      // ============================================================
      const category = routeCategory(selectedRouteType)
      const existingNames = new Set(pois.map(p => p.name.toLowerCase()))
      const supplementPushUnique = (extra: POI[]) => {
        for (const p of extra) {
          if (pois.length >= candidateTarget) break
          if (existingNames.has(p.name.toLowerCase())) continue
          if (visitedNames.some(v => v.toLowerCase() === p.name.toLowerCase())) continue
          existingNames.add(p.name.toLowerCase())
          pois.push(p)
        }
      }

      if (pois.length < candidateTarget) {
        if (category === 'osm') {
          setLoading(true, language === 'es' ? 'Buscando en OpenStreetMap...' : 'Searching OpenStreetMap...')
          supplementPushUnique(await getPOIsByCity(selectedCity!, selectedRouteType, selectedDuration!, radius))
          if (pois.length < candidateTarget) {
            setLoading(true, language === 'es' ? 'Buscando más lugares en Wikipedia...' : 'Finding more places on Wikipedia...')
            supplementPushUnique(await searchPOIsWikipedia(selectedCity!, selectedRouteType, candidateTarget, language, visitedNames, radius))
          }
        } else {
          setLoading(true, language === 'es' ? 'Buscando más lugares en Wikipedia...' : 'Finding more places on Wikipedia...')
          supplementPushUnique(await searchPOIsWikipedia(selectedCity!, selectedRouteType, candidateTarget, language, visitedNames, radius))
          if (pois.length < candidateTarget) {
            setLoading(true, language === 'es' ? 'Buscando en OpenStreetMap...' : 'Searching OpenStreetMap...')
            supplementPushUnique(await getPOIsByCity(selectedCity!, selectedRouteType, selectedDuration!, radius))
          }
        }
      }

      // ============================================================
      // STEP 3 — Theme safety filter. Drops any POI whose category
      // obviously belongs to a different theme (e.g. cathedral in a
      // gastronomía search), regardless of how well it scored. This is
      // what prevents the "all filters return the same iconic landmarks"
      // problem when AI / Wikipedia / Overpass all over-include.
      // ============================================================
      pois = filterByThemeCategory(pois, selectedRouteType)

      // ============================================================
      // STEP 4 — Theme-preserving fallback when truly empty.
      // Each fallback type goes through its own theme filter so we never
      // end up with off-theme padding (e.g. cathedrals in a gastronomic
      // fallback).
      // ============================================================
      if (pois.length < 2) {
        for (const fbType of ROUTE_FALLBACKS[selectedRouteType] || []) {
          const fbRouteInfo = ROUTE_TYPE_INFO.find(r => r.id === fbType)
          setLoading(true, language === 'es'
            ? `Buscando alternativas: "${fbRouteInfo?.labelEs || fbType}"...`
            : `Searching alternatives: "${fbRouteInfo?.labelEn || fbType}"...`)
          const fbWiki = await searchPOIsWikipedia(selectedCity!, fbType, candidateTarget, language, visitedNames, radius)
          const fbOverpass = await getPOIsByCity(selectedCity!, fbType, selectedDuration!, radius)
          const fbAll = filterByThemeCategory([...fbWiki, ...fbOverpass], fbType)
          if (fbAll.length >= 2) {
            pois = fbAll
            usedRouteType = fbType
            setFallbackInfo({ requested: selectedRouteType, found: fbType })
            break
          }
        }
      }

      if (pois.length === 0) {
        setError(language === 'es'
          ? 'No se encontraron lugares de interés. Prueba otra ciudad o tipo de ruta.'
          : 'No points of interest found. Try another city or route type.')
        setGeneratingRoute(false)
        setLoading(false)
        return
      }

      // Order POIs for an optimal walking path: nearest-neighbor + 2-opt
      // improvement (removes path crossings / zigzags that make routes feel
      // un-realistic for a professional walking tour).
      pois = orderPOIsOptimally(pois, selectedCity.lat, selectedCity.lon)

      // Trim the ordered list to what actually fits in the time budget.
      // Walking mode only — transit users accept longer travel times.
      if (travelMode === 'walk') {
        pois = fitRouteToTimeBudget(pois, selectedDuration)
        // Drop any "lonely" outlier whose nearest neighbours are both far
        // away (>1.5 km) — a real walking-tour route never has a single
        // POI sitting in the middle of a long detour.
        pois = pruneOutlierPOIs(pois, 1500)
      }

      setPOIs(pois)

      setLoading(true, language === 'es' ? 'Calculando ruta a pie...' : 'Calculating walking route...')

      // Build OSRM segments — all legs fetched in PARALLEL (sequentially this
      // added 1-2 s per stop; in parallel it costs one round-trip total).
      // Order is preserved because we map over index pairs.
      const segmentResults = await Promise.all(
        pois.slice(0, -1).map(async (from, i) => {
          const to = pois[i + 1]
          try {
            const result = await getRoute([[from.lat, from.lon], [to.lat, to.lon]], language)
            if (result) {
              const steps = getStepByStepInstructions(result)
              return { from, to, steps, distance: result.distance, duration: result.duration, geometry: result.geometry.coordinates, real: true }
            }
          } catch { /* fall through to direct */ }
          const direct = getDirectRoute(from, to)
          const steps = getStepByStepInstructions(direct)
          return { from, to, steps, distance: direct.distance, duration: direct.duration, geometry: [[from.lon, from.lat], [to.lon, to.lat]] as [number, number][], real: false }
        })
      )

      const segments: RouteSegment[] = segmentResults.map(({ real: _real, ...seg }) => seg)
      const totalDistance = segmentResults.reduce((sum, s) => sum + (s.real ? s.distance : 0), 0)
      const totalDuration = segmentResults.reduce((sum, s) => sum + (s.real ? s.duration : 0), 0)

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
        story: aiRouteStory || undefined,
      }

      setRoute(route)
      // Always show the preview screen so the visitor can review photos,
      // remove stops they don't fancy, reorder, and start with confidence.
      navigate('/route/preview')
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

        {/* Visit history toggle */}
        {visitedCount > 0 && (
          <button
            onClick={() => setAvoidVisited(v => !v)}
            className={`mb-4 w-full rounded-2xl px-4 py-3 flex items-center gap-3 border text-left transition-all active:scale-95 ${
              avoidVisited
                ? 'bg-blue-50 border-blue-200'
                : 'bg-stone-50 border-stone-200'
            }`}
          >
            <span className="text-xl flex-shrink-0">{avoidVisited ? '✅' : '🔄'}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${avoidVisited ? 'text-blue-700' : 'text-stone-600'}`}>
                {language === 'es'
                  ? `Evitar los ${visitedCount} lugares ya visitados`
                  : `Avoid the ${visitedCount} already visited places`}
              </p>
              <p className={`text-xs mt-0.5 ${avoidVisited ? 'text-blue-500' : 'text-stone-400'}`}>
                {avoidVisited
                  ? (language === 'es' ? 'Activo — la ruta incluirá solo sitios nuevos' : 'On — route will only include new places')
                  : (language === 'es' ? 'Desactivado — puede repetir lugares ya vistos' : 'Off — may include places you\u2019ve visited')}
              </p>
            </div>
            <div className={`w-11 h-6 rounded-full flex-shrink-0 flex items-center transition-colors px-0.5 ${avoidVisited ? 'bg-blue-500' : 'bg-stone-300'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${avoidVisited ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </button>
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

        {/* Travel mode selector */}
        {selectedRouteType && (
          <div className="mb-6">
            <h2 className="text-xl font-bold text-stone-800 mb-1">
              {language === 'es' ? '¿Cómo te vas a mover?' : 'How will you travel?'}
            </h2>
            <p className="text-stone-400 text-sm mb-4">
              {language === 'es'
                ? 'Ajusta la ruta a tu forma de desplazarte'
                : 'Adapt the route to how you get around'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                {
                  mode: 'walk' as TravelMode,
                  icon: '🚶',
                  label_es: 'A pie',
                  label_en: 'Walking',
                  sub_es: 'Ruta compacta en el centro',
                  sub_en: 'Compact route in the centre',
                },
                {
                  mode: 'transit' as TravelMode,
                  icon: '🚇',
                  label_es: 'Transporte',
                  label_en: 'Transit',
                  sub_es: 'Más lugares, metro o bus',
                  sub_en: 'More stops, metro or bus',
                },
              ] as const).map(opt => (
                <button
                  key={opt.mode}
                  onClick={() => setTravelMode(opt.mode)}
                  className={`flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all active:scale-95 ${
                    travelMode === opt.mode
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-stone-200 bg-white'
                  }`}
                >
                  <span className="text-3xl">{opt.icon}</span>
                  <span className={`font-bold text-sm ${travelMode === opt.mode ? 'text-orange-700' : 'text-stone-800'}`}>
                    {language === 'es' ? opt.label_es : opt.label_en}
                  </span>
                  <span className="text-xs text-stone-400 text-center leading-tight">
                    {language === 'es' ? opt.sub_es : opt.sub_en}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

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
                    ? `${travelMode === 'walk' ? '🚶' : '🚇'} ${selectedDuration === 480 ? 'Día completo' : selectedDuration === 240 ? 'Medio día' : `${selectedDuration / 60}h`} · ruta optimizada`
                    : `${travelMode === 'walk' ? '🚶' : '🚇'} ${selectedDuration === 480 ? 'Full day' : selectedDuration === 240 ? 'Half day' : `${selectedDuration / 60}h`} · optimised route`}
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
