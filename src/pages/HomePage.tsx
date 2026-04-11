import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CitySearch } from '../components/CitySearch'
import { useAppStore } from '../stores/appStore'
import { getNearbyCities, getFlagEmoji, getCityDetails } from '../services/nominatim'
import { hasAIKey } from '../services/ai'
import type { City } from '../types'

// Always-visible fallback: diverse international mix shown immediately on load
const FALLBACK_CITIES: Array<City & { emoji: string; tag: { es: string; en: string } }> = [
  { id: 'roma', name: 'Roma', displayName: 'Roma, Italia', country: 'Italia', countryCode: 'IT', lat: 41.9028, lon: 12.4964, wikipediaTitle: 'Roma', emoji: '🏛️', tag: { es: 'Ciudad eterna', en: 'Eternal city' } },
  { id: 'paris', name: 'París', displayName: 'París, Francia', country: 'Francia', countryCode: 'FR', lat: 48.8566, lon: 2.3522, wikipediaTitle: 'París', emoji: '🗼', tag: { es: 'Ciudad de la luz', en: 'City of light' } },
  { id: 'lisboa', name: 'Lisboa', displayName: 'Lisboa, Portugal', country: 'Portugal', countryCode: 'PT', lat: 38.7223, lon: -9.1393, wikipediaTitle: 'Lisboa', emoji: '🌊', tag: { es: 'Siete colinas', en: 'Seven hills' } },
  { id: 'amsterdam', name: 'Ámsterdam', displayName: 'Ámsterdam, Países Bajos', country: 'Países Bajos', countryCode: 'NL', lat: 52.3676, lon: 4.9041, wikipediaTitle: 'Ámsterdam', emoji: '🚲', tag: { es: 'Canales y arte', en: 'Canals & art' } },
  { id: 'berlin', name: 'Berlín', displayName: 'Berlín, Alemania', country: 'Alemania', countryCode: 'DE', lat: 52.5200, lon: 13.4050, wikipediaTitle: 'Berlín', emoji: '🎭', tag: { es: 'Historia y cultura', en: 'History & culture' } },
  { id: 'praga', name: 'Praga', displayName: 'Praga, República Checa', country: 'República Checa', countryCode: 'CZ', lat: 50.0755, lon: 14.4378, wikipediaTitle: 'Praga', emoji: '🏰', tag: { es: 'Ciudad de oro', en: 'Golden city' } },
  { id: 'madrid', name: 'Madrid', displayName: 'Madrid, España', country: 'España', countryCode: 'ES', lat: 40.4168, lon: -3.7038, wikipediaTitle: 'Madrid', emoji: '🎯', tag: { es: 'Capital vibrante', en: 'Vibrant capital' } },
  { id: 'barcelona', name: 'Barcelona', displayName: 'Barcelona, España', country: 'España', countryCode: 'ES', lat: 41.3851, lon: 2.1734, wikipediaTitle: 'Barcelona', emoji: '🎨', tag: { es: 'Gaudí y mar', en: 'Gaudí & sea' } },
]

export function HomePage() {
  const { language, setLanguage, recentCities, setCity, anthropicApiKey } = useAppStore()
  const aiActive = hasAIKey(anthropicApiKey)
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

  // nearbyCities: null = not fetched yet, [] = no results, [...] = results ready
  const [nearbyCities, setNearbyCities] = useState<(City & { distanceKm?: number })[] | null>(null)
  const [searchingLocation, setSearchingLocation] = useState(false)
  const [locationGranted, setLocationGranted] = useState(false)
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null)

  // Effect 1: request GPS once on mount, with a safety timer for silent blocks
  useEffect(() => {
    if (!navigator.geolocation) return

    setSearchingLocation(true)

    // Safety net: some mobile browsers block GPS silently without calling the error cb
    const safetyTimer = setTimeout(() => setSearchingLocation(false), 9000)

    navigator.geolocation.getCurrentPosition(
      pos => {
        clearTimeout(safetyTimer)
        setUserCoords([pos.coords.latitude, pos.coords.longitude])
        setLocationGranted(true)
        setSearchingLocation(false)
      },
      () => {
        clearTimeout(safetyTimer)
        setSearchingLocation(false)
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    )

    return () => clearTimeout(safetyTimer)
  }, [])

  // Effect 2: fetch nearby cities when coords arrive (re-fetches on language change too)
  useEffect(() => {
    if (!userCoords) return
    const [lat, lon] = userCoords
    getNearbyCities(lat, lon, language)
      .then(cities => setNearbyCities(cities.length > 0 ? cities : []))
      .catch(() => setNearbyCities([]))
  }, [userCoords, language])

  function handleRecentCity(city: City) {
    setCity(city)
    navigate(`/city/${encodeURIComponent(city.name)}`)
  }

  async function handleCityClick(city: City) {
    let fullCity = city
    if (!city.country && city.lat && city.lon) {
      const details = await getCityDetails(city.lat, city.lon)
      if (details) fullCity = { ...city, country: details.country, countryCode: details.countryCode }
    }
    setCity(fullCity)
    navigate(`/city/${encodeURIComponent(fullCity.name)}`)
  }

  function getCityTag(city: City & { distanceKm?: number }): string {
    if (city.distanceKm !== undefined) {
      return city.distanceKm < 10
        ? (language === 'es' ? 'Tu zona' : 'Your area')
        : (language === 'es' ? `a ${city.distanceKm} km` : `${city.distanceKm} km away`)
    }
    return city.country || ''
  }

  // Always show something: nearby cities when ready, fallback otherwise
  const hasNearby = nearbyCities !== null && nearbyCities.length > 0
  const displayCities = hasNearby ? nearbyCities! : FALLBACK_CITIES

  const sectionTitle = hasNearby
    ? (language === 'es' ? 'Ciudades cercanas a ti' : 'Cities near you')
    : (language === 'es' ? 'Destinos populares en el mundo' : 'Popular destinations worldwide')

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-amber-50 to-white safe-top">
      {/* Header */}
      <div className="px-5 pt-safe-top pb-6">
        <div className="flex items-center justify-between pt-6 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-3xl">🗺️</span>
              <h1 className="text-3xl font-black text-stone-900 tracking-tight">GuiAgo</h1>
              {aiActive && (
                <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">IA ✨</span>
              )}
            </div>
            <p className="text-stone-500 text-sm mt-1">
              {language === 'es' ? 'Tu guía turístico inteligente' : 'Your intelligent tourist guide'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
              className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm border border-stone-100 active:scale-95 transition-transform"
            >
              <span className="text-base">{language === 'es' ? '🇪🇸' : '🇬🇧'}</span>
              <span className="text-sm font-semibold text-stone-600">{language === 'es' ? 'ES' : 'EN'}</span>
            </button>
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
              {language === 'es' ? 'Rutas basadas en tu ubicación actual' : 'Routes based on your current location'}
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

        {/* City recommendations — ALWAYS visible from the very first render */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wider">
              {sectionTitle}
            </h3>
            {/* Subtle indicator while waiting for GPS / Overpass */}
            {(searchingLocation || (locationGranted && nearbyCities === null)) && (
              <span className="flex items-center gap-1.5 text-xs text-blue-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
                {language === 'es' ? 'Buscando cercanas…' : 'Finding nearby…'}
              </span>
            )}
            {hasNearby && (
              <span className="text-xs text-blue-500 font-medium flex items-center gap-1">
                <span>📍</span>
                {language === 'es' ? 'Según tu ubicación' : 'Based on your location'}
              </span>
            )}
          </div>

          {/* City grid — always rendered, never hidden */}
          <div className="grid grid-cols-2 gap-3">
            {(displayCities as Array<City & { distanceKm?: number; emoji?: string; tag?: { es: string; en: string } }>).map(city => {
              const emoji = city.emoji || (city.countryCode ? getFlagEmoji(city.countryCode) : '🏙️')
              const tag = city.tag
                ? (language === 'es' ? city.tag.es : city.tag.en)
                : getCityTag(city)
              return (
                <button
                  key={city.id}
                  onClick={() => handleCityClick(city)}
                  className="bg-white rounded-2xl p-4 shadow-sm border border-stone-50 text-left active:scale-[0.97] transition-transform hover:shadow-md"
                >
                  <span className="text-3xl">{emoji}</span>
                  <p className="font-bold text-stone-800 mt-2 truncate">{city.name}</p>
                  <p className="text-xs text-stone-400 mt-0.5 truncate">{tag}</p>
                </button>
              )
            })}
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
            <span className="text-2xl">{aiActive ? '🤖' : '⚙️'}</span>
            <div className="text-left flex-1">
              <p className="font-semibold text-stone-700 text-sm">
                {language === 'es' ? 'Configuración y IA' : 'Settings & AI'}
              </p>
              <p className="text-xs text-stone-400">
                {aiActive
                  ? (language === 'es' ? 'IA activa · Guía profesional' : 'AI active · Professional guide')
                  : (language === 'es' ? 'Configuración del guía' : 'Guide settings')}
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
