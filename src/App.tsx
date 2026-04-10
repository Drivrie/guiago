import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { RouteSetupPage } from './pages/RouteSetupPage'
import { ActiveRoutePage } from './pages/ActiveRoutePage'
import { POIDetailPage } from './pages/POIDetailPage'
import { OfflineRoutesPage } from './pages/OfflineRoutesPage'
import { TodayPage } from './pages/TodayPage'
import { SettingsPage } from './pages/SettingsPage'
import { useAppStore } from './stores/appStore'
import { Chatbot } from './components/Chatbot'


export default function App() {
  const { isOffline, setOffline, language } = useAppStore()
  const [showChatbot, setShowChatbot] = useState(false)

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

      {/* Chatbot button */}
      <div className="chatbot-container" onClick={() => setShowChatbot(!showChatbot)}>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </div>

      {/* Chatbot modal */}
      {showChatbot && <Chatbot onClose={() => setShowChatbot(false)} />}
    </>
  )
}