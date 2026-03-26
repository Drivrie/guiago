import { useNavigate } from 'react-router-dom'
import type { POI } from '../types'
import { useAppStore } from '../stores/appStore'

interface POICardProps {
  poi: POI
  index: number
  isActive?: boolean
  isVisited?: boolean
  onClick?: () => void
}

export function POICard({ poi, index, isActive = false, isVisited = false, onClick }: POICardProps) {
  const { language } = useAppStore()
  const navigate = useNavigate()

  const categoryIcons: Record<string, string> = {
    museo: '🏛️', monument: '🗿', iglesia: '⛪', catedral: '⛪', parque: '🌳',
    jardín: '🌿', mirador: '🔭', mercado: '🛒', bar: '🍺', restaurante: '🍽️',
    castillo: '🏰', ruinas: '🏚️', fuente: '⛲', teatro: '🎭'
  }

  const getCategoryIcon = (cat: string) => {
    for (const [key, icon] of Object.entries(categoryIcons)) {
      if (cat.toLowerCase().includes(key)) return icon
    }
    return '📍'
  }

  function formatDistance(m?: number) {
    if (!m) return null
    if (m < 1000) return `${Math.round(m)} m`
    return `${(m / 1000).toFixed(1)} km`
  }

  function formatWalkTime(min?: number) {
    if (!min) return null
    return `${min} min`
  }

  return (
    <div
      className={`relative rounded-2xl overflow-hidden transition-all active:scale-[0.98] cursor-pointer ${
        isActive
          ? 'bg-orange-500 shadow-lg shadow-orange-200'
          : isVisited
          ? 'bg-stone-100'
          : 'bg-white shadow-sm'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Index badge */}
        <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
          isActive ? 'bg-white text-orange-500' : isVisited ? 'bg-stone-300 text-stone-500' : 'bg-orange-100 text-orange-600'
        }`}>
          {isVisited ? '✓' : index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <h3 className={`font-bold text-base leading-tight ${isActive ? 'text-white' : 'text-stone-800'}`}>
                {poi.name}
              </h3>
              <p className={`text-sm mt-0.5 flex items-center gap-1 ${isActive ? 'text-orange-100' : 'text-stone-400'}`}>
                <span>{getCategoryIcon(poi.category)}</span>
                <span className="capitalize">{poi.category}</span>
              </p>
            </div>
          </div>

          {/* Distance / walk info */}
          {(poi.distanceFromPrev || poi.walkingTimeFromPrev) && (
            <div className={`flex items-center gap-3 mt-2 text-xs ${isActive ? 'text-orange-100' : 'text-stone-400'}`}>
              {poi.distanceFromPrev && (
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  {formatDistance(poi.distanceFromPrev)}
                </span>
              )}
              {poi.walkingTimeFromPrev && (
                <span className="flex items-center gap-1">
                  🚶 {formatWalkTime(poi.walkingTimeFromPrev)}
                </span>
              )}
              {poi.estimatedVisitMinutes && (
                <span className="flex items-center gap-1">
                  ⏱️ ~{poi.estimatedVisitMinutes} min
                </span>
              )}
            </div>
          )}
        </div>

        {/* Arrow */}
        <div className={`flex-shrink-0 ${isActive ? 'text-orange-100' : 'text-stone-300'}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </div>
  )
}
