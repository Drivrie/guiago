import { useEffect, useRef } from 'react'
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
}

export function MapView({ pois, route, currentPOIIndex = 0, userLocation, onPOIClick, className = '', followUser = false }: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<L.Marker[]>([])
  const routeLineRef = useRef<L.Polyline | null>(null)
  const userMarkerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
    }).addTo(map)

    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update POI markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || pois.length === 0) return

    // Clear existing markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    pois.forEach((poi, idx) => {
      const isActive = idx === currentPOIIndex
      const isPast = idx < currentPOIIndex

      const icon = L.divIcon({
        html: `<div style="
          width: ${isActive ? 36 : 28}px;
          height: ${isActive ? 36 : 28}px;
          border-radius: 50%;
          background: ${isActive ? '#F97316' : isPast ? '#9CA3AF' : '#1C1917'};
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: ${isActive ? 14 : 12}px;
          border: ${isActive ? '3px solid white' : '2px solid white'};
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          transition: all 0.3s;
        ">${idx + 1}</div>`,
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

    // Draw route line between POIs
    if (routeLineRef.current) {
      routeLineRef.current.remove()
      routeLineRef.current = null
    }

    if (route?.segments && route.segments.length > 0) {
      const allCoords: [number, number][] = []
      for (const seg of route.segments) {
        if (seg.geometry) {
          // OSRM geometry is [lon, lat] pairs
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
      // Simple straight lines if no route
      const coords: [number, number][] = pois.map(p => [p.lat, p.lon])
      routeLineRef.current = L.polyline(coords, {
        color: '#1a73e8',
        weight: 4,
        opacity: 0.6,
        dashArray: '8,4'
      }).addTo(map)
    }

    // Fit map to POIs
    const bounds = L.latLngBounds(pois.map(p => [p.lat, p.lon]))
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 })
  }, [pois, route, currentPOIIndex, onPOIClick])

  // Center on current POI
  useEffect(() => {
    const map = mapRef.current
    if (!map || pois.length === 0) return
    const poi = pois[currentPOIIndex]
    if (poi) {
      map.setView([poi.lat, poi.lon], Math.max(map.getZoom(), 15), { animate: true })
    }
  }, [currentPOIIndex, pois])

  // User location marker + auto-follow
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (userMarkerRef.current) {
      userMarkerRef.current.remove()
      userMarkerRef.current = null
    }

    if (userLocation) {
      // Pulsing blue dot (Google Maps style)
      const icon = L.divIcon({
        html: `<div style="
          width:20px;height:20px;border-radius:50%;
          background:#3B82F6;
          border:3px solid white;
          box-shadow:0 0 0 4px rgba(59,130,246,0.3);
          animation:pulse 2s ease-in-out infinite;
        "></div>
        <style>@keyframes pulse{0%,100%{box-shadow:0 0 0 4px rgba(59,130,246,0.3)}50%{box-shadow:0 0 0 8px rgba(59,130,246,0.1)}}</style>`,
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      })
      userMarkerRef.current = L.marker(userLocation, { icon, zIndexOffset: 1000 }).addTo(map)

      // Auto-follow user when followUser=true
      if (followUser) {
        map.setView(userLocation, Math.max(map.getZoom(), 16), { animate: true })
      }
    }
  }, [userLocation, followUser])

  return (
    <div
      ref={containerRef}
      className={`w-full ${className}`}
      style={{ minHeight: 200 }}
    />
  )
}
