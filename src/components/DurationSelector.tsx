import { DURATION_OPTIONS, type RouteDuration } from '../types'
import { useAppStore } from '../stores/appStore'

interface DurationSelectorProps {
  selected: RouteDuration | null
  onSelect: (d: RouteDuration) => void
  dark?: boolean
}

export function DurationSelector({ selected, onSelect, dark = false }: DurationSelectorProps) {
  const { language } = useAppStore()

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
      {DURATION_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={`flex-shrink-0 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 ${
            selected === opt.value
              ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
              : dark
                ? 'bg-white/10 text-white hover:bg-white/20'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
          }`}
        >
          <span className="block text-base font-bold">{opt.shortLabel}</span>
          <span className="block text-xs opacity-80">
            {language === 'es' ? opt.labelEs : opt.labelEn}
          </span>
        </button>
      ))}
    </div>
  )
}
