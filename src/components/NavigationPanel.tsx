import type { NavigationStep } from '../types'
import { useAppStore } from '../stores/appStore'

interface NavigationPanelProps {
  currentStep?: NavigationStep
  nextStep?: NavigationStep
  remainingDistance?: number
  remainingTime?: number
}

const directionIcons: Record<string, string> = {
  straight: '↑',
  left: '←',
  right: '→',
  slight_left: '↖',
  slight_right: '↗',
  u_turn: '↩',
  arrive: '📍'
}

function formatMeters(m: number): string {
  if (m < 100) return `${Math.round(m)} m`
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1)} km`
}

export function NavigationPanel({ currentStep, nextStep, remainingDistance, remainingTime }: NavigationPanelProps) {
  const { language } = useAppStore()

  if (!currentStep) return null

  const icon = directionIcons[currentStep.direction || 'straight']

  return (
    <div className="bg-stone-900 rounded-2xl p-4 text-white">
      {/* Main instruction */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-orange-500 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1">
          <p className="font-bold text-lg leading-tight">{currentStep.instruction}</p>
          <p className="text-orange-400 font-semibold mt-1">{formatMeters(currentStep.distance)}</p>
        </div>
      </div>

      {/* Next step preview */}
      {nextStep && (
        <div className="mt-3 pt-3 border-t border-stone-700 flex items-center gap-3">
          <span className="text-stone-400 text-sm">{language === 'es' ? 'Luego:' : 'Then:'}</span>
          <span className="text-lg">{directionIcons[nextStep.direction || 'straight']}</span>
          <span className="text-stone-300 text-sm flex-1 truncate">{nextStep.instruction}</span>
        </div>
      )}

      {/* Summary */}
      {(remainingDistance !== undefined || remainingTime !== undefined) && (
        <div className="flex gap-4 mt-3 pt-3 border-t border-stone-700">
          {remainingDistance !== undefined && (
            <div className="text-center">
              <p className="text-orange-400 font-bold">{formatMeters(remainingDistance)}</p>
              <p className="text-stone-400 text-xs">{language === 'es' ? 'restante' : 'remaining'}</p>
            </div>
          )}
          {remainingTime !== undefined && (
            <div className="text-center">
              <p className="text-orange-400 font-bold">{Math.round(remainingTime / 60)} min</p>
              <p className="text-stone-400 text-xs">{language === 'es' ? 'aprox.' : 'approx.'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
