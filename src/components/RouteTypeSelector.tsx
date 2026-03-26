import { ROUTE_TYPE_INFO, type RouteType } from '../types'
import { useAppStore } from '../stores/appStore'

interface RouteTypeSelectorProps {
  selected: RouteType | null
  onSelect: (type: RouteType) => void
}

export function RouteTypeSelector({ selected, onSelect }: RouteTypeSelectorProps) {
  const { language } = useAppStore()

  return (
    <div className="grid grid-cols-2 gap-3">
      {ROUTE_TYPE_INFO.map(rt => (
        <button
          key={rt.id}
          onClick={() => onSelect(rt.id)}
          className={`flex flex-col items-start p-4 rounded-2xl border-2 transition-all active:scale-[0.97] text-left ${
            selected === rt.id
              ? 'border-orange-500 bg-orange-50'
              : 'border-stone-100 bg-white hover:border-stone-200'
          }`}
        >
          <span className="text-3xl mb-2">{rt.icon}</span>
          <p className={`font-bold text-sm ${selected === rt.id ? 'text-orange-700' : 'text-stone-800'}`}>
            {language === 'es' ? rt.labelEs : rt.labelEn}
          </p>
          <p className="text-xs text-stone-400 mt-0.5 leading-tight">
            {language === 'es' ? rt.descriptionEs : rt.descriptionEn}
          </p>
        </button>
      ))}
    </div>
  )
}
