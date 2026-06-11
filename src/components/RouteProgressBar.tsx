import { useMemo } from 'react'
import { useAppStore } from '../stores/appStore'
import { calculateDistance } from '../services/routing'

interface Props {
  /** Distance (m) to the current POI, if known — used to refine the
   *  "metres remaining" figure beyond the simple stop-count. */
  distanceToPOI?: number | null
}

/**
 * Sticky top progress strip: "3 / 8 paradas · 45 min · 1.2 km restantes".
 *
 * Helps the visitor judge whether they have time to linger at the next
 * stop or whether they should pick up the pace — the kind of orientation
 * a real guide gives ambiently while walking. Always visible during a
 * guided tour without competing with the map / instructions.
 */
export function RouteProgressBar({ distanceToPOI }: Props) {
  const { language, currentRoute, pois, currentPOIIndex } = useAppStore()
  const es = language === 'es'

  const stats = useMemo(() => {
    if (!currentRoute || pois.length === 0) return null
    // Remaining walking distance: distance to current POI + distance between
    // remaining consecutive pairs.
    let walkM = distanceToPOI ?? 0
    for (let i = Math.max(0, currentPOIIndex); i < pois.length - 1; i++) {
      walkM += calculateDistance(pois[i].lat, pois[i].lon, pois[i + 1].lat, pois[i + 1].lon)
    }
    const remainingStops = Math.max(0, pois.length - currentPOIIndex)
    const visitMin = pois.slice(currentPOIIndex).reduce(
      (sum, p) => sum + Math.min(25, Math.max(8, p.estimatedVisitMinutes ?? 15)), 0
    )
    const walkMin = Math.round(walkM / 84)
    return {
      pct: Math.min(100, Math.round((currentPOIIndex / Math.max(1, pois.length)) * 100)),
      done: currentPOIIndex,
      total: pois.length,
      remainingStops,
      remainingMin: visitMin + walkMin,
      remainingKm: walkM / 1000,
    }
  }, [currentRoute, pois, currentPOIIndex, distanceToPOI])

  if (!stats || stats.total === 0) return null

  return (
    <div className="bg-stone-900/95 backdrop-blur-sm text-white px-4 py-2 shadow-sm">
      <div className="flex items-center gap-3 text-[12px]">
        <span className="font-mono font-black tracking-tight">
          {Math.min(stats.done + 1, stats.total)}<span className="text-stone-400">/{stats.total}</span>
        </span>
        <div className="flex-1 h-1.5 bg-stone-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-orange-500 rounded-full transition-all duration-500"
            style={{ width: `${stats.pct}%` }}
          />
        </div>
        <span className="text-stone-300 whitespace-nowrap">
          {stats.remainingKm.toFixed(1)} km · {stats.remainingMin} min
        </span>
      </div>
      <p className="text-[10px] text-stone-400 mt-0.5 text-center uppercase tracking-wider">
        {es ? 'queda por delante' : 'remaining'}
      </p>
    </div>
  )
}
