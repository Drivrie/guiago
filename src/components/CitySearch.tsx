import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchCities } from '../services/nominatim'
import { useAppStore } from '../stores/appStore'
import { SearchBar } from './ui/SearchBar'
import type { City } from '../types'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function CitySearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<City[]>([])
  const [loading, setLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const debouncedQuery = useDebounce(query, 350)
  const { language, setCity } = useAppStore()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    searchCities(debouncedQuery, language).then(cities => {
      setResults(cities)
      setShowResults(true)
      setLoading(false)
    })
  }, [debouncedQuery, language])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSelect(city: City) {
    setCity(city)
    setQuery('')
    setShowResults(false)
    navigate(`/city/${encodeURIComponent(city.name)}`)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <SearchBar
        placeholder={language === 'es' ? 'Busca una ciudad...' : 'Search a city...'}
        value={query}
        onChange={v => { setQuery(v); if (v.length >= 2) setShowResults(true) }}
        onClear={() => { setResults([]); setShowResults(false) }}
        autoFocus
      />

      {loading && (
        <div className="absolute right-4 top-3.5">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-500" />
        </div>
      )}

      {showResults && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-stone-100 overflow-hidden z-50 max-h-72 overflow-y-auto">
          {results.map(city => (
            <button
              key={city.id}
              className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-orange-50 active:bg-orange-100 border-b border-stone-50 last:border-0 transition-colors"
              onClick={() => handleSelect(city)}
            >
              <span className="text-2xl">🏙️</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-stone-800 truncate">{city.name}</p>
                <p className="text-sm text-stone-400 truncate">{city.country}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {showResults && !loading && results.length === 0 && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-stone-100 p-4 text-center z-50">
          <p className="text-stone-400 text-sm">
            {language === 'es' ? 'No se encontraron ciudades' : 'No cities found'}
          </p>
        </div>
      )}
    </div>
  )
}
