import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { City, POI, Route, RouteType, RouteDuration, Language } from '../types'

interface AppStore {
  // Settings
  language: Language
  setLanguage: (lang: Language) => void

  // AI
  anthropicApiKey: string
  setAnthropicApiKey: (key: string) => void

  // City
  selectedCity: City | null
  setCity: (city: City | null) => void
  recentCities: City[]
  addRecentCity: (city: City) => void

  // Route config
  selectedRouteType: RouteType | null
  setRouteType: (type: RouteType | null) => void
  selectedDuration: RouteDuration | null
  setDuration: (duration: RouteDuration | null) => void

  // POIs and route
  pois: POI[]
  setPOIs: (pois: POI[]) => void
  currentRoute: Route | null
  setRoute: (route: Route | null) => void

  // Navigation state
  currentPOIIndex: number
  setCurrentPOIIndex: (idx: number) => void
  nextPOI: () => void
  prevPOI: () => void
  isNavigating: boolean
  startNavigation: () => void
  stopNavigation: () => void

  // Audio
  isAudioPlaying: boolean
  setAudioPlaying: (playing: boolean) => void
  audioRate: number
  setAudioRate: (rate: number) => void

  // UI state
  isLoading: boolean
  loadingMessage: string
  setLoading: (loading: boolean, message?: string) => void
  error: string | null
  setError: (error: string | null) => void

  // Offline
  isOffline: boolean
  setOffline: (offline: boolean) => void

  // Visit history: cityId → POI names visited
  visitedPOIs: Record<string, string[]>
  markPOIsVisited: (cityId: string, poiNames: string[]) => void
  getVisitedPOINames: (cityId: string) => string[]
  clearVisitHistory: (cityId?: string) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      language: 'es',
      setLanguage: (language) => set({ language }),

      anthropicApiKey: '',
      setAnthropicApiKey: (anthropicApiKey) => set({ anthropicApiKey }),

      selectedCity: null,
      setCity: (city) => {
        set({ selectedCity: city })
        if (city) get().addRecentCity(city)
      },
      recentCities: [],
      addRecentCity: (city) => {
        const current = get().recentCities
        const filtered = current.filter(c => c.id !== city.id)
        set({ recentCities: [city, ...filtered].slice(0, 5) })
      },

      selectedRouteType: null,
      setRouteType: (type) => set({ selectedRouteType: type }),
      selectedDuration: null,
      setDuration: (duration) => set({ selectedDuration: duration }),

      pois: [],
      setPOIs: (pois) => set({ pois }),
      currentRoute: null,
      setRoute: (route) => set({ currentRoute: route }),

      currentPOIIndex: 0,
      setCurrentPOIIndex: (idx) => set({ currentPOIIndex: idx }),
      nextPOI: () => {
        const { currentPOIIndex, pois } = get()
        if (currentPOIIndex < pois.length - 1) {
          set({ currentPOIIndex: currentPOIIndex + 1 })
        }
      },
      prevPOI: () => {
        const { currentPOIIndex } = get()
        if (currentPOIIndex > 0) {
          set({ currentPOIIndex: currentPOIIndex - 1 })
        }
      },
      isNavigating: false,
      startNavigation: () => set({ isNavigating: true, currentPOIIndex: 0 }),
      stopNavigation: () => set({ isNavigating: false }),

      isAudioPlaying: false,
      setAudioPlaying: (playing) => set({ isAudioPlaying: playing }),
      audioRate: 1.0,
      setAudioRate: (rate) => set({ audioRate: rate }),

      isLoading: false,
      loadingMessage: '',
      setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),
      error: null,
      setError: (error) => set({ error }),

      isOffline: !navigator.onLine,
      setOffline: (offline) => set({ isOffline: offline }),

      visitedPOIs: {},
      markPOIsVisited: (cityId, poiNames) => {
        const current = get().visitedPOIs
        const existing = current[cityId] || []
        const merged = Array.from(new Set([...existing, ...poiNames]))
        set({ visitedPOIs: { ...current, [cityId]: merged } })
      },
      getVisitedPOINames: (cityId) => get().visitedPOIs[cityId] || [],
      clearVisitHistory: (cityId) => {
        if (cityId) {
          const current = { ...get().visitedPOIs }
          delete current[cityId]
          set({ visitedPOIs: current })
        } else {
          set({ visitedPOIs: {} })
        }
      },
    }),
    {
      name: 'guiago-store',
      partialize: (state) => ({
        language: state.language,
        recentCities: state.recentCities,
        audioRate: state.audioRate,
        anthropicApiKey: state.anthropicApiKey,
        visitedPOIs: state.visitedPOIs,
      }),
    }
  )
)
