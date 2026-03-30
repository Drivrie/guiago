import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { getAllRoutes, deleteRoute } from '../services/storage'
import { Button } from '../components/ui/Button'
import { OfflineDownload } from '../components/OfflineDownload'
import type { Route } from '../types'
import { ROUTE_TYPE_INFO } from '../types'

export function OfflineRoutesPage() {
  const navigate = useNavigate()
  const { language, setCity, setRouteType, setDuration, setPOIs, setRoute } = useAppStore()
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingRoute, setPendingRoute] = useState<Route | null>(null)
  const [showDownloadInSheet, setShowDownloadInSheet] = useState(false)

  useEffect(() => {
    getAllRoutes().then(r => {
      setRoutes(r)
      setLoading(false)
    })
  }, [])

  async function handleDelete(id: string) {
    await deleteRoute(id)
    setRoutes(prev => prev.filter(r => r.id !== id))
  }

  function loadAndNavigate(route: Route) {
    setCity(route.city)
    setRouteType(route.routeType)
    setDuration(route.duration)
    setPOIs(route.pois)
    setRoute(route)
    navigate('/route/active')
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric'
    })
  }

  return (
    <div className="min-h-screen bg-stone-50 safe-top">
      <div className="px-5 pt-safe-top pb-10">
        {/* Header */}
        <div className="flex items-center gap-3 pt-6 mb-6">
          <button
            onClick={() => navigate('/')}
            className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm"
          >
            <svg className="w-5 h-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-black text-stone-900">
              {language === 'es' ? '📥 Rutas offline' : '📥 Offline routes'}
            </h1>
            <p className="text-stone-400 text-sm">
              {language === 'es' ? 'Disponibles sin conexión' : 'Available without connection'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-500" />
          </div>
        ) : routes.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🗺️</div>
            <h2 className="text-xl font-bold text-stone-700 mb-2">
              {language === 'es' ? 'Sin rutas descargadas' : 'No downloaded routes'}
            </h2>
            <p className="text-stone-400 text-sm mb-6 max-w-xs mx-auto">
              {language === 'es'
                ? 'Descarga rutas desde la pantalla de navegación activa para usarlas sin internet.'
                : 'Download routes from the active navigation screen to use them without internet.'}
            </p>
            <Button variant="secondary" onClick={() => navigate('/')}>
              {language === 'es' ? 'Buscar ciudades' : 'Find cities'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {routes.map(route => {
              const routeInfo = ROUTE_TYPE_INFO.find(r => r.id === route.routeType)
              return (
                <div key={route.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => { setPendingRoute(route); setShowDownloadInSheet(false) }}
                    className="w-full text-left p-4 active:bg-stone-50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                        {routeInfo?.icon || '🗺️'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-stone-800">{route.city.name}</h3>
                          {route.isOffline && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                              offline
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-stone-500 capitalize">
                          {routeInfo ? (language === 'es' ? routeInfo.labelEs : routeInfo.labelEn) : route.routeType}
                          {' · '}{route.pois.length} {language === 'es' ? 'paradas' : 'stops'}
                        </p>
                        {route.offlineDownloadedAt && (
                          <p className="text-xs text-stone-400 mt-0.5">
                            {language === 'es' ? 'Descargada: ' : 'Downloaded: '}{formatDate(route.offlineDownloadedAt)}
                          </p>
                        )}
                      </div>
                      <svg className="w-5 h-5 text-stone-300 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>

                  <div className="border-t border-stone-50 px-4 py-2">
                    <button
                      onClick={() => handleDelete(route.id)}
                      className="text-red-500 text-sm font-semibold active:text-red-700"
                    >
                      {language === 'es' ? 'Eliminar' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Route load options modal */}
      {pendingRoute && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPendingRoute(null)} />
          <div className="relative bg-white rounded-t-3xl px-5 pt-5 pb-8 safe-bottom">
            <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
            <h2 className="font-black text-stone-900 text-lg mb-1">
              {pendingRoute.city.name}
            </h2>
            <p className="text-stone-400 text-sm mb-5">
              {(() => {
                const ri = ROUTE_TYPE_INFO.find(r => r.id === pendingRoute.routeType)
                return ri ? (language === 'es' ? ri.labelEs : ri.labelEn) : pendingRoute.routeType
              })()}
              {' · '}{pendingRoute.pois.length} {language === 'es' ? 'paradas' : 'stops'}
            </p>

            {showDownloadInSheet ? (
              <>
                <p className="text-stone-500 text-xs font-semibold uppercase tracking-wide mb-3">
                  {language === 'es' ? 'Descarga de audio' : 'Audio download'}
                </p>
                <OfflineDownload route={pendingRoute} onComplete={() => { setShowDownloadInSheet(false) }} />
                <button
                  onClick={() => setShowDownloadInSheet(false)}
                  className="w-full mt-3 py-3 text-stone-400 text-sm font-medium"
                >
                  {language === 'es' ? 'Volver' : 'Back'}
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Option 1: Start online */}
                <button
                  onClick={() => { setPendingRoute(null); loadAndNavigate(pendingRoute) }}
                  className="w-full py-4 bg-orange-500 text-white font-bold rounded-2xl text-base active:scale-95 transition-transform flex items-center gap-4 px-5"
                >
                  <span className="text-2xl">▶️</span>
                  <div className="text-left">
                    <p className="font-black">{language === 'es' ? 'Iniciar ruta' : 'Start route'}</p>
                    <p className="text-orange-100 text-xs font-normal">
                      {language === 'es' ? 'Usar recursos online (audio + mapa)' : 'Use online resources (audio + map)'}
                    </p>
                  </div>
                </button>

                {/* Option 2: Download audio first */}
                <button
                  onClick={() => setShowDownloadInSheet(true)}
                  className="w-full py-4 bg-stone-100 text-stone-800 font-bold rounded-2xl text-base active:scale-95 transition-transform flex items-center gap-4 px-5"
                >
                  <span className="text-2xl">📥</span>
                  <div className="text-left">
                    <p className="font-black">{language === 'es' ? 'Descargar audio primero' : 'Download audio first'}</p>
                    <p className="text-stone-400 text-xs font-normal">
                      {language === 'es' ? 'Guarda las narraciones para uso sin conexión' : 'Save narrations for offline use'}
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => setPendingRoute(null)}
                  className="w-full py-3 text-stone-400 text-sm font-medium"
                >
                  {language === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
