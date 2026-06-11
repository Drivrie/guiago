import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { Button } from '../components/ui/Button'
import { MapView } from '../components/MapView'
import { calculateDistance, orderPOIsOptimally, pruneOutlierPOIs } from '../services/routing'
import { prefetchNarration } from '../services/narration'
import type { POI } from '../types'

/**
 * Route preview screen — shown between RouteSetup and ActiveRoute.
 *
 * Lets the visitor:
 *  - SEE every stop with a real photo, the AI's reason and the insider tip
 *    so they know what they're committing to.
 *  - REMOVE any stop they don't fancy (the order is auto-recomputed).
 *  - REORDER by quick up/down arrows in case they want to bias the start /
 *    end of the walk.
 *  - START the tour with confidence — narrations start prefetching the
 *    moment this screen opens, so the first stop plays instantly.
 *
 * No backend changes: the store already holds `pois` and `currentRoute`;
 * we simply rewrite `pois` and the route's poi list before navigating to
 * /route/active.
 */
export function RoutePreviewPage() {
  const navigate = useNavigate()
  const { language, currentRoute, pois, setPOIs, setRoute, setCurrentPOIIndex, anthropicApiKey } = useAppStore()
  const es = language === 'es'

  // Background prefetch so the first 2-3 narrations are ready before the
  // user even hits "Empezar". By the time they're walking the cache is hot.
  useEffect(() => {
    if (pois.length === 0) return
    for (let i = 0; i < Math.min(3, pois.length); i++) {
      prefetchNarration(pois[i], language, anthropicApiKey)
    }
  }, [pois.length, language, anthropicApiKey])

  // If the user lands here without a generated route, send them back.
  useEffect(() => {
    if (!currentRoute || pois.length === 0) navigate('/', { replace: true })
  }, [currentRoute, pois.length, navigate])

  // ----- Stats: total walking distance + estimated total time -----
  const stats = useMemo(() => {
    if (pois.length === 0) return { distanceKm: 0, totalMin: 0, visitMin: 0, walkMin: 0 }
    let walkM = 0
    for (let i = 0; i < pois.length - 1; i++) {
      walkM += calculateDistance(pois[i].lat, pois[i].lon, pois[i + 1].lat, pois[i + 1].lon)
    }
    const visitMin = pois.reduce((sum, p) => sum + Math.min(25, Math.max(8, p.estimatedVisitMinutes ?? 15)), 0)
    const walkMin = Math.round(walkM / 84)
    return { distanceKm: walkM / 1000, totalMin: visitMin + walkMin, visitMin, walkMin }
  }, [pois])

  // ----- Mutations -----
  function rebuildOrder(next: POI[]): POI[] {
    if (!currentRoute) return next
    const ordered = orderPOIsOptimally(next, currentRoute.city.lat, currentRoute.city.lon)
    return pruneOutlierPOIs(ordered, 1500)
  }

  function commit(next: POI[]) {
    const reordered = rebuildOrder(next)
    setPOIs(reordered)
    if (currentRoute) {
      // Re-sync segments: clear so ActiveRoutePage rebuilds them at start.
      setRoute({ ...currentRoute, pois: reordered, segments: [] })
    }
  }

  function removePOI(idx: number) {
    if (pois.length <= 3) return // never go below 3 stops
    commit(pois.filter((_, i) => i !== idx))
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    const next = [...pois]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    // Skip rebuildOrder here: the visitor explicitly chose this order.
    setPOIs(next)
    if (currentRoute) setRoute({ ...currentRoute, pois: next, segments: [] })
  }

  function moveDown(idx: number) {
    if (idx === pois.length - 1) return
    const next = [...pois]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setPOIs(next)
    if (currentRoute) setRoute({ ...currentRoute, pois: next, segments: [] })
  }

  function startTour() {
    setCurrentPOIIndex(0)
    navigate('/route/active')
  }

  if (!currentRoute) return null

  return (
    <div className="min-h-screen bg-stone-50 safe-top pb-32">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur-sm border-b border-stone-100 px-5 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="w-10 h-10 -ml-2 flex items-center justify-center text-stone-600 active:scale-95">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-stone-900 font-black text-base truncate">{currentRoute.city.name}</h1>
        <div className="w-10" />
      </div>

      {/* Route summary card */}
      <div className="px-5 pt-4">
        {currentRoute.story && (
          <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-4 border border-orange-100 mb-4">
            <p className="text-stone-700 text-sm leading-relaxed italic">{currentRoute.story}</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-white rounded-xl p-3 text-center shadow-sm border border-stone-100">
            <p className="text-2xl font-black text-stone-800">{pois.length}</p>
            <p className="text-[11px] text-stone-400 uppercase tracking-wider">{es ? 'Paradas' : 'Stops'}</p>
          </div>
          <div className="bg-white rounded-xl p-3 text-center shadow-sm border border-stone-100">
            <p className="text-2xl font-black text-stone-800">{stats.distanceKm.toFixed(1)}<span className="text-sm">km</span></p>
            <p className="text-[11px] text-stone-400 uppercase tracking-wider">{es ? 'A pie' : 'Walking'}</p>
          </div>
          <div className="bg-white rounded-xl p-3 text-center shadow-sm border border-stone-100">
            <p className="text-2xl font-black text-stone-800">{Math.round(stats.totalMin / 60 * 10) / 10}<span className="text-sm">h</span></p>
            <p className="text-[11px] text-stone-400 uppercase tracking-wider">{es ? 'Total' : 'Total'}</p>
          </div>
        </div>

        {/* Mini map */}
        <div className="rounded-2xl overflow-hidden mb-4 border border-stone-100" style={{ height: 200 }}>
          <MapView pois={pois} userLocation={null} />
        </div>
      </div>

      {/* Stops list */}
      <div className="px-5 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-stone-500 uppercase tracking-wider">
            {es ? 'Tus paradas' : 'Your stops'}
          </h2>
          <p className="text-[11px] text-stone-400">
            {es ? 'Toca ✕ para quitar · ↑↓ para reordenar' : 'Tap ✕ to remove · ↑↓ to reorder'}
          </p>
        </div>

        {pois.map((poi, idx) => (
          <article key={poi.id} className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
            <div className="flex">
              {/* Photo */}
              <div className="w-24 h-24 flex-shrink-0 bg-stone-100 relative">
                {poi.imageUrl ? (
                  <img src={poi.imageUrl} alt={poi.name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl">📍</div>
                )}
                <span className="absolute top-1 left-1 w-6 h-6 bg-orange-500 text-white text-xs font-black rounded-full flex items-center justify-center shadow">{idx + 1}</span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-stone-800 text-sm line-clamp-2 leading-tight">{poi.name}</p>
                  <button
                    onClick={() => removePOI(idx)}
                    disabled={pois.length <= 3}
                    className="text-stone-300 hover:text-red-500 disabled:opacity-30 text-lg leading-none flex-shrink-0"
                    aria-label={es ? 'Quitar parada' : 'Remove stop'}
                  >×</button>
                </div>
                <p className="text-[11px] text-stone-400 mt-0.5 uppercase tracking-wide">{poi.category}</p>
                {poi.shortDescription && (
                  <p className="text-xs text-stone-600 mt-1 line-clamp-2 leading-snug">{poi.shortDescription}</p>
                )}
                {poi.tags?.['insiderTip'] && (
                  <p className="text-[11px] text-amber-700 mt-1 line-clamp-1">💡 {poi.tags['insiderTip']}</p>
                )}

                {/* Reorder buttons */}
                <div className="flex items-center gap-1 mt-2">
                  <button
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    className="w-7 h-7 rounded-lg bg-stone-100 text-stone-600 text-xs disabled:opacity-30 active:scale-90"
                    aria-label="Move up"
                  >↑</button>
                  <button
                    onClick={() => moveDown(idx)}
                    disabled={idx === pois.length - 1}
                    className="w-7 h-7 rounded-lg bg-stone-100 text-stone-600 text-xs disabled:opacity-30 active:scale-90"
                    aria-label="Move down"
                  >↓</button>
                  <span className="ml-auto text-[11px] text-stone-400">
                    ≈ {Math.min(25, Math.max(8, poi.estimatedVisitMinutes ?? 15))} min
                  </span>
                </div>
              </div>
            </div>
          </article>
        ))}

        {pois.length <= 3 && (
          <p className="text-center text-xs text-stone-400 mt-2">
            {es ? 'Mínimo 3 paradas para que la ruta tenga sentido.' : 'A minimum of 3 stops keeps the route useful.'}
          </p>
        )}

        <p className="text-center text-[11px] text-stone-400 mt-1 px-4">
          {es
            ? 'Al iniciar el guiado a pie, el orden se ajustará automáticamente desde tu punto de salida real. Las paradas que quites no volverán.'
            : 'When you start walking guidance, the order auto-adjusts from your actual start point. Removed stops stay removed.'}
        </p>
      </div>

      {/* Start button (fixed bottom) */}
      <div className="fixed bottom-0 left-0 right-0 p-5 bg-white/95 backdrop-blur-sm border-t border-stone-100 safe-bottom">
        <Button fullWidth size="lg" onClick={startTour}>
          {es ? '▶ Empezar la ruta' : '▶ Start the tour'}
        </Button>
      </div>
    </div>
  )
}
