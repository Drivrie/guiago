import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CitySearch } from '../components/CitySearch'
import { useAppStore } from '../stores/appStore'
import { getCityCoords } from '../data/cityData'
import type { City } from '../types'

export function HomePage() {
  const { language, setLanguage, recentCities, setCity } = useAppStore()
  const navigate = useNavigate()

  // Monitor online/offline
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
      <div className="px-5 pt-safe-top pb-8">
        <div className="flex items-center justify-between pt-6 mb-8">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-3xl">🗺️</span>
              <h1 className="text-3xl font-black text-stone-900 tracking-tight">GuiAgo</h1>
            </div>
            <p className="text-stone-500 text-sm mt-1">
              {language === 'es' ? 'Tu guía turístico de bolsillo' : 'Your pocket tourist guide'}
            </p>
          </div>
          {/* Language toggle */}
          <button
            onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
            className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm border border-stone-100 active:scale-95 transition-transform"
          >
            <span className="text-base">{language === 'es' ? '🇪🇸' : '🇬🇧'}</span>
            <span className="text-sm font-semibold text-stone-600">{language === 'es' ? 'ES' : 'EN'}</span>
          </button>
        </div>

        {/* Search */}
        <div className="mb-2">
          <h2 className="text-xl font-bold text-stone-800 mb-3">
            {language === 'es' ? '¿A dónde vamos hoy? 👋' : 'Where are we going today? 👋'}
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
        <div>
          <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
            {language === 'es' ? 'Destinos populares en España' : 'Popular destinations in Spain'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {featuredCities.map(city => (
              <button
                key={city.name}
                onClick={() => {
                  // Quick navigate to a Spanish city
                  const coords = getCityCoords(city.name) || { lat: 0, lon: 0 }
                  const c: City = {
                    id: city.name.toLowerCase(),
                    name: city.name,
                    displayName: `${city.name}, España`,
                    country: 'España',
                    countryCode: 'ES',
                    lat: coords.lat,
                    lon: coords.lon,
                    wikipediaTitle: city.name
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

        {/* Offline routes link */}
        <button
          onClick={() => navigate('/offline')}
          className="mt-6 w-full bg-stone-100 rounded-2xl p-4 flex items-center gap-3 active:bg-stone-200 transition-colors"
        >
          <span className="text-2xl">📥</span>
          <div className="text-left">
            <p className="font-semibold text-stone-700 text-sm">
              {language === 'es' ? 'Rutas descargadas' : 'Downloaded routes'}
            </p>
            <p className="text-xs text-stone-400">
              {language === 'es' ? 'Usa GuiAgo sin internet' : 'Use GuiAgo without internet'}
            </p>
          </div>
          <svg className="ml-auto w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
