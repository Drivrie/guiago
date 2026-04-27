import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { RouteTypeSelector } from '../components/RouteTypeSelector'
import { DurationSelector } from '../components/DurationSelector'
import { AudioPlayer } from '../components/AudioPlayer'
import { Button } from '../components/ui/Button'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { getPOIInfoMultiSource, generateAudioScript } from '../services/wikipedia'
import { generateAIPOIExplanation, getAIKey, hasAIKey } from '../services/ai'
import { ROUTE_TYPE_INFO } from '../types'
import type { City, RouteType, RouteDuration, WikiResult } from '../types'

interface DetectedLocation {
  city: City
  displayName: string
}

async function reverseGeocode(lat: number, lon: number): Promise<DetectedLocation | null> {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&zoom=10`,
      { headers: { 'Accept-Language': 'es,en' } }
    )
    if (!resp.ok) return null
    const data = await resp.json() as {
      place_id?: number
      display_name?: string
      address?: {
        city?: string; town?: string; village?: string; municipality?: string
        state?: string; country?: string; country_code?: string
      }
    }

    const addr = data.address || {}
    const cityName = addr.city || addr.town || addr.village || addr.municipality || ''
    if (!cityName) return null

    const city: City = {
      id: cityName.toLowerCase().replace(/\s+/g, '-'),
      name: cityName,
      displayName: data.display_name || cityName,
      country: addr.country || '',
      countryCode: (addr.country_code || '').toUpperCase(),
      lat,
      lon,
    }
    return { city, displayName: `${cityName}${addr.state ? `, ${addr.state}` : ''}` }
  } catch {
    return null
  }
}

export function TodayPage() {
  const navigate = useNavigate()
  const {
    language, setCity, setRouteType, setDuration,
    selectedRouteType, selectedDuration, getVisitedPOINames,
    setUserLocation, anthropicApiKey
  } = useAppStore()

  const [phase, setPhase] = useState<'locating' | 'selecting' | 'error'>('locating')
  const [location, setLocation] = useState<DetectedLocation | null>(null)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [avoidVisited, setAvoidVisited] = useState(true)
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null)

  // POI search state
  const [poiQuery, setPoiQuery] = useState('')
  const [poiResult, setPoiResult] = useState<WikiResult | null>(null)
  const [poiAudioScript, setPoiAudioScript] = useState('')
  const [poiSearchLoading, setPoiSearchLoading] = useState(false)
  const [poiAudioLoading, setPoiAudioLoading] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)

  const es = language === 'es'

  // Auto-detect location on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError(es ? 'Tu navegador no soporta geolocalización.' : 'Your browser does not support geolocation.')
      setPhase('error')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async pos => {
        setUserCoords([pos.coords.latitude, pos.coords.longitude])
        // Store GPS location globally so ActiveRoutePage can use it immediately
        setUserLocation([pos.coords.latitude, pos.coords.longitude])
        const result = await reverseGeocode(pos.coords.latitude, pos.coords.longitude)
        if (result) {
          setLocation(result)
          setPhase('selecting')
        } else {
          setGeoError(
            es
              ? 'No pudimos detectar tu ciudad. Prueba a buscarla manualmente.'
              : 'Could not detect your city. Try searching manually.'
          )
          setPhase('error')
        }
      },
      err => {
        const msg =
          err.code === 1
            ? (es ? 'Permiso de ubicación denegado. Actívalo en los ajustes.' : 'Location permission denied. Enable it in settings.')
            : (es ? 'No pudimos obtener tu ubicación. Verifica el GPS.' : 'Could not get your location. Check your GPS.')
        setGeoError(msg)
        setPhase('error')
      },
      { enableHighAccuracy: true, timeout: 6000 }
    )
  }, [])

  async function searchPOI(query: string) {
    if (!query.trim()) return
    setPoiSearchLoading(true)
    setPoiResult(null)
    setPoiAudioScript('')
    try {
      // Include city + country in query so Wikipedia returns the local result, not the most famous global one
      const cityCtx = [location?.city.name, location?.city.country].filter(Boolean).join(' ')
      const queryWithCity = cityCtx ? `${query.trim()} ${cityCtx}` : query.trim()
      const result = await getPOIInfoMultiSource(queryWithCity, language, location?.city.countryCode)
      if (!result) {
        setPoiSearchLoading(false)
        return
      }
      setPoiResult(result)
      setPoiSearchLoading(false)

      // Generate audio explanation
      setPoiAudioLoading(true)
      const cityName = location?.city.name || ''
      let audio: string | null = null
      if (hasAIKey(anthropicApiKey)) {
        audio = await generateAIPOIExplanation(result.title, cityName, result.extract, language, getAIKey(anthropicApiKey))
      }
      if (!audio) {
        audio = generateAudioScript({ name: result.title, category: 'lugar de interés', description: result.extract }, language)
      }
      setPoiAudioScript(audio || '')
    } catch {
      setPoiSearchLoading(false)
    } finally {
      setPoiAudioLoading(false)
    }
  }

  async function handleWhatIsHere() {
    if (!userCoords) return
    setPoiSearchLoading(true)
    setPoiResult(null)
    setPoiAudioScript('')
    try {
      // Reverse geocode to nearest named place
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${userCoords[0]}&lon=${userCoords[1]}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': es ? 'es' : 'en' } }
      )
      if (!resp.ok) { setPoiSearchLoading(false); return }
      const data = await resp.json() as { name?: string; display_name?: string; namedetails?: Record<string, string> }
      const placeName = data.namedetails?.name || data.name || data.display_name?.split(',')[0] || ''
      if (!placeName) { setPoiSearchLoading(false); return }
      setPoiQuery(placeName)
      setPoiSearchLoading(false)
      await searchPOI(placeName)
    } catch {
      setPoiSearchLoading(false)
    }
  }

  function handleStart() {
    if (!location || !selectedRouteType || !selectedDuration) return
    setCity(location.city)
    setRouteType(selectedRouteType)
    setDuration(selectedDuration)
    navigate(`/city/${encodeURIComponent(location.city.name)}`, { state: { avoidVisited } })
  }

  const visitedCount = location ? getVisitedPOINames(location.city.id).length : 0
  const routeInfo = selectedRouteType ? ROUTE_TYPE_INFO.find(r => r.id === selectedRouteType) : null

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 via-stone-900 to-stone-900 safe-top">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-white"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <p className="text-white font-black text-lg">{es ? '¿Qué visitar hoy?' : 'What to visit today?'}</p>
          <p className="text-blue-300 text-xs">{es ? 'Basado en tu ubicación actual' : 'Based on your current location'}</p>
        </div>
      </div>

      {/* Locating phase */}
      {phase === 'locating' && (
        <div className="flex flex-col items-center justify-center px-8 py-24 gap-6">
          <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-300 border-t-white" />
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-lg">{es ? 'Detectando tu ubicación...' : 'Detecting your location...'}</p>
            <p className="text-blue-300 text-sm mt-1">{es ? 'Espera un momento' : 'Please wait a moment'}</p>
          </div>
        </div>
      )}

      {/* Error phase */}
      {phase === 'error' && (
        <div className="px-5 py-8 flex flex-col items-center gap-6">
          <div className="text-5xl">📍</div>
          <div className="text-center">
            <p className="text-white font-bold text-lg mb-2">{es ? 'No pudimos localizarte' : 'Could not locate you'}</p>
            <p className="text-blue-300 text-sm">{geoError}</p>
          </div>
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <Button fullWidth onClick={() => navigate('/')}>
              {es ? '🔍 Buscar ciudad manualmente' : '🔍 Search city manually'}
            </Button>
            <button
              onClick={() => { setPhase('locating'); window.location.reload() }}
              className="w-full py-3 text-blue-300 text-sm"
            >
              {es ? 'Intentar de nuevo' : 'Try again'}
            </button>
          </div>
        </div>
      )}

      {/* Selecting phase */}
      {phase === 'selecting' && location && (
        <div className="px-4 pb-40">
          {/* Location card */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 mx-0 mb-6 border border-white/20">
            <div className="flex items-center gap-3">
              <div className="text-3xl">📍</div>
              <div className="flex-1">
                <p className="text-white font-black text-xl">{location.city.name}</p>
                <p className="text-blue-300 text-sm">{location.displayName}</p>
              </div>
              <button
                onClick={() => navigate('/')}
                className="text-blue-300 text-xs px-3 py-1.5 bg-white/10 rounded-xl"
              >
                {es ? 'Cambiar' : 'Change'}
              </button>
            </div>

            {/* Visit history toggle */}
            {visitedCount > 0 && (
              <div className="mt-3 pt-3 border-t border-white/20">
                <button
                  onClick={() => setAvoidVisited(v => !v)}
                  className="w-full flex items-center gap-3 text-left"
                >
                  <div className={`w-10 h-5 rounded-full flex items-center transition-colors px-0.5 flex-shrink-0 ${avoidVisited ? 'bg-orange-500' : 'bg-white/20'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${avoidVisited ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                  <p className="text-white/80 text-sm">
                    {avoidVisited
                      ? (es ? `Evitar los ${visitedCount} lugares ya visitados` : `Avoid ${visitedCount} already visited places`)
                      : (es ? `Incluir también lugares ya visitados` : `Also include already visited places`)}
                  </p>
                </button>
              </div>
            )}
          </div>

          {/* ---- POI Search ---- */}
          <div className="mb-6">
            <button
              onClick={() => setSearchExpanded(e => !e)}
              className="w-full flex items-center justify-between bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">🔍</span>
                <div>
                  <p className="text-white font-bold text-sm">
                    {es ? 'Buscar lugar de interés' : 'Search a point of interest'}
                  </p>
                  <p className="text-blue-300 text-xs">
                    {es ? '¿Qué es este lugar? ¿Qué hay cerca?' : 'What is this place? What\'s nearby?'}
                  </p>
                </div>
              </div>
              <svg className={`w-5 h-5 text-white/50 transition-transform ${searchExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {searchExpanded && (
              <div className="mt-3 bg-white/10 border border-white/10 rounded-2xl p-4">
                {/* Search input row */}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={poiQuery}
                    onChange={e => setPoiQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchPOI(poiQuery)}
                    placeholder={es ? 'Catedral, Plaza Mayor, Museo...' : 'Cathedral, Main Square, Museum...'}
                    className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <button
                    onClick={() => searchPOI(poiQuery)}
                    disabled={poiSearchLoading || !poiQuery.trim()}
                    className="w-11 h-11 bg-orange-500 rounded-xl flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 active:scale-95 transition-transform"
                  >
                    {poiSearchLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* What's here button */}
                {userCoords && (
                  <button
                    onClick={handleWhatIsHere}
                    disabled={poiSearchLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-white/10 border border-white/20 text-white/80 text-sm font-medium rounded-xl mb-3 active:scale-95 transition-transform disabled:opacity-40"
                  >
                    📍 {es ? '¿Qué hay donde estoy ahora?' : 'What\'s at my current location?'}
                  </button>
                )}

                {/* Search result */}
                {poiSearchLoading && !poiResult && (
                  <div className="flex items-center gap-3 py-4 justify-center">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <p className="text-white/60 text-sm">{es ? 'Buscando en múltiples fuentes...' : 'Searching multiple sources...'}</p>
                  </div>
                )}

                {poiResult && (
                  <div className="rounded-2xl overflow-hidden bg-white/5 border border-white/10">
                    {/* Image */}
                    {poiResult.imageUrl && (
                      <div className="relative" style={{ height: '36vw', minHeight: 120, maxHeight: 220 }}>
                        <img
                          src={poiResult.imageUrl}
                          alt={poiResult.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3">
                          <p className="text-white font-black text-base leading-tight">{poiResult.title}</p>
                        </div>
                      </div>
                    )}

                    <div className="p-4">
                      {!poiResult.imageUrl && (
                        <p className="text-white font-black text-base mb-2">{poiResult.title}</p>
                      )}

                      {/* Audio player */}
                      {poiAudioLoading ? (
                        <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2.5 mb-3">
                          <div className="w-4 h-4 border-2 border-orange-300/40 border-t-orange-300 rounded-full animate-spin flex-shrink-0" />
                          <p className="text-white/60 text-xs">{es ? 'Preparando guía de audio...' : 'Preparing audio guide...'}</p>
                        </div>
                      ) : poiAudioScript ? (
                        <div className="mb-3">
                          <AudioPlayer
                            text={poiAudioScript}
                            poiName={poiResult.title}
                            autoPlay={false}
                          />
                        </div>
                      ) : null}

                      {/* Description excerpt */}
                      {poiResult.extract && (
                        <p className="text-white/70 text-xs leading-relaxed line-clamp-4">
                          {poiResult.extract}
                        </p>
                      )}

                      {/* Source link */}
                      {poiResult.url && (
                        <a
                          href={poiResult.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-300 text-xs mt-2 underline underline-offset-2"
                        >
                          {es ? 'Más información →' : 'More info →'}
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {!poiSearchLoading && !poiResult && poiQuery && (
                  <p className="text-white/50 text-sm text-center py-3">
                    {es ? 'No se encontró información. Prueba con otro nombre.' : 'No info found. Try a different name.'}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Quick time presets */}
          <div className="mb-6">
            <p className="text-white/60 text-xs uppercase tracking-wider font-semibold mb-3">
              {es ? '⚡ Inicio rápido' : '⚡ Quick start'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { type: 'imprescindibles' as RouteType, dur: 120 as RouteDuration, label_es: 'Imprescindibles 2h', label_en: '2h Must-Sees', emoji: '⭐' },
                { type: 'monumental' as RouteType, dur: 180 as RouteDuration, label_es: 'Monumentos 3h', label_en: '3h Monuments', emoji: '🏛️' },
                { type: 'secretos_locales' as RouteType, dur: 120 as RouteDuration, label_es: 'Secretos 2h', label_en: '2h Secrets', emoji: '🗝️' },
                { type: 'gastronomia' as RouteType, dur: 120 as RouteDuration, label_es: 'Gastronomía 2h', label_en: '2h Food tour', emoji: '🍷' },
              ] as const).map(preset => (
                <button
                  key={`${preset.type}-${preset.dur}`}
                  onClick={() => { setRouteType(preset.type); setDuration(preset.dur) }}
                  className={`flex items-center gap-2 p-3 rounded-2xl border text-left transition-all active:scale-95 ${
                    selectedRouteType === preset.type && selectedDuration === preset.dur
                      ? 'bg-orange-500 border-orange-500 text-white'
                      : 'bg-white/10 border-white/20 text-white'
                  }`}
                >
                  <span className="text-xl flex-shrink-0">{preset.emoji}</span>
                  <span className="text-sm font-semibold">{es ? preset.label_es : preset.label_en}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Full route type selector */}
          <div className="mb-6">
            <p className="text-white/60 text-xs uppercase tracking-wider font-semibold mb-3">
              {es ? 'Tipo de ruta' : 'Route type'}
            </p>
            <RouteTypeSelector
              selected={selectedRouteType}
              onSelect={type => setRouteType(type)}
              dark
            />
          </div>

          {/* Duration selector */}
          {selectedRouteType && (
            <div className="mb-6">
              <p className="text-white/60 text-xs uppercase tracking-wider font-semibold mb-3">
                {es ? '¿Cuánto tiempo tienes?' : 'How much time do you have?'}
              </p>
              <DurationSelector selected={selectedDuration} onSelect={setDuration} dark />
            </div>
          )}

          {/* Summary */}
          {selectedRouteType && selectedDuration && routeInfo && (
            <div className="bg-white/10 rounded-2xl p-4 mb-2 border border-white/20">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{routeInfo.icon}</span>
                <div>
                  <p className="font-bold text-white">
                    {es ? routeInfo.labelEs : routeInfo.labelEn}
                  </p>
                  <p className="text-sm text-blue-300">
                    {location.city.name} · {selectedDuration === 480 ? (es ? 'Día completo' : 'Full day') : selectedDuration === 240 ? (es ? 'Medio día' : 'Half day') : `${selectedDuration / 60}h`}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fixed bottom CTA */}
      {phase === 'selecting' && selectedRouteType && selectedDuration && (
        <div className="fixed bottom-0 left-0 right-0 p-5 safe-bottom bg-gradient-to-t from-stone-900 via-stone-900/95 to-transparent pt-8">
          <Button fullWidth size="lg" onClick={handleStart}>
            🚀 {es ? `Explorar ${location?.city.name}` : `Explore ${location?.city.name}`}
          </Button>
        </div>
      )}
    </div>
  )
}
