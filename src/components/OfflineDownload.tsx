import { useState } from 'react'
import type { Route } from '../types'
import { saveRoute, saveAudioScript, savePOIDescription, getStorageEstimate, estimateRouteStorage } from '../services/storage'
import { getPOIDescription, generateAudioScript } from '../services/wikipedia'
import { useAppStore } from '../stores/appStore'
import { Button } from './ui/Button'

interface OfflineDownloadProps {
  route: Route
  onComplete?: () => void
}

export function OfflineDownload({ route, onComplete }: OfflineDownloadProps) {
  const { language } = useAppStore()
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(route.isOffline ?? false)
  const [error, setError] = useState<string | null>(null)

  const estimatedMB = (estimateRouteStorage(route.pois.length) / 1024 / 1024).toFixed(1)

  async function handleDownload() {
    if (downloading) return

    // Check network
    if (!navigator.onLine) {
      setError(language === 'es'
        ? 'Sin conexión a internet. Conéctate a WiFi para descargar.'
        : 'No internet connection. Connect to WiFi to download.')
      return
    }

    setDownloading(true)
    setError(null)
    setProgress(0)

    try {
      const total = route.pois.length
      let completed = 0

      for (const poi of route.pois) {
        // Fetch Wikipedia description
        const desc = await getPOIDescription(poi.name, language)
        if (desc) {
          await savePOIDescription(poi.id, desc, language)
          const audioScript = generateAudioScript({ name: poi.name, category: poi.category, description: desc }, language)
          await saveAudioScript(poi.id, audioScript, language)
        }
        completed++
        setProgress(Math.round((completed / total) * 100))
      }

      // Save the route itself
      const offlineRoute: Route = {
        ...route,
        isOffline: true,
        offlineDownloadedAt: new Date().toISOString()
      }
      await saveRoute(offlineRoute)

      setDone(true)
      onComplete?.()
    } catch (err) {
      setError(language === 'es'
        ? 'Error al descargar. Inténtalo de nuevo.'
        : 'Download error. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  if (done) {
    return (
      <div className="bg-green-50 rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center text-xl flex-shrink-0">✅</div>
        <div>
          <p className="font-semibold text-green-800 text-sm">
            {language === 'es' ? 'Ruta disponible offline' : 'Route available offline'}
          </p>
          <p className="text-green-600 text-xs mt-0.5">
            {language === 'es' ? 'Puedes usarla sin conexión' : 'You can use it without connection'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-blue-50 rounded-2xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-xl flex-shrink-0">📥</div>
        <div className="flex-1">
          <p className="font-semibold text-stone-800 text-sm">
            {language === 'es' ? 'Descargar para usar offline' : 'Download for offline use'}
          </p>
          <p className="text-stone-400 text-xs mt-0.5">
            {language === 'es'
              ? `~${estimatedMB} MB • ${route.pois.length} puntos de interés`
              : `~${estimatedMB} MB • ${route.pois.length} points of interest`}
          </p>
        </div>
      </div>

      {downloading && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-stone-500 mb-1">
            <span>{language === 'es' ? 'Descargando...' : 'Downloading...'}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

      <Button
        onClick={handleDownload}
        loading={downloading}
        size="sm"
        fullWidth
        variant="secondary"
      >
        {language === 'es' ? 'Descargar por WiFi' : 'Download via WiFi'}
      </Button>
    </div>
  )
}
