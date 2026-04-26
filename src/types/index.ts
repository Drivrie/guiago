export type Language = 'es' | 'en' | 'pl' | 'de' | 'fr' | 'it' | 'pt' | 'ru' | string

export type CountryCode = string

export type RouteType =
  | 'imprescindibles'
  | 'secretos_locales'
  | 'monumental'
  | 'historia_negra'
  | 'curiosidades'
  | 'gastronomia'
  | 'arquitectura'
  | 'naturaleza'

export type RouteDuration = 60 | 120 | 180 | 240 | 480

export interface Coordinates { lat: number; lon: number }

export interface City {
  id: string
  name: string
  displayName: string
  country: string
  countryCode: string
  lat: number
  lon: number
  boundingBox?: [number, number, number, number]
  population?: number
  imageUrl?: string
  wikipediaTitle?: string
}

export interface POI {
  id: string
  name: string
  lat: number
  lon: number
  category: string
  routeType: RouteType
  description?: string
  shortDescription?: string
  wikipediaTitle?: string
  wikipediaPageId?: number
  imageUrl?: string
  address?: string
  openingHours?: string
  website?: string
  phone?: string
  tags?: Record<string, string>
  estimatedVisitMinutes?: number
  distanceFromPrev?: number
  walkingTimeFromPrev?: number
}

export interface NavigationStep {
  instruction: string
  distance: number
  duration: number
  direction?: 'straight' | 'left' | 'right' | 'slight_left' | 'slight_right' | 'u_turn' | 'arrive'
  coordinates?: [number, number]
  icon?: string
}

export interface RouteSegment {
  from: POI
  to: POI
  steps: NavigationStep[]
  distance: number
  duration: number
  geometry: [number, number][]
}

export interface Route {
  id: string
  city: City
  routeType: RouteType
  duration: RouteDuration
  pois: POI[]
  segments: RouteSegment[]
  totalDistance: number
  totalDuration: number
  createdAt: string
  language: Language
  isOffline?: boolean
  offlineDownloadedAt?: string
  story?: string
}

export interface AudioGuide {
  poiId: string
  text: string
  language: Language
  duration?: number
  isPlaying?: boolean
  isPaused?: boolean
  progress?: number
}

export interface WikiResult {
  pageid: number
  title: string
  extract: string
  imageUrl?: string
  url: string
}

export interface NominatimResult {
  place_id: number
  display_name: string
  name: string
  lat: string
  lon: string
  type: string
  class: string
  importance: number
  boundingbox: string[]
  address?: {
    city?: string
    town?: string
    village?: string
    country?: string
    country_code?: string
    state?: string
    county?: string
  }
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
  nodes?: number[]
}

export interface RouteResult {
  distance: number
  duration: number
  geometry: {
    coordinates: [number, number][]
    type: string
  }
  legs: Array<{
    distance: { value: number; text: string }
    duration: { value: number; text: string }
    steps: Array<{
      distance: { value: number; text: string }
      duration: { value: number; text: string }
      instruction: string
      maneuver?: {
        type: string
        modifier?: string
        location?: [number, number]
      }
      geometry?: {
        coordinates: [number, number][]
      }
    }>
  }>
}

export interface AppState {
  language: Language
  selectedCity: City | null
  selectedRouteType: RouteType | null
  selectedDuration: RouteDuration | null
  pois: POI[]
  currentRoute: Route | null
  currentPOIIndex: number
  isNavigating: boolean
  isOffline: boolean
  isAudioPlaying: boolean
  isLoading: boolean
  loadingMessage: string
  recentCities: City[]
  error: string | null
}

export interface RouteTypeInfo {
  id: RouteType
  labelEs: string
  labelEn: string
  descriptionEs: string
  descriptionEn: string
  icon: string
  color: string
}

export const ROUTE_TYPE_INFO: RouteTypeInfo[] = [
  {
    id: 'imprescindibles',
    labelEs: 'Imprescindibles',
    labelEn: 'Must-See',
    descriptionEs: 'Los lugares que no puedes perderte bajo ningún concepto',
    descriptionEn: 'The places you absolutely cannot miss',
    icon: '⭐',
    color: '#F59E0B'
  },
  {
    id: 'secretos_locales',
    labelEs: 'Secretos Locales',
    labelEn: 'Local Secrets',
    descriptionEs: 'Rincones ocultos y joyas escondidas que solo conocen los locales',
    descriptionEn: 'Hidden corners and gems only locals know about',
    icon: '🗝️',
    color: '#6366F1'
  },
  {
    id: 'monumental',
    labelEs: 'Monumental',
    labelEn: 'Monumental',
    descriptionEs: 'Monumentos y edificios históricos emblemáticos',
    descriptionEn: 'Iconic monuments and historic buildings',
    icon: '🏛️',
    color: '#8B5CF6'
  },
  {
    id: 'historia_negra',
    labelEs: 'Historia Negra',
    labelEn: 'Dark History',
    descriptionEs: 'Ejecuciones, leyendas oscuras y misterios',
    descriptionEn: 'Executions, dark legends and mysteries',
    icon: '💀',
    color: '#374151'
  },
  {
    id: 'curiosidades',
    labelEs: 'Curiosidades',
    labelEn: 'Curiosities',
    descriptionEs: 'Datos sorprendentes y lugares insólitos',
    descriptionEn: 'Surprising facts and unusual places',
    icon: '🔍',
    color: '#0891B2'
  },
  {
    id: 'gastronomia',
    labelEs: 'Gastronomía',
    labelEn: 'Gastronomy',
    descriptionEs: 'Cultura culinaria, bares y mercados',
    descriptionEn: 'Culinary culture, bars and markets',
    icon: '🍷',
    color: '#DC2626'
  },
  {
    id: 'arquitectura',
    labelEs: 'Arquitectura',
    labelEn: 'Architecture',
    descriptionEs: 'Arquitectura notable de distintas épocas',
    descriptionEn: 'Remarkable architecture from different eras',
    icon: '🏗️',
    color: '#D97706'
  },
  {
    id: 'naturaleza',
    labelEs: 'Naturaleza',
    labelEn: 'Nature',
    descriptionEs: 'Parques, jardines y espacios naturales',
    descriptionEn: 'Parks, gardens and natural spaces',
    icon: '🌿',
    color: '#059669'
  }
]

export const DURATION_OPTIONS: Array<{ value: RouteDuration; labelEs: string; labelEn: string; shortLabel: string }> = [
  { value: 60, labelEs: '1 hora', labelEn: '1 hour', shortLabel: '1h' },
  { value: 120, labelEs: '2 horas', labelEn: '2 hours', shortLabel: '2h' },
  { value: 180, labelEs: '3 horas', labelEn: '3 hours', shortLabel: '3h' },
  { value: 240, labelEs: 'Medio día', labelEn: 'Half day', shortLabel: '4h' },
  { value: 480, labelEs: 'Día completo', labelEn: 'Full day', shortLabel: '8h' }
]
