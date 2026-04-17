import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapView } from '../components/MapView'
import { AudioPlayer } from '../components/AudioPlayer'
import { OfflineDownload } from '../components/OfflineDownload'
import { NavigationPanel } from '../components/NavigationPanel'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../stores/appStore'
import { getPOIInfoMultiSource, getPOIDescription, generateAudioScript } from '../services/wikipedia'
import { getAudioScript } from '../services/storage'
import { generateAIAudioScript, hasAIKey, getAIKey } from '../services/ai'
import { getRoute, getStepByStepInstructions, orderPOIsOptimally, calculateDistance, getDirectRoute, buildVoiceInstruction } from '../services/routing'
import { speak, stop as stopTTS } from '../services/tts'
import { ROUTE_TYPE_INFO } from '../types'
import type { RouteSegment, POI } from '../types'

type GuidePhase = 'selecting_start' | 'ready_to_start' | 'navigating' | 'at_poi' | 'post_poi' | 'complete'

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
  const [showNavigateTo, setShowNavigateTo] = useState(false)
  const [navigateToInput, setNavigateToInput] = useState('')
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const lastSpokenStepRef = useRef<number>(-1)
  const earlyWarningFiredRef = useRef<number>(-1)  // tracks which step's 150m warning was spoken

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
    if (phase === 'ready_to_start' || phase === 'navigating' || phase === 'at_poi' || phase === 'post_poi') {
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
    const dist = calculateDistance(
      userLocation[0], userLocation[1],
      nextStep.coordinates[1], nextStep.coordinates[0]
    )
    if (dist < 40 && currentStepIndex < navSteps.length - 1) {
      setCurrentStepIndex(i => i + 1)
    }
  }, [userLocation, phase, navSteps, currentStepIndex])

  // ---- Proactive 150m voice warning before upcoming turn ----
  // Fires once per step when the user enters the 150m approach zone,
  // giving extra time to prepare — mimicking Google Maps "in 150 meters" announcements.
  useEffect(() => {
    if (phase !== 'navigating' || voiceMuted || !userLocation || navSteps.length <= 1) return
    const nextStep = navSteps[currentStepIndex + 1]
    if (!nextStep?.coordinates || nextStep.direction === 'straight' || nextStep.direction === 'arrive') return
    if (earlyWarningFiredRef.current === currentStepIndex) return  // already warned this step

    const dist = calculateDistance(
      userLocation[0], userLocation[1],
      nextStep.coordinates[1], nextStep.coordinates[0]
    )
    if (dist > 50 && dist < 180) {
      earlyWarningFiredRef.current = currentStepIndex
      const distStr = language === 'es' ? `En ${Math.round(dist / 10) * 10} metros` : `In ${Math.round(dist / 10) * 10} meters`
      const turnStr = language === 'es'
        ? nextStep.direction === 'left' ? 'gira a la izquierda'
          : nextStep.direction === 'right' ? 'gira a la derecha'
          : nextStep.direction === 'slight_left' ? 'gira ligeramente a la izquierda'
          : nextStep.direction === 'slight_right' ? 'gira ligeramente a la derecha'
          : nextStep.direction === 'u_turn' ? 'da la vuelta'
          : 'continúa'
        : nextStep.direction === 'left' ? 'turn left'
          : nextStep.direction === 'right' ? 'turn right'
          : nextStep.direction === 'slight_left' ? 'turn slightly left'
          : nextStep.direction === 'slight_right' ? 'turn slightly right'
          : nextStep.direction === 'u_turn' ? 'make a U-turn'
          : 'continue'
      speak(`${distStr}, ${turnStr}.`, language === 'es' ? 'es-ES' : 'en-US', { rate: 1.05 })
    }
  }, [userLocation, phase, navSteps, currentStepIndex, voiceMuted])

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

      // 2. Fetch multi-source description (Wikipedia + Wikivoyage for richer context)
      const multiSource = await getPOIInfoMultiSource(currentPOI!.name, language)
      const desc = multiSource?.extract || await getPOIDescription(currentPOI!.name, language) || ''

      // 3. If AI key available (built-in or user), use Mistral for professional narration
      if (hasAIKey(anthropicApiKey)) {
        const insiderTip = currentPOI!.tags?.['insiderTip'] || undefined
        const reason = currentPOI!.shortDescription || ''
        const aiScript = await generateAIAudioScript(
          currentPOI!.name, currentPOI!.category, desc, reason, insiderTip, language, getAIKey(anthropicApiKey)
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

  // ---- Announce route ready when entering ready_to_start ----
  useEffect(() => {
    if (phase !== 'ready_to_start' || voiceMuted) return
    const firstPOI = pois[0]
    if (!firstPOI || !currentRoute) return
    const text = language === 'es'
      ? `Ruta preparada. ${pois.length} paradas en ${currentRoute.city.name}. Cuando quieras, pulsa el botón para iniciar el guiado hacia ${firstPOI.name}.`
      : `Route ready. ${pois.length} stops in ${currentRoute.city.name}. When you're ready, press the button to start navigation to ${firstPOI.name}.`
    const timer = setTimeout(() => speak(text, language === 'es' ? 'es-ES' : 'en-US', { rate: 1.0 }), 600)
    return () => clearTimeout(timer)
  }, [phase])

  // ---- Announce route completion when entering complete phase ----
  useEffect(() => {
    if (phase !== 'complete' || voiceMuted) return
    if (!currentRoute) return
    const text = language === 'es'
      ? `¡Enhorabuena! Has completado la ruta. Visitaste ${pois.length} lugares en ${currentRoute.city.name}. ¿Qué quieres hacer ahora?`
      : `Congratulations! You've completed the tour. You visited ${pois.length} places in ${currentRoute.city.name}. What would you like to do next?`
    const timer = setTimeout(() => speak(text, language === 'es' ? 'es-ES' : 'en-US', { rate: 1.0 }), 600)
    return () => { clearTimeout(timer); stopTTS() }
  }, [phase])

  // ---- Start navigation (from ready_to_start → navigating) ----
  function startNavigation() {
    stopTTS()
    const firstPOI = pois[0]
    if (!voiceMuted && firstPOI) {
      const firstStep = preRouteSegment?.steps?.[0]
      const prefix = language === 'es'
        ? `¡Empezamos! Dirigiéndote hacia ${firstPOI.name}. `
        : `Starting! Heading to ${firstPOI.name}. `
      const instruction = firstStep ? buildVoiceInstruction(firstStep, language) : ''
      speak(prefix + instruction, language === 'es' ? 'es-ES' : 'en-US', { rate: 1.05 })
      lastSpokenStepRef.current = 0 // skip step 0 auto-voice (already announced)
    }
    if (!preRouteSegment) {
      // User already at first POI — skip to at_poi
      triggerArrival()
    } else {
      setPhase('navigating')
    }
  }

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
    // Always go to ready_to_start so user consciously starts the guided navigation
    setPhase('ready_to_start')
  }

  function advanceToNext() {
    stopTTS()
    if (isLast) {
      setPhase('complete')
      return
    }
    const nextIdx = currentPOIIndex + 1
    const nextPOI = pois[nextIdx]
    // Speak "heading to X + first instruction" and skip step 0 in the auto-voice effect
    if (!voiceMuted && nextPOI) {
      const nextSeg = currentRoute?.segments?.[nextIdx - 1]
      const firstStep = nextSeg?.steps?.[0]
      const prefix = language === 'es'
        ? `¡Vamos! Ahora hacia ${nextPOI.name}. `
        : `Let's go! Now heading to ${nextPOI.name}. `
      const instruction = firstStep ? buildVoiceInstruction(firstStep, language) : ''
      speak(prefix + instruction, language === 'es' ? 'es-ES' : 'en-US', { rate: 1.05 })
      lastSpokenStepRef.current = 0 // skip step 0 in auto-voice effect (already spoken)
    } else {
      lastSpokenStepRef.current = -1
    }
    setCurrentStepIndex(0)
    setCurrentPOIIndex(nextIdx)
    setPhase('navigating')
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
  // PHASE: READY TO START (route built, waiting for user to press GO)
  // ======================================================
  if (phase === 'ready_to_start') {
    const firstPOI = pois[0]
    const distToFirst = userLocation && firstPOI
      ? Math.round(calculateDistance(userLocation[0], userLocation[1], firstPOI.lat, firstPOI.lon))
      : null
    const walkMins = distToFirst ? Math.round(distToFirst / 84) : null
    const totalWalkMins = currentRoute && currentRoute.totalDuration > 0
      ? Math.round(currentRoute.totalDuration / 60)
      : null

    return (
      <div className="flex flex-col h-screen bg-stone-900 safe-top">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 z-10">
          <button
            onClick={() => { stopTTS(); setPhase('selecting_start') }}
            className="w-9 h-9 bg-stone-800 rounded-xl flex items-center justify-center text-stone-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold truncate">
              {routeInfo ? (language === 'es' ? routeInfo.labelEs : routeInfo.labelEn) : ''} — {currentRoute?.city.name}
            </p>
            <p className="text-stone-400 text-xs">
              {pois.length} {language === 'es' ? 'paradas' : 'stops'}
              {totalWalkMins ? ` · ~${totalWalkMins} min` : ''}
            </p>
          </div>
          <button
            onClick={() => setShowDownload(true)}
            className="w-9 h-9 bg-stone-800 rounded-xl flex items-center justify-center text-stone-300"
            title={language === 'es' ? 'Descargar para uso offline' : 'Download for offline use'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </div>

        {/* Map overview showing full route */}
        <div className="flex-1 relative">
          <MapView
            pois={pois}
            route={currentRoute}
            userLocation={userLocation}
            currentPOIIndex={0}
            preRouteGeometry={preRouteSegment?.geometry}
            className="w-full h-full"
          />
          {/* Progress dots */}
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
            {pois.slice(0, Math.min(pois.length, 10)).map((_, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-white/60" />
            ))}
          </div>
        </div>

        {/* Bottom panel */}
        <div className="bg-stone-900 px-4 pt-3 pb-4 safe-bottom">
          {/* Route story */}
          {currentRoute?.story && (
            <div className="bg-stone-800 rounded-2xl px-4 py-3 mb-3 flex items-start gap-2">
              <span className="text-orange-400 flex-shrink-0 mt-0.5">✨</span>
              <p className="text-stone-300 text-xs leading-relaxed italic line-clamp-3">{currentRoute.story}</p>
            </div>
          )}

          {/* First POI info */}
          <div className="bg-stone-800 rounded-2xl px-4 py-3 mb-3 flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-white font-black flex-shrink-0">1</div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm truncate">
                {language === 'es' ? '1ª parada: ' : '1st stop: '}{firstPOI?.name}
              </p>
              <p className="text-stone-400 text-xs">
                {distToFirst !== null
                  ? `📍 ${formatDist(distToFirst)}${walkMins ? ` · ~${walkMins} min ${language === 'es' ? 'caminando' : 'walking'}` : ''}`
                  : (language === 'es' ? 'Calculando distancia...' : 'Calculating distance...')}
              </p>
            </div>
          </div>

          {/* Offline audio warning */}
          {currentRoute?.isOffline && (
            <div className="bg-amber-900/40 border border-amber-700/50 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-2">
              <span className="text-amber-400 flex-shrink-0">📥</span>
              <p className="text-amber-200 text-xs flex-1">
                {language === 'es'
                  ? 'Ruta offline. Si aún no has descargado el audio, hazlo antes de empezar.'
                  : 'Offline route. Download audio before starting if not done yet.'}
              </p>
              <button
                onClick={() => setShowDownload(true)}
                className="text-amber-300 text-xs font-bold flex-shrink-0 px-2 py-1 bg-amber-900/60 rounded-lg"
              >
                {language === 'es' ? 'Descargar' : 'Download'}
              </button>
            </div>
          )}

          {/* Screen-off notice */}
          <p className="text-stone-500 text-xs text-center mb-3">
            🔒 {language === 'es'
              ? 'El guiado funciona con la pantalla apagada'
              : 'Navigation works with screen off'}
          </p>

          {/* BIG START BUTTON */}
          <button
            onClick={startNavigation}
            className="w-full py-5 bg-green-500 text-white font-black text-xl rounded-2xl shadow-xl shadow-green-900/50 active:scale-95 transition-transform flex items-center justify-center gap-3"
          >
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="3" fill="white" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
              <circle cx="12" cy="12" r="8" strokeOpacity="0.4" />
            </svg>
            {language === 'es' ? '🚀 Iniciar guiado' : '🚀 Start navigation'}
          </button>
        </div>

        {/* Offline download sheet */}
        {showDownload && (
          <BottomSheet isOpen onClose={() => setShowDownload(false)} title={language === 'es' ? 'Uso sin conexión' : 'Offline use'}>
            <OfflineDownload route={currentRoute!} onComplete={() => setShowDownload(false)} />
          </BottomSheet>
        )}
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
              {/* Option 1: Start from GPS → navigate to first POI */}
              <button
                onClick={() => userLocation
                  ? reorderAndStart(userLocation[0], userLocation[1])
                  : reorderAndStart(nearestPOI.lat, nearestPOI.lon)
                }
                className="bg-orange-500 rounded-2xl p-5 text-left transition-all active:scale-95 shadow-lg shadow-orange-900/40"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="3" fill="currentColor" />
                      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
                      <circle cx="12" cy="12" r="8" strokeOpacity="0.4" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-black text-base">
                      {language === 'es' ? '🚀 Iniciar desde mi ubicación' : '🚀 Start from my location'}
                    </p>
                    <p className="text-orange-100 text-sm mt-0.5">
                      {language === 'es'
                        ? 'Te guío desde aquí hasta la 1ª parada'
                        : 'I\'ll guide you from here to the 1st stop'}
                    </p>
                    {distToNearest !== null ? (
                      <p className="text-orange-200 text-xs mt-1">
                        📍 {nearestPOI.name} · {formatDist(distToNearest)} {language === 'es' ? 'de aquí' : 'from here'}
                      </p>
                    ) : (
                      <p className="text-orange-200 text-xs mt-1 flex items-center gap-1">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-orange-200 border-t-white" />
                        {language === 'es' ? 'Buscando GPS...' : 'Getting GPS...'}
                      </p>
                    )}
                  </div>
                  <svg className="w-5 h-5 text-white/70 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

        {/* Compact bottom bar — keeps map visible on small phones */}
        <div className="bg-stone-900 px-3 pt-2 pb-3 safe-bottom">
          {/* Distance progress + controls row */}
          <div className="flex items-center gap-2 mb-2">
            {distanceToPOI !== null ? (
              <>
                <div className="flex-1 h-2 bg-stone-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-orange-500 rounded-full transition-all"
                    style={{ width: `${Math.max(4, 100 - (distanceToPOI / 600) * 100)}%` }}
                  />
                </div>
                <span className="text-stone-300 text-xs w-10 text-right flex-shrink-0">{formatDist(distanceToPOI)}</span>
              </>
            ) : (
              <div className="flex-1" />
            )}
            {/* Route list icon button */}
            <button
              onClick={() => setShowManualList(true)}
              className="w-9 h-9 bg-stone-800 rounded-xl flex items-center justify-center text-stone-300 flex-shrink-0"
              title={language === 'es' ? 'Ver paradas' : 'View stops'}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
            {/* Direct Google Maps navigation button */}
            {currentPOI ? (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${currentPOI.lat},${currentPOI.lon}&travelmode=walking`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white flex-shrink-0"
                title={language === 'es' ? 'Abrir en Google Maps' : 'Open in Google Maps'}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </a>
            ) : (
              <button
                onClick={() => setShowDownload(true)}
                className="w-9 h-9 bg-stone-800 rounded-xl flex items-center justify-center text-stone-300 flex-shrink-0"
                title={language === 'es' ? 'Más opciones' : 'More options'}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" />
                </svg>
              </button>
            )}
          </div>

          {/* Primary action: Arrival button */}
          {distanceToPOI !== null && distanceToPOI < 120 ? (
            <button
              onClick={triggerArrival}
              className="w-full py-4 bg-green-500 text-white font-black rounded-2xl text-lg active:scale-95 transition-transform shadow-lg shadow-green-900/40"
            >
              ✅ {language === 'es' ? '¡He llegado!' : "I've arrived!"}
            </button>
          ) : (
            <button
              onClick={triggerArrival}
              className="w-full py-3 bg-stone-700 text-stone-400 font-medium rounded-2xl text-sm active:scale-95 transition-transform"
            >
              📍 {language === 'es' ? 'Confirmar llegada' : 'Confirm arrival'}
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

        {/* Options sheet: map apps + offline download */}
        {showDownload && (
          <BottomSheet isOpen onClose={() => setShowDownload(false)} title={language === 'es' ? 'Opciones' : 'Options'}>
            <div className="flex flex-col gap-3">
              {/* Open in native maps */}
              {currentPOI && (
                <div>
                  <p className="text-stone-500 text-xs font-semibold uppercase tracking-wide mb-2">
                    {language === 'es' ? 'Navegar con app externa' : 'Navigate with external app'}
                  </p>
                  <div className="flex gap-2">
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${currentPOI.lat},${currentPOI.lon}&travelmode=walking`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex-1 flex flex-col items-center gap-1 bg-blue-50 text-blue-600 text-xs font-semibold py-3 rounded-xl active:scale-95"
                    >
                      <span className="text-xl">🗺️</span> Google Maps
                    </a>
                    <a
                      href={`https://www.waze.com/ul?ll=${currentPOI.lat},${currentPOI.lon}&navigate=yes`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex-1 flex flex-col items-center gap-1 bg-cyan-50 text-cyan-600 text-xs font-semibold py-3 rounded-xl active:scale-95"
                    >
                      <span className="text-xl">🔵</span> Waze
                    </a>
                    <a
                      href={`maps://maps.apple.com/?daddr=${currentPOI.lat},${currentPOI.lon}&dirflg=w`}
                      className="flex-1 flex flex-col items-center gap-1 bg-stone-100 text-stone-600 text-xs font-semibold py-3 rounded-xl active:scale-95"
                    >
                      <span className="text-xl">🍎</span> Apple Maps
                    </a>
                  </div>
                </div>
              )}
              <div>
                <p className="text-stone-500 text-xs font-semibold uppercase tracking-wide mb-2">
                  {language === 'es' ? 'Uso sin conexión' : 'Offline use'}
                </p>
                <OfflineDownload route={currentRoute} onComplete={() => setShowDownload(false)} />
              </div>
            </div>
          </BottomSheet>
        )}
      </div>
    )
  }

  // ======================================================
  // PHASE: AT_POI + POST_POI
  // ======================================================
  if (phase === 'at_poi' || phase === 'post_poi') {
    const hasImage = !!currentPOI?.imageUrl

    return (
      <div className="flex flex-col h-screen bg-stone-50" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Compact image / map header — max 28vh so audio is always visible */}
        <div
          className={`relative flex-shrink-0 transition-transform duration-300 ${justArrived ? 'scale-[1.01]' : 'scale-100'}`}
          style={{ height: hasImage ? '28vh' : '18vh', minHeight: hasImage ? 120 : 80 }}
        >
          {hasImage ? (
            <img
              src={currentPOI!.imageUrl}
              alt={currentPOI!.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <MapView pois={[currentPOI!]} currentPOIIndex={0} className="w-full h-full" />
          )}
          <div className={`absolute inset-0 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-500 ${justArrived ? 'opacity-50' : 'opacity-100'}`} />

          {/* Back to navigation */}
          <button
            onClick={() => { stopTTS(); setPhase('navigating') }}
            className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-4 w-10 h-10 bg-black/30 backdrop-blur-sm rounded-xl flex items-center justify-center text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Stop number */}
          <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-4 bg-orange-500 rounded-xl px-3 py-1.5 shadow">
            <span className="text-white font-black text-sm">{currentPOIIndex + 1}/{pois.length}</span>
          </div>

          {/* POI name overlay */}
          <div className="absolute bottom-3 left-4 right-16">
            <div className="inline-block bg-orange-500/90 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1 rounded-full capitalize mb-1">
              {currentPOI?.category}
            </div>
            <h1 className="text-white font-black text-xl leading-tight line-clamp-2">{currentPOI?.name}</h1>
          </div>
        </div>

        {/* Audio player — always visible, sticky below image */}
        <div className="flex-shrink-0 px-4 pt-3 pb-2 bg-stone-50 border-b border-stone-100 shadow-sm">
          {audioLoading ? (
            <div className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-500 flex-shrink-0" />
              <p className="text-orange-600 text-sm font-medium">
                {language === 'es' ? '🎧 Preparando guía de audio...' : '🎧 Preparing audio guide...'}
              </p>
            </div>
          ) : audioScript ? (
            <AudioPlayer
              text={audioScript}
              poiName={currentPOI?.name || ''}
              autoPlay={phase === 'at_poi'}
              onPlayEnd={() => setPhase('post_poi')}
            />
          ) : (
            <div className="bg-stone-100 rounded-2xl px-4 py-3 text-stone-400 text-sm text-center">
              {language === 'es' ? 'Audio no disponible' : 'Audio not available'}
            </div>
          )}
        </div>

        {/* Scrollable content below audio */}
        <div className="flex-1 overflow-y-auto px-4 py-3 pb-36" style={{ WebkitOverflowScrolling: 'touch' }}>
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
              {isLast ? (
                <button
                  onClick={advanceToNext}
                  className="w-full py-4 bg-orange-500 text-white font-black text-lg rounded-2xl active:scale-95 transition-transform shadow-lg shadow-orange-200 mb-2"
                >
                  🏁 {language === 'es' ? 'Finalizar ruta' : 'Finish route'}
                </button>
              ) : (
                <>
                  <button
                    onClick={advanceToNext}
                    className="w-full py-4 bg-blue-600 text-white font-black text-base rounded-2xl active:scale-95 transition-transform shadow-lg shadow-blue-200 mb-2 flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <circle cx="12" cy="12" r="3" fill="white" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" /><circle cx="12" cy="12" r="8" strokeOpacity="0.4" />
                    </svg>
                    {language === 'es'
                      ? `🚶 Ir a: ${nextPOIObj?.name || 'Siguiente parada'}`
                      : `🚶 Go to: ${nextPOIObj?.name || 'Next stop'}`}
                  </button>
                  <button
                    onClick={() => setPhase('complete')}
                    className="w-full text-center text-stone-400 text-sm py-1"
                  >
                    {language === 'es' ? 'Finalizar ruta aquí' : 'End route here'}
                  </button>
                </>
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

        {/* Share */}
        {canShare && (
          <button
            onClick={handleShare}
            className="w-full py-3 bg-orange-500 text-white font-bold rounded-2xl text-base active:scale-95 transition-transform shadow-lg shadow-orange-900/40 mb-4"
          >
            📤 {language === 'es' ? 'Compartir mi ruta' : 'Share my tour'}
          </button>
        )}

        <p className="text-stone-400 text-sm font-semibold mb-3">
          {language === 'es' ? '¿Qué quieres hacer ahora?' : 'What would you like to do next?'}
        </p>

        <div className="flex flex-col gap-3">
          {/* Option 1: New route */}
          <button
            onClick={() => { stopTTS(); navigate('/') }}
            className="w-full py-4 bg-white/10 border border-white/20 text-white font-bold rounded-2xl text-base active:scale-95 transition-transform flex items-center gap-4 px-5"
          >
            <span className="text-2xl">🗺️</span>
            <div className="text-left">
              <p className="font-black">{language === 'es' ? 'Iniciar nueva ruta' : 'Start new route'}</p>
              <p className="text-stone-400 text-xs font-normal">
                {language === 'es' ? 'Elige otra ciudad o tipo de ruta' : 'Choose another city or route type'}
              </p>
            </div>
          </button>

          {/* Option 2: Navigate to a specific place */}
          <button
            onClick={() => { stopTTS(); setShowNavigateTo(true) }}
            className="w-full py-4 bg-white/10 border border-white/20 text-white font-bold rounded-2xl text-base active:scale-95 transition-transform flex items-center gap-4 px-5"
          >
            <span className="text-2xl">🧭</span>
            <div className="text-left">
              <p className="font-black">{language === 'es' ? 'Navegar a un lugar' : 'Navigate to a place'}</p>
              <p className="text-stone-400 text-xs font-normal">
                {language === 'es' ? 'Escribe una dirección o punto de interés' : 'Enter an address or point of interest'}
              </p>
            </div>
          </button>

          {/* Option 3: End completely */}
          <button
            onClick={() => { stopTTS(); navigate('/') }}
            className="w-full py-3 text-stone-400 text-sm font-medium active:scale-95 transition-transform"
          >
            ✅ {language === 'es' ? 'Finalizar completamente' : 'End completely'}
          </button>
        </div>
      </div>

      {/* Navigate to a place sheet */}
      {showNavigateTo && (
        <BottomSheet
          isOpen
          onClose={() => setShowNavigateTo(false)}
          title={language === 'es' ? 'Navegar a un lugar' : 'Navigate to a place'}
        >
          <div className="flex flex-col gap-3">
            <p className="text-stone-500 text-sm">
              {language === 'es'
                ? 'Escribe una dirección, monumento o punto de interés para abrir la navegación en tu app de mapas.'
                : 'Enter an address, landmark or point of interest to open navigation in your maps app.'}
            </p>
            <input
              type="text"
              value={navigateToInput}
              onChange={e => setNavigateToInput(e.target.value)}
              placeholder={language === 'es' ? 'Ej: Catedral, Plaza Mayor...' : 'E.g: Cathedral, Main Square...'}
              className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              autoFocus
            />
            <div className="flex flex-col gap-2">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(navigateToInput + ' ' + currentRoute.city.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowNavigateTo(false)}
                className={`w-full py-3.5 bg-orange-500 text-white font-bold rounded-2xl text-center text-sm active:scale-95 transition-transform ${!navigateToInput.trim() ? 'opacity-40 pointer-events-none' : ''}`}
              >
                🗺️ {language === 'es' ? 'Abrir en Google Maps' : 'Open in Google Maps'}
              </a>
              <a
                href={`maps://maps.apple.com/?q=${encodeURIComponent(navigateToInput + ' ' + currentRoute.city.name)}`}
                onClick={() => setShowNavigateTo(false)}
                className={`w-full py-3 bg-stone-100 text-stone-700 font-semibold rounded-2xl text-center text-sm active:scale-95 transition-transform ${!navigateToInput.trim() ? 'opacity-40 pointer-events-none' : ''}`}
              >
                🍎 {language === 'es' ? 'Abrir en Apple Maps' : 'Open in Apple Maps'}
              </a>
            </div>
          </div>
        </BottomSheet>
      )}
    </div>
  )
}
