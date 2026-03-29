import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { RouteSetupPage } from './pages/RouteSetupPage'
import { ActiveRoutePage } from './pages/ActiveRoutePage'
import { POIDetailPage } from './pages/POIDetailPage'
import { OfflineRoutesPage } from './pages/OfflineRoutesPage'
import { TodayPage } from './pages/TodayPage'
import { SettingsPage } from './pages/SettingsPage'
import { useAppStore } from './stores/appStore'

export default function App() {
  const { isOffline, setOffline, language } = useAppStore()

  // Track network changes app-wide
  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return (
    <>
      {/* Offline indicator banner */}
      {isOffline && (
        <div
          className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white safe-top"
          style={{ background: '#B45309' }}
        >
          <span>📡</span>
          <span>{language === 'es' ? 'Sin conexión — modo offline' : 'No connection — offline mode'}</span>
        </div>
      )}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/city/:cityName" element={<RouteSetupPage />} />
        <Route path="/route/active" element={<ActiveRoutePage />} />
        <Route path="/poi/:poiId" element={<POIDetailPage />} />
        <Route path="/offline" element={<OfflineRoutesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
