import { ROUTE_TYPE_INFO, type RouteType } from '../types'
import { useAppStore } from '../stores/appStore'

interface RouteTypeSelectorProps {
  selected: RouteType | null
  onSelect: (type: RouteType) => void
  dark?: boolean
}

export function RouteTypeSelector({ selected, onSelect, dark = false }: RouteTypeSelectorProps) {
  const { language } = useAppStore()

  return (
    <div className="grid grid-cols-2 gap-3">
      {ROUTE_TYPE_INFO.map(rt => {
        const isSelected = selected === rt.id
        return (
          <button
            key={rt.id}
            onClick={() => onSelect(rt.id)}
            className={`flex flex-col items-start p-4 rounded-2xl border-2 transition-all active:scale-[0.97] text-left ${
              isSelected
                ? 'border-orange-500 bg-orange-500/20'
                : dark
                  ? 'border-white/20 bg-white/10 hover:border-white/40'
                  : 'border-stone-100 bg-white hover:border-stone-200'
            }`}
          >
            <span className="text-3xl mb-2">{rt.icon}</span>
            <p className={`font-bold text-sm ${isSelected ? 'text-orange-400' : dark ? 'text-white' : 'text-stone-800'}`}>
              {language === 'es' ? rt.labelEs : rt.labelEn}
            </p>
            <p className={`text-xs mt-0.5 leading-tight ${dark ? 'text-white/50' : 'text-stone-400'}`}>
              {language === 'es' ? rt.descriptionEs : rt.descriptionEn}
            </p>
          </button>
        )
      })}
    </div>
  )
}
