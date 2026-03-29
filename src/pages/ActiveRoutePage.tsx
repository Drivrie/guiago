import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapView } from '../components/MapView'
import { AudioPlayer } from '../components/AudioPlayer'
import { OfflineDownload } from '../components/OfflineDownload'
import { NavigationPanel } from '../components/NavigationPanel'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../stores/appStore'
import { getPOIDescription, generateAudioScript } from '../services/wikipedia'
import { getAudioScript } from '../services/storage'
import { generateAIAudioScript, hasAIKey, getAIKey } from '../services/ai'
import { getRoute, getStepByStepInstructions, orderPOIsOptimally, calculateDistance, getDirectRoute, buildVoiceInstruction } from '../services/routing'
import { speak, stop as stopTTS } from '../services/tts'
import { ROUTE_TYPE_INFO } from '../types'
import type { RouteSegment, POI } from '../types'

type GuidePhase = 'selecting_start' | 'navigating' | 'at_poi' | 'post_poi' | 'complete'

function fallbackSegment(from: POI, to: POI): RouteSegment {
  const direct = getDirectRoute(from, to)
  const steps = getStepByStepInstructions(direct)
  return { from, to, steps, distance: direct.distance, duration: direct.duration, geometry: [[from.lon, from.lat], [to.lon, to.lat]] }
}

export function ActiveRoutePage() {
  const navigate = useNavigate()
  const {
    language, currentRoute, pois, currentPOIIndex, setCurrentPOIIndex,
    setPOIs, setRoute, anthropicApiKey, markPOIsVisited,
    userLocation: globalUserLocation, setUserLocation: setGlobalUserLocation
  } = useAppStore()

  const [phase, setPhase] = useState<GuidePhase>('selecting_start')
  const [userLocation, setUserLocation] = useState<[number, number] | null>(globalUserLocation)
  const [audioScript, setAudioScript] = useState('')
  const [audioLoading, setAudioLoading] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [rebuilding, setRebuilding] = useState(false)
  const [showManualList, setShowManualList] = useState(false)
  const [distanceToPOI, setDistanceToPOI] = useState<number | null>(null)
  const [showDownload, setShowDownload] = useState(false)
  const [voiceMuted, setVoiceMuted] = useState(false)
  const [preRouteSegment, setPreRouteSegment] = useState<RouteSegment | null>(null)
  const [inPreRoute, setInPreRoute] = useState(false)
  const [justArrived, setJustArrived] = useState(false)
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const lastSpokenStepRef = useRef<number>(-1)

  const currentPOI = pois[currentPOIIndex]
  const nextPOIObj = pois[currentPOIIndex + 1] || null
  const isLast = currentPOIIndex === pois.length - 1
  const routeInfo = currentRoute ? ROUTE_TYPE_INFO.find(r => r.id === currentRoute.routeType) : null
  // When inPreRoute: use the segment from user GPS → first POI
  // Otherwise: use segment from prev POI → current POI (index - 1)
  const activeSegment = inPreRoute && preRouteSegment
    ? preRouteSegment
    : (currentRoute?.segments?.[currentPOIIndex - 1] ?? null)
  const navSteps = activeSegment?.steps ?? []
  const currentNavStep = navSteps[currentStepIndex] ?? null
  const nextNavStep = navSteps[currentStepIndex + 1] ?? null

  // ---- GPS watch ----
  useEffect(() => {
    if (!navigator.geolocation) return
    const watch = navigator.geolocation.watchPosition(
      pos => {
        const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        setUserLocation(loc)
        setGlobalUserLocation(loc)
      },
      () => null,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [])

  // ---- Wake Lock ----
  useEffect(() => {
    async function requestWL() {
      if (!('wakeLock' in navigator)) return
      try {
        wakeLockRef.current = await (navigator as Navigator & {
          wakeLock: { request: (type: string) => Promise<{ release: () => Promise<void> }> }
        }).wakeLock.request('screen')
      } catch { /* not supported or denied */ }
    }
    if (phase === 'navigating' || phase === 'at_poi' || phase === 'post_poi') {
      requestWL()
    } else {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
    return () => {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [phase])

  // ---- GPS arrival detection (30m auto-arrive) ----
  useEffect(() => {
    if (phase !== 'navigating' || !userLocation || !currentPOI) return
    const dist = calculateDistance(userLocation[0], userLocation[1], currentPOI.lat, currentPOI.lon)
    setDistanceToPOI(Math.round(dist))
    if (dist < 30) {
      setInPreRoute(false)
      setPreRouteSegment(null)
      triggerArrival()
    }
  }, [userLocation, phase, currentPOIIndex])

  // ---- Auto-advance navigation step when approaching next turn point ----
  useEffect(() => {
    if (phase !== 'navigating' || !userLocation || navSteps.length <= 1) return
    const nextStep = navSteps[currentStepIndex + 1]
    if (!nextStep?.coordinates) return
    // coordinates is [lon, lat] from OSRM
    const dist = calculateDistance(
      userLocation[0], userLocation[1],
      nextStep.coordinates[1], nextStep.coordinates[0]
    )
    if (dist < 40 && currentStepIndex < navSteps.length - 1) {
      setCurrentStepIndex(i => i + 1)
    }
  }, [userLocation, phase, navSteps, currentStepIndex])

  // ---- Voice navigation: speak instruction when step changes ----
  useEffect(() => {
    if (phase !== 'navigating' || voiceMuted || !currentNavStep) return
    if (currentStepIndex === lastSpokenStepRef.current) return
    lastSpokenStepRef.current = currentStepIndex
    const text = buildVoiceInstruction(currentNavStep, language)
    speak(text, language === 'es' ? 'es-ES' : 'en-US', { rate: 1.05 })
  }, [currentStepIndex, phase, voiceMuted])

  // ---- Mark current POI as visited when arriving (at_poi phase) ----
  useEffect(() => {
    if (phase !== 'at_poi' || !currentPOI || !currentRoute) return
    markPOIsVisited(currentRoute.city.id, [currentPOI.name])
  }, [phase, currentPOI?.id])

  // ---- Load audio when entering at_poi (AI-enhanced when key available) ----
  useEffect(() => {
    if (phase !== 'at_poi' || !currentPOI) return
    setAudioLoading(true)
    setAudioScript('')

    async function loadAudio() {
      // 1. Try offline cache first
      const cached = await getAudioScript(currentPOI!.id, language)
      if (cached) { setAudioScript(cached); setAudioLoading(false); return }

      // 2. Fetch Wikipedia description
      const desc = await getPOIDescription(currentPOI!.name, language)

      // 3. If AI key available (built-in or user), use Mistral for professional narration
      if (hasAIKey(anthropicApiKey)) {
        const insiderTip = currentPOI!.tags?.['insiderTip'] || undefined
        const reason = currentPOI!.shortDescription || ''
        const aiScript = await generateAIAudioScript(
          currentPOI!.name, currentPOI!.category, desc || '', reason, insiderTip, language, getAIKey(anthropicApiKey)
        )
        if (aiScript) { setAudioScript(aiScript); setAudioLoading(false); return }
      }

      // 4. Fallback to template-based script
      setAudioScript(generateAudioScript(
        { name: currentPOI!.name, category: currentPOI!.category, description: desc || undefined },
        language
      ))
      setAudioLoading(false)
    }

    loadAudio()
  }, [phase, currentPOI?.id])

  // ---- Reset step index on POI change ----
  useEffect(() => {
    setCurrentStepIndex(0)
    setDistanceToPOI(null)
  }, [currentPOIIndex])

  // ---- Haptic + visual animation on POI arrival ----
  function triggerArrival() {
    navigator.vibrate?.([100, 50, 100])
    setJustArrived(true)
    setTimeout(() => setJustArrived(false), 800)
    setPhase('at_poi')
  }

  // ---- Reorder POIs + rebuild segments from a start coordinate ----
  async function reorderAndStart(startLat: number, startLon: number) {
    if (!currentRoute) return
    setRebuilding(true)
    const orderedPOIs = orderPOIsOptimally([...pois], startLat, startLon)

    // Build pre-route: from user start position → first POI
    const firstPOI = orderedPOIs[0]
    let preRoute: RouteSegment | null = null
    const distToFirst = calculateDistance(startLat, startLon, firstPOI.lat, firstPOI.lon)
    if (distToFirst > 50) {
      try {
        const result = await getRoute([[startLat, startLon], [firstPOI.lat, firstPOI.lon]], language)
        const routeData = result ?? getDirectRoute({ lat: startLat, lon: startLon }, { lat: firstPOI.lat, lon: firstPOI.lon })
        preRoute = {
          from: { id: 'user-start', name: language === 'es' ? 'Tu ubicación' : 'Your location', lat: startLat, lon: startLon, category: 'start', routeType: currentRoute.routeType },
          to: firstPOI,
          steps: getStepByStepInstructions(routeData),
          distance: routeData.distance,
          duration: routeData.duration,
          geometry: routeData.geometry.coordinates,
        }
      } catch {
        const direct = getDirectRoute({ lat: startLat, lon: startLon }, { lat: firstPOI.lat, lon: firstPOI.lon })
        preRoute = {
          from: { id: 'user-start', name: language === 'es' ? 'Tu ubicación' : 'Your location', lat: startLat, lon: startLon, category: 'start', routeType: currentRoute.routeType },
          to: firstPOI,
          steps: getStepByStepInstructions(direct),
          distance: direct.distance, duration: direct.duration,
          geometry: [[startLon, startLat], [firstPOI.lon, firstPOI.lat]],
        }
      }
    }

    // Build segments between consecutive POIs
    const segments: RouteSegment[] = []
    for (let i = 0; i < orderedPOIs.length - 1; i++) {
      try {
        const result = await getRoute([
          [orderedPOIs[i].lat, orderedPOIs[i].lon],
          [orderedPOIs[i + 1].lat, orderedPOIs[i + 1].lon]
        ], language)
        if (result) {
          segments.push({
            from: orderedPOIs[i], to: orderedPOIs[i + 1],
            steps: getStepByStepInstructions(result),
            distance: result.distance, duration: result.duration,
            geometry: result.geometry.coordinates
          })
        } else {
          segments.push(fallbackSegment(orderedPOIs[i], orderedPOIs[i + 1]))
        }
      } catch {
        segments.push(fallbackSegment(orderedPOIs[i], orderedPOIs[i + 1]))
      }
    }
    setPOIs(orderedPOIs)
    setRoute({ ...currentRoute, pois: orderedPOIs, segments })
    setCurrentPOIIndex(0)
    setCurrentStepIndex(0)
    lastSpokenStepRef.current = -1
    setPreRouteSegment(preRoute)
    setInPreRoute(preRoute !== null)
    setRebuilding(false)
    // If user is essentially at first POI, skip directly to at_poi
    if (!preRoute) {
      setPhase('at_poi')
    } else {
      setPhase('navigating')
    }
  }

  function advanceToNext() {
    stopTTS()
    setCurrentStepIndex(0)
    lastSpokenStepRef.current = -1
    if (isLast) {
      setPhase('complete')
    } else {
      setCurrentPOIIndex(currentPOIIndex + 1)
      setPhase('navigating')
    }
  }

  function formatDist(meters: number) {
    return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`
  }

  // ---- Guard ----
  if (!currentRoute || pois.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-stone-500 mb-4">{language === 'es' ? 'No hay ruta activa' : 'No active route'}</p>
          <Button onClick={() => navigate('/')}>{language === 'es' ? 'Volver al inicio' : 'Go home'}</Button>
        </div>
      </div>
    )
  }

  // ======================================================
  // PHASE: SELECTING START
  // ======================================================
  if (phase === 'selecting_start') {
    const sortedByDistance = userLocation
      ? [...pois].sort((a, b) =>
          calculateDistance(userLocation[0], userLocation[1], a.lat, a.lon) -
          calculateDistance(userLocation[0], userLocation[1], b.lat, b.lon)
        )
      : pois
    const nearestPOI = sortedByDistance[0]
    const distToNearest = userLocation && nearestPOI
      ? Math.round(calculateDistance(userLocation[0], userLocation[1], nearestPOI.lat, nearestPOI.lon))
      : null

    return (
      <div className="min-h-screen bg-stone-900 flex flex-col safe-top">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 z-10">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 bg-stone-800 rounded-xl flex items-center justify-center text-stone-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex-1">
            <p className="text-white font-bold text-sm truncate">
              {routeInfo ? (language === 'es' ? routeInfo.labelEs : routeInfo.labelEn) : ''} — {currentRoute.city.name}
            </p>
            <p className="text-stone-400 text-xs">
              {pois.length} {language === 'es' ? 'paradas' : 'stops'}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-4 pb-8 flex flex-col justify-center gap-4 max-w-lg mx-auto w-full">

          {/* AI route story intro card */}
          {currentRoute?.story && (
            <div className="bg-gradient-to-br from-orange-500/20 to-amber-500/10 border border-orange-500/30 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">✨</span>
                <p className="text-white/90 text-sm leading-relaxed italic">{currentRoute.story}</p>
              </div>
            </div>
          )}

          <div className="text-center mb-2">
            <p className="text-white text-2xl font-black mb-1">
              {language === 'es' ? '¿Desde dónde empezamos?' : 'Where do we start?'}
            </p>
            <p className="text-stone-400 text-sm">
              {language === 'es' ? 'Elige el punto de inicio de tu ruta' : 'Choose your starting point'}
            </p>
          </div>

          {rebuilding ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-200 border-t-orange-500" />
              <p className="text-stone-400 text-sm">
                {language === 'es' ? 'Calculando ruta...' : 'Calculating route...'}
              </p>
            </div>
          ) : (
            <>
              {/* Option 1: Nearest to GPS */}
              <button
                onClick={() => userLocation
                  ? reorderAndStart(userLocation[0], userLocation[1])
                  : reorderAndStart(nearestPOI.lat, nearestPOI.lon)
                }
                className="bg-stone-800 rounded-2xl p-5 text-left transition-all border border-stone-700 hover:border-orange-500 active:scale-95"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">📍</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold">
                      {language === 'es' ? 'Punto más cercano a mí' : 'Nearest point to me'}
                    </p>
                    <p className="text-stone-400 text-sm truncate">{nearestPOI.name}</p>
                    {distToNearest !== null ? (
                      <p className="text-orange-400 text-xs mt-0.5">
                        {formatDist(distToNearest)} {language === 'es' ? 'de distancia' : 'away'}
                      </p>
                    ) : (
                      <p className="text-stone-500 text-xs mt-0.5 flex items-center gap-1">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-stone-500 border-t-transparent" />
                        {language === 'es' ? 'Buscando GPS...' : 'Getting GPS...'}
                      </p>
                    )}
                  </div>
                  <svg className="w-5 h-5 text-stone-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Option 2: City center */}
              <button
                onClick={() => reorderAndStart(currentRoute.city.lat, currentRoute.city.lon)}
                className="bg-stone-800 rounded-2xl p-5 text-left transition-all border border-stone-700 hover:border-blue-500 active:scale-95"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">🏙️</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold">
                      {language === 'es' ? 'Centro de la ciudad' : 'City center'}
                    </p>
                    <p className="text-stone-400 text-sm">
                      {language === 'es'
                        ? `Empezar desde el centro de ${currentRoute.city.name}`
                        : `Start from ${currentRoute.city.name} center`}
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-stone-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Option 3: Manual */}
              <button
                onClick={() => setShowManualList(true)}
                className="bg-stone-800 rounded-2xl p-5 text-left transition-all border border-stone-700 hover:border-purple-500 active:scale-95"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">📋</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold">
                      {language === 'es' ? 'Elegir manualmente' : 'Choose manually'}
                    </p>
                    <p className="text-stone-400 text-sm">
                      {language === 'es' ? 'Selecciona el punto de inicio de la lista' : 'Pick start point from the list'}
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-stone-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </>
          )}
        </div>

        {/* Manual POI list sheet */}
        <BottomSheet
          isOpen={showManualList}
          onClose={() => setShowManualList(false)}
          title={language === 'es' ? 'Elige el punto de inicio' : 'Choose starting point'}
          snapPoints="full"
        >
          <div className="flex flex-col gap-2">
            {sortedByDistance.map((poi, idx) => {
              const dist = userLocation
                ? Math.round(calculateDistance(userLocation[0], userLocation[1], poi.lat, poi.lon))
                : null
              return (
                <button
                  key={poi.id}
                  onClick={() => { setShowManualList(false); reorderAndStart(poi.lat, poi.lon) }}
                  className="flex items-center gap-3 p-4 bg-stone-50 rounded-2xl active:bg-stone-100 text-left"
                >
                  {poi.imageUrl ? (
                    <img src={poi.imageUrl} alt={poi.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <span className="text-lg font-black text-orange-500">{idx + 1}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-stone-800 truncate">{poi.name}</p>
                    <p className="text-stone-400 text-xs capitalize">{poi.category}</p>
                  </div>
                  {dist !== null && (
                    <p className="text-stone-400 text-xs flex-shrink-0">{formatDist(dist)}</p>
                  )}
                </button>
              )
            })}
          </div>
        </BottomSheet>
      </div>
    )
  }

  // ======================================================
  // PHASE: NAVIGATING (walking to POI)
  // ======================================================
  if (phase === 'navigating') {
    return (
      <div className="flex flex-col h-screen bg-stone-900">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-3 bg-stone-900 safe-top z-20">
          <button
            onClick={() => setPhase('selecting_start')}
            className="w-9 h-9 bg-stone-800 rounded-xl flex items-center justify-center text-stone-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">
              {inPreRoute
                ? (language === 'es' ? `Hacia la 1ª parada: ${currentPOI?.name}` : `To 1st stop: ${currentPOI?.name}`)
                : (language === 'es' ? `Hacia: ${currentPOI?.name}` : `Going to: ${currentPOI?.name}`)
              }
            </p>
            <p className="text-stone-400 text-xs">
              {language === 'es' ? 'Parada' : 'Stop'} {currentPOIIndex + 1}/{pois.length}
              {distanceToPOI !== null ? ` · ${formatDist(distanceToPOI)}` : ''}
            </p>
          </div>
          <button
            onClick={() => setShowDownload(true)}
            className="w-9 h-9 bg-stone-800 rounded-xl flex items-center justify-center text-stone-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </div>

        {/* Navigation panel - OUTSIDE map container so z-index works correctly */}
        <div className="px-3 pb-2 bg-stone-900">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <NavigationPanel
                currentStep={currentNavStep}
                nextStep={nextNavStep ?? undefined}
                remainingDistance={activeSegment?.distance}
                remainingTime={activeSegment?.duration}
                targetPOIName={currentPOI?.name}
                stepIndex={currentStepIndex}
                totalSteps={navSteps.length}
              />
            </div>
            {/* Voice mute toggle */}
            <button
              onClick={() => {
                setVoiceMuted(v => !v)
                if (!voiceMuted) stopTTS()
              }}
              className="w-11 h-11 flex-shrink-0 bg-stone-800 rounded-xl flex items-center justify-center text-lg mt-0.5"
              title={voiceMuted ? (language === 'es' ? 'Activar voz' : 'Enable voice') : (language === 'es' ? 'Silenciar voz' : 'Mute voice')}
            >
              {voiceMuted ? '🔇' : '🔊'}
            </button>
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <MapView
            pois={pois}
            route={currentRoute}
            currentPOIIndex={currentPOIIndex}
            userLocation={userLocation}
            onPOIClick={setCurrentPOIIndex}
            followUser
            preRouteGeometry={inPreRoute && preRouteSegment ? preRouteSegment.geometry : undefined}
            className="w-full h-full"
          />

          {/* Progress bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-stone-700">
            <div
              className="h-full bg-orange-500 transition-all duration-500"
              style={{ width: `${((currentPOIIndex + 1) / pois.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Bottom: arrival actions */}
        <div className="bg-stone-900 px-4 pt-3 pb-4 safe-bottom">
          {/* Distance bar */}
          {distanceToPOI !== null && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-2 bg-stone-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 rounded-full transition-all"
                  style={{ width: `${Math.max(4, 100 - (distanceToPOI / 500) * 100)}%` }}
                />
              </div>
              <span className="text-stone-300 text-xs w-12 text-right">{formatDist(distanceToPOI)}</span>
            </div>
          )}

          {/* Open in native maps */}
          {currentPOI && (
            <div className="flex gap-2 mb-3">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${currentPOI.lat},${currentPOI.lon}&travelmode=walking`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1 bg-stone-800 text-blue-300 text-xs font-medium py-2 rounded-xl active:scale-95 transition-transform"
              >
                🗺️ Google
              </a>
              <a
                href={`maps://maps.apple.com/?daddr=${currentPOI.lat},${currentPOI.lon}&dirflg=w`}
                className="flex-1 flex items-center justify-center gap-1 bg-stone-800 text-stone-300 text-xs font-medium py-2 rounded-xl active:scale-95 transition-transform"
              >
                🍎 Apple
              </a>
              <a
                href={`https://www.waze.com/ul?ll=${currentPOI.lat},${currentPOI.lon}&navigate=yes`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1 bg-stone-800 text-cyan-300 text-xs font-medium py-2 rounded-xl active:scale-95 transition-transform"
              >
                🔵 Waze
              </a>
            </div>
          )}

          {/* Route stops toggle */}
          <button
            onClick={() => setShowManualList(true)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-stone-800 rounded-xl mb-3 text-stone-300"
          >
            <span className="text-sm font-medium">
              {language === 'es' ? `📋 Paradas de la ruta (${pois.length})` : `📋 Route stops (${pois.length})`}
            </span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>

          {distanceToPOI !== null && distanceToPOI < 120 ? (
            <button
              onClick={triggerArrival}
              className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl text-lg active:scale-95 transition-transform shadow-lg shadow-green-900/40"
            >
              ✅ {language === 'es' ? '¡He llegado!' : "I've arrived!"}
            </button>
          ) : (
            <button
              onClick={triggerArrival}
              className="w-full py-3 bg-stone-700 text-stone-300 font-medium rounded-2xl text-sm active:scale-95 transition-transform"
            >
              📍 {language === 'es' ? 'Confirmar llegada manualmente' : 'Confirm arrival manually'}
            </button>
          )}
        </div>

        {/* Route stops list sheet */}
        <BottomSheet
          isOpen={showManualList}
          onClose={() => setShowManualList(false)}
          title={language === 'es' ? 'Paradas de la ruta' : 'Route stops'}
          snapPoints="full"
        >
          <div className="flex flex-col gap-1">
            {pois.map((poi, idx) => {
              const dist = userLocation
                ? Math.round(calculateDistance(userLocation[0], userLocation[1], poi.lat, poi.lon))
                : null
              const isCurrentStop = idx === currentPOIIndex
              const isPastStop = idx < currentPOIIndex
              const segToNext = currentRoute?.segments?.[idx]
              return (
                <div key={poi.id}>
                  <button
                    onClick={() => { setShowManualList(false); setCurrentPOIIndex(idx); setPhase('navigating') }}
                    className={`w-full flex items-center gap-3 p-4 rounded-2xl text-left transition-all ${
                      isCurrentStop
                        ? 'bg-orange-50 border-2 border-orange-400'
                        : isPastStop
                        ? 'bg-stone-50 opacity-60'
                        : 'bg-stone-50'
                    }`}
                  >
                    {poi.imageUrl ? (
                      <img src={poi.imageUrl} alt={poi.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        isCurrentStop ? 'bg-orange-500' : isPastStop ? 'bg-stone-300' : 'bg-stone-200'
                      }`}>
                        {isPastStop
                          ? <span className="text-white text-lg">✓</span>
                          : <span className={`text-lg font-black ${isCurrentStop ? 'text-white' : 'text-stone-500'}`}>{idx + 1}</span>
                        }
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold truncate ${isCurrentStop ? 'text-orange-700' : 'text-stone-800'}`}>{poi.name}</p>
                      <p className="text-stone-400 text-xs capitalize">{poi.category}</p>
                      {isCurrentStop && (
                        <p className="text-orange-500 text-xs font-medium mt-0.5">
                          {language === 'es' ? '← Parada actual' : '← Current stop'}
                        </p>
                      )}
                    </div>
                    {dist !== null && (
                      <p className="text-stone-400 text-xs flex-shrink-0">{formatDist(dist)}</p>
                    )}
                  </button>
                  {/* Walking distance connector to next POI */}
                  {idx < pois.length - 1 && segToNext && (
                    <div className="flex items-center gap-2 px-6 py-1">
                      <div className="w-px h-4 bg-stone-300 ml-5" />
                      <span className="text-stone-400 text-xs">
                        🚶 {formatDist(Math.round(segToNext.distance))} · ~{Math.round(segToNext.duration / 60)} min
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </BottomSheet>

        {/* Offline download */}
        {showDownload && (
          <BottomSheet isOpen onClose={() => setShowDownload(false)} title={language === 'es' ? 'Uso sin conexión' : 'Offline use'}>
            <OfflineDownload route={currentRoute} onComplete={() => setShowDownload(false)} />
          </BottomSheet>
        )}
      </div>
    )
  }

  // ======================================================
  // PHASE: AT_POI + POST_POI
  // ======================================================
  if (phase === 'at_poi' || phase === 'post_poi') {
    const imgHeight = currentPOI?.imageUrl ? '40vh' : '22vh'

    return (
      <div className="flex flex-col h-screen bg-stone-50 overflow-hidden">
        {/* Image / map header */}
        <div
          className={`relative flex-shrink-0 transition-transform duration-300 ${justArrived ? 'scale-[1.01]' : 'scale-100'}`}
          style={{ height: imgHeight }}
        >
          {currentPOI?.imageUrl ? (
            <img
              src={currentPOI.imageUrl}
              alt={currentPOI.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <MapView pois={[currentPOI!]} currentPOIIndex={0} className="w-full h-full" />
          )}
          <div className={`absolute inset-0 bg-gradient-to-t from-black/70 to-transparent transition-opacity duration-500 ${justArrived ? 'opacity-50' : 'opacity-100'}`} />

          {/* Back to navigation */}
          <button
            onClick={() => { stopTTS(); setPhase('navigating') }}
            className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 w-10 h-10 bg-black/30 backdrop-blur-sm rounded-xl flex items-center justify-center text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Stop number */}
          <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 bg-orange-500 rounded-xl px-3 py-1.5 shadow">
            <span className="text-white font-black text-sm">{currentPOIIndex + 1}/{pois.length}</span>
          </div>

          {/* POI name */}
          <div className="absolute bottom-4 left-4 right-4">
            <div className="inline-block bg-orange-500/80 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full capitalize mb-2">
              {currentPOI?.category}
            </div>
            <h1 className="text-white font-black text-2xl leading-tight">{currentPOI?.name}</h1>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-40">
          {/* Audio player */}
          {audioLoading ? (
            <div className="bg-stone-100 rounded-2xl p-4 flex items-center gap-3 mb-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-500" />
              <p className="text-stone-400 text-sm">
                {language === 'es' ? 'Preparando guía de audio...' : 'Preparing audio guide...'}
              </p>
            </div>
          ) : audioScript ? (
            <div className="mb-4">
              <AudioPlayer
                text={audioScript}
                poiName={currentPOI?.name || ''}
                autoPlay={phase === 'at_poi'}
                onPlayEnd={() => setPhase('post_poi')}
              />
            </div>
          ) : null}

          {/* Info chips */}
          {currentPOI && (currentPOI.address || currentPOI.openingHours || currentPOI.estimatedVisitMinutes) && (
            <div className="flex flex-wrap gap-2 mb-4">
              {currentPOI.address && (
                <div className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm text-sm text-stone-600">
                  <span>📍</span> {currentPOI.address}
                </div>
              )}
              {currentPOI.openingHours && (
                <div className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm text-sm text-stone-600">
                  <span>🕐</span> {currentPOI.openingHours}
                </div>
              )}
              {currentPOI.estimatedVisitMinutes && (
                <div className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm text-sm text-stone-600">
                  <span>⏱️</span> ~{currentPOI.estimatedVisitMinutes} min
                </div>
              )}
            </div>
          )}

          {/* Navigate to this POI from here */}
          {currentPOI && (
            <div className="flex gap-2 mb-3">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${currentPOI.lat},${currentPOI.lon}&travelmode=walking`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 bg-stone-100 text-blue-600 text-xs font-semibold py-2.5 rounded-xl active:scale-95 transition-transform"
              >
                🗺️ Google Maps
              </a>
              <a
                href={`https://www.waze.com/ul?ll=${currentPOI.lat},${currentPOI.lon}&navigate=yes`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 bg-stone-100 text-cyan-600 text-xs font-semibold py-2.5 rounded-xl active:scale-95 transition-transform"
              >
                🔵 Waze
              </a>
              <a
                href={`maps://maps.apple.com/?daddr=${currentPOI.lat},${currentPOI.lon}&dirflg=w`}
                className="flex-1 flex items-center justify-center gap-1.5 bg-stone-100 text-stone-600 text-xs font-semibold py-2.5 rounded-xl active:scale-95 transition-transform"
              >
                🍎 Apple
              </a>
            </div>
          )}

          {/* Detail link */}
          {currentPOI && (
            <button
              onClick={() => navigate(`/poi/${encodeURIComponent(currentPOI.id)}`)}
              className="w-full py-3 bg-stone-100 rounded-2xl text-stone-600 text-sm font-medium mb-2"
            >
              {language === 'es' ? '📖 Más información sobre este lugar' : '📖 More info about this place'}
            </button>
          )}
        </div>

        {/* Fixed bottom actions */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-sm border-t border-stone-100 safe-bottom">
          {phase === 'post_poi' ? (
            <>
              {nextPOIObj && (
                <p className="text-stone-400 text-xs text-center mb-3">
                  {language === 'es' ? `Siguiente parada: ${nextPOIObj.name}` : `Next stop: ${nextPOIObj.name}`}
                </p>
              )}
              <Button fullWidth size="lg" onClick={advanceToNext}>
                {isLast
                  ? (language === 'es' ? '🏁 Finalizar ruta' : '🏁 Finish route')
                  : (language === 'es' ? '🚶 ¡Siguiente parada!' : '🚶 Next stop!')}
              </Button>
              {!isLast && (
                <button
                  onClick={() => setPhase('complete')}
                  className="w-full text-center text-stone-400 text-sm mt-2 py-1"
                >
                  {language === 'es' ? 'Terminar la ruta aquí' : 'End route here'}
                </button>
              )}
            </>
          ) : (
            <Button
              fullWidth
              size="lg"
              variant="secondary"
              onClick={() => { stopTTS(); setPhase('post_poi') }}
            >
              {language === 'es' ? '⏭️ Saltar audio' : '⏭️ Skip audio'}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ======================================================
  // PHASE: COMPLETE
  // ======================================================
  const totalMinutes = Math.round(currentRoute.totalDuration / 60)
  const canShare = typeof navigator.share === 'function'

  async function handleShare() {
    if (!currentRoute) return
    try {
      await navigator.share({
        title: language === 'es'
          ? `Mi ruta por ${currentRoute.city.name} con GuiAgo`
          : `My ${currentRoute.city.name} tour with GuiAgo`,
        text: language === 'es'
          ? `Acabo de completar una ruta por ${currentRoute.city.name}: ${pois.length} paradas y ${formatDist(Math.round(currentRoute.totalDistance))} a pie. ¡Increíble experiencia!`
          : `Just completed a tour of ${currentRoute.city.name}: ${pois.length} stops and ${formatDist(Math.round(currentRoute.totalDistance))} on foot. Amazing experience!`,
        url: window.location.href,
      })
    } catch { /* user cancelled */ }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-900 via-stone-800 to-stone-900 flex flex-col items-center justify-center p-8 safe-top">
      <div className="text-center w-full max-w-sm mx-auto">
        <div className="text-7xl mb-4">🎉</div>
        <h1 className="text-3xl font-black text-white mb-2">
          {language === 'es' ? '¡Ruta completada!' : 'Tour completed!'}
        </h1>
        <p className="text-stone-300 mb-6">
          {language === 'es'
            ? `Has explorado ${currentRoute.city.name} como un local`
            : `You explored ${currentRoute.city.name} like a local`}
        </p>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-white/10 rounded-2xl p-3">
            <p className="text-white font-black text-2xl">{pois.length}</p>
            <p className="text-stone-400 text-xs mt-0.5">{language === 'es' ? 'Paradas' : 'Stops'}</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-3">
            <p className="text-white font-black text-2xl">{formatDist(Math.round(currentRoute.totalDistance))}</p>
            <p className="text-stone-400 text-xs mt-0.5">{language === 'es' ? 'Caminado' : 'Walked'}</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-3">
            <p className="text-white font-black text-2xl">
              {totalMinutes < 60 ? `${totalMinutes}m` : `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60 ? (totalMinutes % 60) + 'm' : ''}`}
            </p>
            <p className="text-stone-400 text-xs mt-0.5">{language === 'es' ? 'Duración' : 'Duration'}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {canShare && (
            <button
              onClick={handleShare}
              className="w-full py-4 bg-orange-500 text-white font-bold rounded-2xl text-base active:scale-95 transition-transform shadow-lg shadow-orange-900/40"
            >
              📤 {language === 'es' ? 'Compartir mi ruta' : 'Share my tour'}
            </button>
          )}
          <Button
            fullWidth
            variant={canShare ? 'secondary' : 'primary'}
            onClick={() => {
              setPhase('selecting_start')
              setCurrentPOIIndex(0)
            }}
          >
            {language === 'es' ? '🔄 Repetir ruta' : '🔄 Repeat route'}
          </Button>
          <Button fullWidth variant="ghost" onClick={() => navigate('/')}>
            {language === 'es' ? '🏠 Volver al inicio' : '🏠 Go home'}
          </Button>
        </div>
      </div>
    </div>
  )
}
