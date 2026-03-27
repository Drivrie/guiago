import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapView } from '../components/MapView'
import { POICard } from '../components/POICard'
import { AudioPlayer } from '../components/AudioPlayer'
import { OfflineDownload } from '../components/OfflineDownload'
import { NavigationPanel } from '../components/NavigationPanel'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../stores/appStore'
import { getPOIDescription, generateAudioScript } from '../services/wikipedia'
import { getAudioScript } from '../services/storage'
import { ROUTE_TYPE_INFO } from '../types'

export function ActiveRoutePage() {
  const navigate = useNavigate()
  const {
    language, currentRoute, pois, currentPOIIndex, setCurrentPOIIndex,
    nextPOI, prevPOI, isNavigating, startNavigation, stopNavigation
  } = useAppStore()

  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [audioScript, setAudioScript] = useState<string>('')
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [showPOIList, setShowPOIList] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const [panelExpanded, setPanelExpanded] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [showNavPanel, setShowNavPanel] = useState(true)

  const currentPOI = pois[currentPOIIndex]
  const routeInfo = currentRoute ? ROUTE_TYPE_INFO.find(r => r.id === currentRoute.routeType) : null

  const currentSegment = currentRoute?.segments?.[currentPOIIndex] ?? null
  const navSteps = currentSegment?.steps ?? []
  const currentNavStep = navSteps[currentStepIndex] ?? null
  const nextNavStep = navSteps[currentStepIndex + 1] ?? null

  // Get user GPS location
  useEffect(() => {
    if (!navigator.geolocation) return
    const watch = navigator.geolocation.watchPosition(
      pos => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
      () => null,
      { enableHighAccuracy: true, timeout: 10000 }
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [])

  // Load audio script for current POI
  useEffect(() => {
    if (!currentPOI) return
    setLoadingAudio(true)
    setAudioScript('')

    // Try offline cache first
    getAudioScript(currentPOI.id, language).then(cached => {
      if (cached) {
        setAudioScript(cached)
        setLoadingAudio(false)
        return
      }
      // Fetch from Wikipedia
      getPOIDescription(currentPOI.name, language).then(desc => {
        const script = generateAudioScript(
          { name: currentPOI.name, category: currentPOI.category, description: desc || undefined },
          language
        )
        setAudioScript(script)
        setLoadingAudio(false)
      })
    })
  }, [currentPOI, language])

  // Reset navigation step when POI changes
  useEffect(() => {
    setCurrentStepIndex(0)
  }, [currentPOIIndex])

  // Start navigation on mount
  useEffect(() => {
    if (!isNavigating) startNavigation()
    return () => {} // don't stop on unmount to preserve state
  }, [])

  if (!currentRoute || pois.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-stone-500 mb-4">
            {language === 'es' ? 'No hay ruta activa' : 'No active route'}
          </p>
          <Button onClick={() => navigate('/')}>
            {language === 'es' ? 'Volver al inicio' : 'Go home'}
          </Button>
        </div>
      </div>
    )
  }

  const isFirst = currentPOIIndex === 0
  const isLast = currentPOIIndex === pois.length - 1

  return (
    <div className="flex flex-col h-screen bg-stone-900">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-stone-900 safe-top z-20">
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
            {currentPOIIndex + 1}/{pois.length} {language === 'es' ? 'paradas' : 'stops'}
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

        <button
          onClick={() => setShowPOIList(true)}
          className="w-9 h-9 bg-stone-800 rounded-xl flex items-center justify-center text-stone-300"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapView
          pois={pois}
          route={currentRoute}
          currentPOIIndex={currentPOIIndex}
          userLocation={userLocation}
          onPOIClick={setCurrentPOIIndex}
          className="w-full h-full"
        />

        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-stone-700">
          <div
            className="h-full bg-orange-500 transition-all duration-500"
            style={{ width: `${((currentPOIIndex + 1) / pois.length) * 100}%` }}
          />
        </div>

        {/* Navigation overlay - shows step-by-step walking directions */}
        {showNavPanel && currentNavStep && (
          <div className="absolute top-2 left-2 right-2 z-10">
            <NavigationPanel
              currentStep={currentNavStep}
              nextStep={nextNavStep ?? undefined}
              remainingDistance={currentSegment?.distance}
              remainingTime={currentSegment?.duration}
            />
            {/* Step buttons */}
            <div className="flex gap-2 mt-1">
              {currentStepIndex > 0 && (
                <button
                  onClick={() => setCurrentStepIndex(i => i - 1)}
                  className="flex-1 bg-stone-800/90 text-white text-xs py-2 rounded-xl"
                >
                  ← Indicación anterior
                </button>
              )}
              {currentStepIndex < navSteps.length - 1 && (
                <button
                  onClick={() => setCurrentStepIndex(i => i + 1)}
                  className="flex-1 bg-stone-800/90 text-white text-xs py-2 rounded-xl"
                >
                  Siguiente indicación →
                </button>
              )}
            </div>
          </div>
        )}
        {/* Toggle nav panel button */}
        <button
          onClick={() => setShowNavPanel(v => !v)}
          className="absolute top-2 right-2 z-20 w-9 h-9 bg-white rounded-xl shadow flex items-center justify-center text-stone-600"
        >
          {showNavPanel ? '🗺️' : '↑'}
        </button>
      </div>

      {/* Bottom panel */}
      <div className={`bg-white rounded-t-3xl shadow-2xl transition-all duration-300 ${panelExpanded ? 'max-h-[70vh]' : 'max-h-[40vh]'} flex flex-col safe-bottom`}>
        {/* Handle */}
        <button
          className="flex flex-col items-center pt-3 pb-1 flex-shrink-0"
          onClick={() => setPanelExpanded(!panelExpanded)}
        >
          <div className="w-10 h-1 bg-stone-200 rounded-full" />
        </button>

        {/* Current POI */}
        {currentPOI && (
          <div className="px-4 pb-2 flex-shrink-0">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                <span className="text-2xl font-black text-orange-500">{currentPOIIndex + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-black text-stone-900 text-xl leading-tight">{currentPOI.name}</h2>
                <p className="text-stone-400 text-sm capitalize">{currentPOI.category}</p>
              </div>
              <button
                onClick={() => navigate(`/poi/${encodeURIComponent(currentPOI.id)}`)}
                className="flex-shrink-0 w-9 h-9 bg-stone-100 rounded-xl flex items-center justify-center"
              >
                <svg className="w-4 h-4 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* Audio player */}
          {audioScript && !loadingAudio && (
            <div className="mb-4">
              <AudioPlayer
                text={audioScript}
                poiName={currentPOI?.name || ''}
              />
            </div>
          )}
          {loadingAudio && (
            <div className="bg-stone-50 rounded-2xl p-4 flex items-center gap-3 mb-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-500" />
              <p className="text-stone-400 text-sm">
                {language === 'es' ? 'Preparando la guía de audio...' : 'Preparing audio guide...'}
              </p>
            </div>
          )}
        </div>

        {/* Navigation controls */}
        <div className="flex items-center gap-3 px-4 pb-safe-bottom pb-4 flex-shrink-0 border-t border-stone-100 pt-3">
          <button
            onClick={prevPOI}
            disabled={isFirst}
            className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center disabled:opacity-30 active:scale-95 transition-transform"
          >
            <svg className="w-6 h-6 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex-1 text-center">
            <p className="text-xs text-stone-400">
              {isLast
                ? (language === 'es' ? '¡Última parada!' : 'Last stop!')
                : (language === 'es' ? `Siguiente: ${pois[currentPOIIndex + 1]?.name}` : `Next: ${pois[currentPOIIndex + 1]?.name}`)}
            </p>
          </div>

          <button
            onClick={isLast ? () => navigate('/') : nextPOI}
            className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center shadow-md shadow-orange-200 active:scale-95 transition-transform"
          >
            {isLast ? (
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* POI List Sheet */}
      <BottomSheet
        isOpen={showPOIList}
        onClose={() => setShowPOIList(false)}
        title={language === 'es' ? 'Paradas de la ruta' : 'Route stops'}
        snapPoints="full"
      >
        <div className="flex flex-col gap-2">
          {pois.map((poi, idx) => (
            <POICard
              key={poi.id}
              poi={poi}
              index={idx}
              isActive={idx === currentPOIIndex}
              isVisited={idx < currentPOIIndex}
              onClick={() => { setCurrentPOIIndex(idx); setShowPOIList(false) }}
            />
          ))}
        </div>
      </BottomSheet>

      {/* Offline download sheet */}
      {showDownload && currentRoute && (
        <BottomSheet
          isOpen={showDownload}
          onClose={() => setShowDownload(false)}
          title={language === 'es' ? 'Uso sin conexión' : 'Offline use'}
        >
          <OfflineDownload
            route={currentRoute}
            onComplete={() => setShowDownload(false)}
          />
        </BottomSheet>
      )}
    </div>
  )
}
