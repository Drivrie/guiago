import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { POI, Route } from '../types'

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

interface MapViewProps {
  pois: POI[]
  route?: Route | null
  currentPOIIndex?: number
  userLocation?: [number, number] | null
  onPOIClick?: (index: number) => void
  className?: string
  followUser?: boolean
  /** Optional geometry [lon, lat] pairs for the pre-route segment (user→first POI) */
  preRouteGeometry?: [number, number][]
}

export function MapView({
  pois,
  route,
  currentPOIIndex = 0,
  userLocation,
  onPOIClick,
  className = '',
  followUser = false,
  preRouteGeometry,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<L.Marker[]>([])
  const routeLineRef = useRef<L.Polyline | null>(null)
  const preRouteLineRef = useRef<L.Polyline | null>(null)
  const userMarkerRef = useRef<L.Marker | null>(null)

  // Track if user has manually panned (disables auto-follow until recenter pressed)
  const [userPanned, setUserPanned] = useState(false)
  const userPannedRef = useRef(false)

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
    }).addTo(map)

    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)

    // Detect manual pan → disable auto-follow
    map.on('dragstart', () => {
      userPannedRef.current = true
      setUserPanned(true)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update POI markers + route line
  useEffect(() => {
    const map = mapRef.current
    if (!map || pois.length === 0) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    pois.forEach((poi, idx) => {
      const isActive = idx === currentPOIIndex
      const isPast = idx < currentPOIIndex

      const icon = L.divIcon({
        html: `<div style="
          width:${isActive ? 36 : 28}px;height:${isActive ? 36 : 28}px;
          border-radius:50%;
          background:${isActive ? '#F97316' : isPast ? '#9CA3AF' : '#1C1917'};
          color:white;display:flex;align-items:center;justify-content:center;
          font-weight:bold;font-size:${isActive ? 14 : 12}px;
          border:${isActive ? '3px solid white' : '2px solid white'};
          box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:all 0.3s;
        ">${isPast ? '✓' : idx + 1}</div>`,
        className: '',
        iconSize: [isActive ? 36 : 28, isActive ? 36 : 28],
        iconAnchor: [isActive ? 18 : 14, isActive ? 18 : 14],
      })

      const marker = L.marker([poi.lat, poi.lon], { icon })
        .addTo(map)
        .bindPopup(`<b>${poi.name}</b><br><small>${poi.category}</small>`)

      marker.on('click', () => onPOIClick?.(idx))
      markersRef.current.push(marker)
    })

    // Main route line
    if (routeLineRef.current) { routeLineRef.current.remove(); routeLineRef.current = null }

    if (route?.segments && route.segments.length > 0) {
      const allCoords: [number, number][] = []
      for (const seg of route.segments) {
        if (seg.geometry) {
          allCoords.push(...seg.geometry.map(([lon, lat]) => [lat, lon] as [number, number]))
        }
      }
      if (allCoords.length > 0) {
        routeLineRef.current = L.polyline(allCoords, {
          color: '#1a73e8',
          weight: 5,
          opacity: 0.85,
        }).addTo(map)
      }
    } else if (pois.length > 1) {
      routeLineRef.current = L.polyline(pois.map(p => [p.lat, p.lon] as [number, number]), {
        color: '#1a73e8',
        weight: 4,
        opacity: 0.6,
        dashArray: '8,4',
      }).addTo(map)
    }

    // Fit map to show all POIs
    const bounds = L.latLngBounds(pois.map(p => [p.lat, p.lon]))
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 })
  }, [pois, route, currentPOIIndex, onPOIClick])

  // Pre-route segment line (user → first POI), shown in green dashed style
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (preRouteLineRef.current) { preRouteLineRef.current.remove(); preRouteLineRef.current = null }

    if (preRouteGeometry && preRouteGeometry.length >= 2) {
      const coords = preRouteGeometry.map(([lon, lat]) => [lat, lon] as [number, number])
      preRouteLineRef.current = L.polyline(coords, {
        color: '#22C55E',
        weight: 5,
        opacity: 0.9,
        dashArray: '10,6',
      }).addTo(map)
    }
  }, [preRouteGeometry])

  // Center on current POI when index changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || pois.length === 0) return
    const poi = pois[currentPOIIndex]
    if (poi && !userPannedRef.current) {
      map.setView([poi.lat, poi.lon], Math.max(map.getZoom(), 15), { animate: true })
    }
  }, [currentPOIIndex, pois])

  // User location dot + conditional auto-follow
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null }

    if (userLocation) {
      const icon = L.divIcon({
        html: `<div style="
          width:20px;height:20px;border-radius:50%;
          background:#3B82F6;border:3px solid white;
          box-shadow:0 0 0 4px rgba(59,130,246,0.3);
          animation:gpsPulse 2s ease-in-out infinite;
        "></div>
        <style>@keyframes gpsPulse{0%,100%{box-shadow:0 0 0 4px rgba(59,130,246,0.3)}50%{box-shadow:0 0 0 8px rgba(59,130,246,0.1)}}</style>`,
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      })
      userMarkerRef.current = L.marker(userLocation, { icon, zIndexOffset: 1000 }).addTo(map)

      // Auto-follow only when followUser=true AND user hasn't manually panned
      if (followUser && !userPannedRef.current) {
        map.setView(userLocation, Math.max(map.getZoom(), 16), { animate: true })
      }
    }
  }, [userLocation, followUser])

  function handleRecenter() {
    if (!userLocation || !mapRef.current) return
    userPannedRef.current = false
    setUserPanned(false)
    mapRef.current.setView(userLocation, Math.max(mapRef.current.getZoom(), 16), { animate: true })
  }

  return (
    <div className={`relative ${className}`} style={{ minHeight: 200 }}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Recenter button — only visible when user has manually panned away */}
      {followUser && userPanned && userLocation && (
        <button
          onClick={handleRecenter}
          className="absolute bottom-20 right-3 z-[500] w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.25)' }}
          title="Centrar en mi posición"
        >
          <svg className="w-6 h-6 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
            <circle cx="12" cy="12" r="8" strokeOpacity="0.4" />
          </svg>
        </button>
      )}
    </div>
  )
}
