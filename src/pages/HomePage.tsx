import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CitySearch } from '../components/CitySearch'
import { useAppStore } from '../stores/appStore'
import { getCityCoords } from '../data/cityData'
import type { City } from '../types'

export function HomePage() {
  const { language, setLanguage, recentCities, setCity, anthropicApiKey } = useAppStore()
  const navigate = useNavigate()

  const { setOffline } = useAppStore()
  useEffect(() => {
    const onOnline = () => setOffline(false)
    const onOffline = () => setOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [setOffline])

  function handleRecentCity(city: City) {
    setCity(city)
    navigate(`/city/${encodeURIComponent(city.name)}`)
  }

  const featuredCities = [
    { name: 'Toledo', emoji: '⚔️', tag: language === 'es' ? 'Historia medieval' : 'Medieval history' },
    { name: 'Sevilla', emoji: '💃', tag: language === 'es' ? 'Arte y flamenco' : 'Art & flamenco' },
    { name: 'Granada', emoji: '🏰', tag: language === 'es' ? 'La Alhambra' : 'The Alhambra' },
    { name: 'Salamanca', emoji: '🎓', tag: language === 'es' ? 'Ciudad universitaria' : 'University city' },
    { name: 'Cádiz', emoji: '🌊', tag: language === 'es' ? 'La más antigua' : 'Oldest city' },
    { name: 'Córdoba', emoji: '🕌', tag: language === 'es' ? 'Mezquita-Catedral' : 'Mosque-Cathedral' },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-amber-50 to-white safe-top">
      {/* Header */}
      <div className="px-5 pt-safe-top pb-6">
        <div className="flex items-center justify-between pt-6 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-3xl">🗺️</span>
              <h1 className="text-3xl font-black text-stone-900 tracking-tight">GuiAgo</h1>
              {anthropicApiKey && (
                <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">IA ✨</span>
              )}
            </div>
            <p className="text-stone-500 text-sm mt-1">
              {language === 'es' ? 'Tu guía turístico inteligente' : 'Your intelligent tourist guide'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Language toggle */}
            <button
              onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
              className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm border border-stone-100 active:scale-95 transition-transform"
            >
              <span className="text-base">{language === 'es' ? '🇪🇸' : '🇬🇧'}</span>
              <span className="text-sm font-semibold text-stone-600">{language === 'es' ? 'ES' : 'EN'}</span>
            </button>
            {/* Settings */}
            <button
              onClick={() => navigate('/settings')}
              className="w-9 h-9 bg-white rounded-xl shadow-sm border border-stone-100 flex items-center justify-center active:scale-95 transition-transform"
            >
              <svg className="w-5 h-5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* "What to visit today" — prominent CTA */}
        <button
          onClick={() => navigate('/today')}
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-4 mb-5 flex items-center gap-4 shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-transform"
        >
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">📍</span>
          </div>
          <div className="flex-1 text-left">
            <p className="text-white font-black text-base">
              {language === 'es' ? '¿Qué visitar hoy?' : 'What to visit today?'}
            </p>
            <p className="text-blue-200 text-xs mt-0.5">
              {language === 'es'
                ? 'Rutas basadas en tu ubicación actual'
                : 'Routes based on your current location'}
            </p>
          </div>
          <svg className="w-5 h-5 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Search */}
        <div className="mb-2">
          <h2 className="text-xl font-bold text-stone-800 mb-3">
            {language === 'es' ? '¿A dónde vamos? 👋' : 'Where are we going? 👋'}
          </h2>
          <CitySearch />
        </div>
      </div>

      <div className="px-5 pb-10">
        {/* Recent cities */}
        {recentCities.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
              {language === 'es' ? 'Visitadas recientemente' : 'Recently visited'}
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {recentCities.map(city => (
                <button
                  key={city.id}
                  onClick={() => handleRecentCity(city)}
                  className="flex-shrink-0 bg-white rounded-xl px-4 py-2.5 shadow-sm border border-stone-100 flex items-center gap-2 active:scale-95 transition-transform"
                >
                  <span>🏙️</span>
                  <div className="text-left">
                    <p className="font-semibold text-stone-800 text-sm">{city.name}</p>
                    <p className="text-xs text-stone-400">{city.country}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Featured cities */}
        <div className="mb-6">
          <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
            {language === 'es' ? 'Destinos populares en España' : 'Popular destinations in Spain'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {featuredCities.map(city => (
              <button
                key={city.name}
                onClick={() => {
                  const coords = getCityCoords(city.name) || { lat: 0, lon: 0 }
                  const c: City = {
                    id: city.name.toLowerCase(),
                    name: city.name,
                    displayName: `${city.name}, España`,
                    country: 'España',
                    countryCode: 'ES',
                    lat: coords.lat,
                    lon: coords.lon,
                    wikipediaTitle: city.name,
                  }
                  setCity(c)
                  navigate(`/city/${encodeURIComponent(city.name)}`)
                }}
                className="bg-white rounded-2xl p-4 shadow-sm border border-stone-50 text-left active:scale-[0.97] transition-transform hover:shadow-md"
              >
                <span className="text-3xl">{city.emoji}</span>
                <p className="font-bold text-stone-800 mt-2">{city.name}</p>
                <p className="text-xs text-stone-400 mt-0.5">{city.tag}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom links */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate('/offline')}
            className="w-full bg-stone-100 rounded-2xl p-4 flex items-center gap-3 active:bg-stone-200 transition-colors"
          >
            <span className="text-2xl">📥</span>
            <div className="text-left flex-1">
              <p className="font-semibold text-stone-700 text-sm">
                {language === 'es' ? 'Rutas descargadas' : 'Downloaded routes'}
              </p>
              <p className="text-xs text-stone-400">
                {language === 'es' ? 'Usa GuiAgo sin internet' : 'Use GuiAgo without internet'}
              </p>
            </div>
            <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => navigate('/settings')}
            className="w-full bg-stone-100 rounded-2xl p-4 flex items-center gap-3 active:bg-stone-200 transition-colors"
          >
            <span className="text-2xl">{anthropicApiKey ? '🤖' : '⚙️'}</span>
            <div className="text-left flex-1">
              <p className="font-semibold text-stone-700 text-sm">
                {language === 'es' ? 'Configuración y IA' : 'Settings & AI'}
              </p>
              <p className="text-xs text-stone-400">
                {anthropicApiKey
                  ? (language === 'es' ? 'IA activada · Clave configurada' : 'AI active · Key configured')
                  : (language === 'es' ? 'Activa el guía con IA' : 'Activate the AI guide')}
              </p>
            </div>
            <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
