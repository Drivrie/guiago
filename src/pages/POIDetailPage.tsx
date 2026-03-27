import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AudioPlayer } from '../components/AudioPlayer'
import { MapView } from '../components/MapView'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../stores/appStore'
import { getPOIDescription, generateAudioScript } from '../services/wikipedia'
import { getPOIDescription as getCachedDesc } from '../services/storage'

export function POIDetailPage() {
  const { poiId } = useParams<{ poiId: string }>()
  const navigate = useNavigate()
  const { language, pois, currentPOIIndex, setCurrentPOIIndex } = useAppStore()

  const [description, setDescription] = useState<string>('')
  const [audioScript, setAudioScript] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const poi = pois.find(p => p.id === decodeURIComponent(poiId || ''))
  const poiIndex = pois.findIndex(p => p.id === (poi?.id || ''))

  useEffect(() => {
    if (!poi) return
    setLoading(true)

    // Try cached first
    getCachedDesc(poi.id, language).then(cached => {
      if (cached) {
        setDescription(cached)
        setAudioScript(generateAudioScript({ name: poi.name, category: poi.category, description: cached }, language))
        setLoading(false)
        return
      }
      getPOIDescription(poi.name, language).then(desc => {
        const d = desc || ''
        setDescription(d)
        setAudioScript(generateAudioScript({ name: poi.name, category: poi.category, description: d || undefined }, language))
        setLoading(false)
      })
    })
  }, [poi, language])

  if (!poi) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-stone-500 mb-4">{language === 'es' ? 'Lugar no encontrado' : 'Place not found'}</p>
          <Button onClick={() => navigate(-1)}>{language === 'es' ? 'Volver' : 'Go back'}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 safe-top">
      {/* Header: image if available, otherwise map */}
      <div className="relative h-56">
        {poi.imageUrl ? (
          <img
            src={poi.imageUrl}
            alt={poi.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <MapView
            pois={[poi]}
            currentPOIIndex={0}
            className="w-full h-full"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 mt-safe-top w-10 h-10 bg-black/30 backdrop-blur-sm rounded-xl flex items-center justify-center text-white"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="absolute bottom-4 left-4 right-4">
          <div className="inline-block bg-orange-500/90 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full capitalize mb-2">
            {poi.category}
          </div>
          <h1 className="text-white font-black text-2xl leading-tight">{poi.name}</h1>
        </div>
      </div>

      <div className="px-5 py-5 pb-32">
        {/* Audio player */}
        {audioScript && (
          <div className="mb-6">
            <AudioPlayer text={audioScript} poiName={poi.name} />
          </div>
        )}

        {/* Info chips */}
        <div className="flex flex-wrap gap-2 mb-6">
          {poi.address && (
            <div className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm text-sm text-stone-600">
              <span>📍</span> {poi.address}
            </div>
          )}
          {poi.openingHours && (
            <div className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm text-sm text-stone-600">
              <span>🕐</span> {poi.openingHours}
            </div>
          )}
          {poi.estimatedVisitMinutes && (
            <div className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm text-sm text-stone-600">
              <span>⏱️</span> ~{poi.estimatedVisitMinutes} min
            </div>
          )}
          {poi.website && (
            <a
              href={poi.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm text-sm text-orange-600"
            >
              <span>🌐</span> {language === 'es' ? 'Web oficial' : 'Official website'}
            </a>
          )}
        </div>

        {/* Description */}
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-6">
          <h2 className="font-bold text-stone-800 mb-3 flex items-center gap-2">
            <span>📖</span>
            {language === 'es' ? 'Historia y descripción' : 'History & description'}
          </h2>
          {loading ? (
            <LoadingSpinner size="sm" message={language === 'es' ? 'Cargando información...' : 'Loading information...'} />
          ) : description ? (
            <p className="text-stone-600 leading-relaxed text-sm">{description}</p>
          ) : (
            <p className="text-stone-400 text-sm italic">
              {language === 'es'
                ? 'No se encontró información adicional de este lugar.'
                : 'No additional information found for this place.'}
            </p>
          )}
        </div>
      </div>

      {/* Bottom actions */}
      {pois.length > 1 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-sm border-t border-stone-100 safe-bottom">
          <Button
            fullWidth
            onClick={() => {
              if (poiIndex >= 0) setCurrentPOIIndex(poiIndex)
              navigate('/route/active')
            }}
          >
            {language === 'es' ? '🗺️ Volver a la ruta' : '🗺️ Back to route'}
          </Button>
        </div>
      )}
    </div>
  )
}
