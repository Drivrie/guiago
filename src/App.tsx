import { Routes, Route, Navigate } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { RouteSetupPage } from './pages/RouteSetupPage'
import { ActiveRoutePage } from './pages/ActiveRoutePage'
import { POIDetailPage } from './pages/POIDetailPage'
import { OfflineRoutesPage } from './pages/OfflineRoutesPage'
import { TodayPage } from './pages/TodayPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
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
  )
}
