import type { NavigationStep } from '../types'
import { useAppStore } from '../stores/appStore'

interface NavigationPanelProps {
  currentStep?: NavigationStep | null
  nextStep?: NavigationStep | null
  remainingDistance?: number
  remainingTime?: number
  targetPOIName?: string
  stepIndex?: number
  totalSteps?: number
  /** Live GPS distance to the next maneuver point (updates every GPS tick) */
  distanceToNextTurn?: number
}

function formatMeters(m: number): string {
  if (m < 100) return `${Math.round(m)} m`
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1)} km`
}

function formatMinutes(secs: number): string {
  const mins = Math.round(secs / 60)
  if (mins < 1) return '< 1 min'
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}min`
}

// Returns bg colour class based on closeness to next turn
function turnDistanceColour(dist?: number): string {
  if (dist === undefined) return 'text-blue-200'
  if (dist < 50) return 'text-green-300'
  if (dist < 100) return 'text-yellow-300'
  return 'text-blue-200'
}

// SVG direction arrow — matches Google Maps style with smooth rotation
function DirectionArrow({ direction }: { direction?: string }) {
  const d = direction || 'straight'

  const arrowStyle: React.CSSProperties = {
    width: 44, height: 44, flexShrink: 0,
    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))'
  }

  if (d === 'arrive') {
    return (
      <div style={{ ...arrowStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 44, height: 44 }}>
          <circle cx="22" cy="22" r="20" fill="white" fillOpacity="0.2" />
          <path d="M22 10 C22 10 14 18 14 24 C14 30 17.5 34 22 34 C26.5 34 30 30 30 24 C30 18 22 10 22 10Z" fill="white"/>
          <circle cx="22" cy="24" r="4" fill="#1a73e8"/>
        </svg>
      </div>
    )
  }

  const rotations: Record<string, number> = {
    straight: 0, left: -90, right: 90,
    slight_left: -45, slight_right: 45, u_turn: 180
  }
  const rotation = rotations[d] ?? 0

  return (
    <div style={{ ...arrowStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg
        viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ width: 44, height: 44, transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s' }}
      >
        <path d="M22 34 L22 14" stroke="white" strokeWidth="4" strokeLinecap="round"/>
        <path d="M14 22 L22 14 L30 22" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  )
}

// Mini direction arrow for next-step preview
function MiniArrow({ direction }: { direction?: string }) {
  const d = direction || 'straight'
  const rotations: Record<string, number> = {
    straight: 0, left: -90, right: 90,
    slight_left: -45, slight_right: 45, u_turn: 180, arrive: 0
  }
  return (
    <svg
      viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{
        width: 20, height: 20,
        transform: `rotate(${rotations[d] ?? 0}deg)`,
        transition: 'transform 0.3s',
        flexShrink: 0,
      }}
    >
      <path d="M10 16 L10 6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.7"/>
      <path d="M6 10 L10 6 L14 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.7"/>
    </svg>
  )
}

export function NavigationPanel({
  currentStep,
  nextStep,
  remainingDistance,
  remainingTime,
  targetPOIName,
  stepIndex,
  totalSteps,
  distanceToNextTurn,
}: NavigationPanelProps) {
  const { language } = useAppStore()

  // ── No steps yet — "head towards" fallback card ─────────────────────────
  if (!currentStep) {
    if (!targetPOIName) return null
    return (
      <div className="bg-[#1a73e8] rounded-2xl overflow-hidden shadow-xl">
        <div className="flex items-center gap-3 px-4 py-3">
          <DirectionArrow direction="straight" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base leading-tight">
              {language === 'es' ? 'Dirígete hacia' : 'Head towards'}
            </p>
            <p className="text-blue-200 text-sm truncate">{targetPOIName}</p>
          </div>
          {remainingDistance !== undefined && (
            <div className="text-right flex-shrink-0 pl-2 border-l border-white/20">
              <p className="text-white font-black text-lg leading-none">{formatMeters(remainingDistance)}</p>
              {remainingTime !== undefined && (
                <p className="text-blue-200 text-xs mt-0.5">{formatMinutes(remainingTime)}</p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const isArriving = currentStep.direction === 'arrive'

  // Live distance shown in the main instruction area:
  // - If GPS distance to next turn is available → use it (live, updates every second)
  // - Otherwise fall back to static OSRM step distance
  const primaryDist = distanceToNextTurn ?? (currentStep.distance > 0 ? currentStep.distance : undefined)
  const distColour = turnDistanceColour(distanceToNextTurn)

  // Alert threshold: pulse animation when within 80m of next turn
  const nearTurn = distanceToNextTurn !== undefined && distanceToNextTurn < 80

  return (
    <div className={`rounded-2xl overflow-hidden shadow-xl ${isArriving ? 'bg-[#0d7a3e]' : 'bg-[#1a1a2e]'}`}>

      {/* ── Main instruction row ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={nearTurn ? 'animate-pulse' : ''}>
          <DirectionArrow direction={currentStep.direction} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-base leading-tight line-clamp-2">
            {currentStep.instruction}
          </p>
          {/* Live distance countdown to next maneuver */}
          {primaryDist !== undefined && !isArriving && (
            <p className={`text-sm font-bold mt-0.5 tabular-nums transition-colors duration-300 ${distColour}`}>
              {language === 'es' ? 'en ' : 'in '}{formatMeters(primaryDist)}
            </p>
          )}
        </div>

        {/* ETA + remaining distance to POI */}
        {remainingDistance !== undefined && !isArriving && (
          <div className="text-right flex-shrink-0 pl-2 border-l border-white/20 min-w-[52px]">
            <p className="text-white font-black text-base leading-none tabular-nums">
              {formatMeters(remainingDistance)}
            </p>
            {remainingTime !== undefined && (
              <p className="text-blue-200 text-xs mt-0.5 tabular-nums">{formatMinutes(remainingTime)}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Step progress bar ───────────────────────────────────────────── */}
      {stepIndex !== undefined && totalSteps !== undefined && totalSteps > 1 && (
        <div className="px-4 pb-1">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white/70 rounded-full transition-all duration-300"
                style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
              />
            </div>
            <span className="text-white/60 text-xs flex-shrink-0 tabular-nums">
              {stepIndex + 1}/{totalSteps}
            </span>
          </div>
        </div>
      )}

      {/* ── Next-step preview bar ───────────────────────────────────────── */}
      {nextStep && !isArriving && (
        <div className="flex items-center gap-2 px-4 py-2 bg-black/25">
          <span className="text-white/50 text-xs flex-shrink-0">
            {language === 'es' ? 'Luego:' : 'Then:'}
          </span>
          <MiniArrow direction={nextStep.direction} />
          <p className="text-white/80 text-xs truncate flex-1">{nextStep.instruction}</p>
          {nextStep.distance > 0 && (
            <span className="text-white/50 text-xs flex-shrink-0 tabular-nums">
              {formatMeters(nextStep.distance)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
