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

// Urgency level based on distance to next turn
function urgencyLevel(dist?: number): 'normal' | 'soon' | 'now' {
  if (dist === undefined) return 'normal'
  if (dist < 50) return 'now'
  if (dist < 150) return 'soon'
  return 'normal'
}

// Google Maps-style large direction arrow
function DirectionArrow({ direction, size = 'lg' }: { direction?: string; size?: 'lg' | 'sm' }) {
  const d = direction || 'straight'
  const dim = size === 'lg' ? 52 : 22

  if (d === 'arrive') {
    return (
      <svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ width: dim, height: dim, flexShrink: 0 }}>
        <circle cx="26" cy="26" r="24" fill="white" fillOpacity="0.15" />
        <path d="M26 10 C26 10 16 20 16 28 C16 34 20.5 40 26 40 C31.5 40 36 34 36 28 C36 20 26 10 26 10Z" fill="white" />
        <circle cx="26" cy="28" r="5" fill="#1a73e8" />
      </svg>
    )
  }

  const rotations: Record<string, number> = {
    straight: 0, left: -90, right: 90,
    slight_left: -45, slight_right: 45, u_turn: 180,
  }
  const rotation = rotations[d] ?? 0

  return (
    <svg
      viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{
        width: dim, height: dim, flexShrink: 0,
        transform: `rotate(${rotation}deg)`,
        transition: 'transform 0.4s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {/* Shaft */}
      <line x1="26" y1="42" x2="26" y2="16" stroke="white" strokeWidth="6" strokeLinecap="round" />
      {/* Arrowhead */}
      <path d="M14 28 L26 14 L38 28" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

// Small arrow for "Then" preview row
function MiniArrow({ direction }: { direction?: string }) {
  const d = direction || 'straight'
  const rotations: Record<string, number> = {
    straight: 0, left: -90, right: 90,
    slight_left: -45, slight_right: 45, u_turn: 180, arrive: 0,
  }
  return (
    <svg
      viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{
        width: 18, height: 18, flexShrink: 0,
        transform: `rotate(${rotations[d] ?? 0}deg)`,
        transition: 'transform 0.3s',
      }}
    >
      <line x1="10" y1="16" x2="10" y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5 10 L10 5 L15 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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

  // ── No steps yet — "Head towards" fallback ────────────────────────────
  if (!currentStep) {
    if (!targetPOIName) return null
    return (
      <div className="bg-[#1a73e8] rounded-2xl overflow-hidden shadow-xl">
        <div className="flex items-center gap-0">
          {/* Arrow column */}
          <div className="w-[72px] h-[72px] flex items-center justify-center bg-[#1557b0] flex-shrink-0">
            <DirectionArrow direction="straight" />
          </div>
          {/* Instruction */}
          <div className="flex-1 min-w-0 px-3 py-2">
            <p className="text-white font-black text-base leading-tight">
              {language === 'es' ? 'Dirígete hacia' : 'Head towards'}
            </p>
            <p className="text-blue-200 text-sm truncate">{targetPOIName}</p>
          </div>
          {/* ETA chip */}
          {remainingDistance !== undefined && (
            <div className="pr-3 pl-2 flex-shrink-0 text-right border-l border-white/20 py-2 ml-1">
              <p className="text-white font-black text-lg tabular-nums leading-none">
                {formatMeters(remainingDistance)}
              </p>
              {remainingTime !== undefined && (
                <p className="text-blue-200 text-xs mt-0.5 tabular-nums">{formatMinutes(remainingTime)}</p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const isArriving = currentStep.direction === 'arrive'
  const urgency = urgencyLevel(distanceToNextTurn)
  const nearTurn = urgency !== 'normal'

  // Background and arrow-column color by urgency (Google Maps green → yellow → blue)
  const bgMain = isArriving
    ? '#0d7a3e'
    : urgency === 'now' ? '#1a6b28' : urgency === 'soon' ? '#1a3d6e' : '#1a1a2e'
  const bgArrow = isArriving
    ? '#0a5c2e'
    : urgency === 'now' ? '#145420' : urgency === 'soon' ? '#12305a' : '#111128'
  const distColor = urgency === 'now' ? '#4ade80' : urgency === 'soon' ? '#fbbf24' : '#93c5fd'

  // Live distance to next maneuver (falls back to step distance)
  const primaryDist = distanceToNextTurn ?? (currentStep.distance > 0 ? currentStep.distance : undefined)

  return (
    <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: bgMain }}>

      {/* ── Main instruction block ─────────────────────────────────────── */}
      <div className="flex items-stretch">

        {/* Left column: direction arrow (Google Maps style — dedicated panel) */}
        <div
          className={`w-[72px] flex-shrink-0 flex flex-col items-center justify-center py-3 gap-1 ${nearTurn ? 'animate-pulse' : ''}`}
          style={{ background: bgArrow }}
        >
          <DirectionArrow direction={currentStep.direction} />
          {/* Distance to next turn — large and dominant */}
          {primaryDist !== undefined && !isArriving && (
            <p
              className="text-xs font-black tabular-nums leading-none text-center px-1"
              style={{ color: distColor, transition: 'color 0.4s' }}
            >
              {formatMeters(primaryDist)}
            </p>
          )}
        </div>

        {/* Right: instruction + ETA */}
        <div className="flex-1 min-w-0 flex items-center pr-3 pl-3 py-3 gap-2">
          <p className="flex-1 text-white font-black text-base leading-tight line-clamp-2">
            {isArriving
              ? (language === 'es' ? `¡Has llegado! ${currentStep.instruction}` : `Arrived! ${currentStep.instruction}`)
              : currentStep.instruction}
          </p>

          {/* ETA chip — total remaining to POI */}
          {remainingDistance !== undefined && !isArriving && (
            <div className="flex-shrink-0 text-right pl-2 border-l border-white/20 min-w-[52px]">
              <p className="text-white font-black text-sm tabular-nums leading-none">
                {formatMeters(remainingDistance)}
              </p>
              {remainingTime !== undefined && (
                <p className="text-xs mt-0.5 tabular-nums" style={{ color: distColor }}>
                  {formatMinutes(remainingTime)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Step progress bar ─────────────────────────────────────────── */}
      {stepIndex !== undefined && totalSteps !== undefined && totalSteps > 1 && (
        <div className="px-3 pb-1">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white/60 rounded-full transition-all duration-300"
                style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
              />
            </div>
            <span className="text-white/50 text-xs flex-shrink-0 tabular-nums">
              {stepIndex + 1}/{totalSteps}
            </span>
          </div>
        </div>
      )}

      {/* ── "Then" next-step preview strip ────────────────────────────── */}
      {nextStep && !isArriving && (
        <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <span className="text-white/50 text-xs flex-shrink-0 font-semibold uppercase tracking-wide">
            {language === 'es' ? 'Luego' : 'Then'}
          </span>
          <span className="text-white/60">
            <MiniArrow direction={nextStep.direction} />
          </span>
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
