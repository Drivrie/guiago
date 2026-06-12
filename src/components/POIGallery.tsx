import { useEffect, useState } from 'react'
import { fetchNearbyImages, type CommonsImage } from '../services/commons'

interface Props {
  lat: number
  lon: number
  /** Wikipedia thumbnail already shown in the header — excluded from the strip. */
  excludeUrl?: string
}

/**
 * Horizontal photo strip for a POI, sourced from Wikimedia Commons photos
 * geotagged at the spot. Helps the visitor confirm they're at the right
 * place and see angles/interiors they might otherwise miss. Renders nothing
 * when no extra photos exist — zero layout cost for undocumented places.
 */
export function POIGallery({ lat, lon, excludeUrl }: Props) {
  const [images, setImages] = useState<CommonsImage[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setImages([])
    fetchNearbyImages(lat, lon).then(imgs => {
      if (cancelled) return
      setImages(excludeUrl ? imgs.filter(i => i.thumbUrl !== excludeUrl && i.url !== excludeUrl) : imgs)
    })
    return () => { cancelled = true }
  }, [lat, lon])

  if (images.length === 0) return null

  return (
    <>
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-2">
        {images.map(img => (
          <button
            key={img.url}
            onClick={() => setLightbox(img.thumbUrl)}
            className="flex-shrink-0 w-24 h-20 rounded-xl overflow-hidden bg-stone-200 active:scale-95 transition-transform"
          >
            <img src={img.thumbUrl} alt={img.title} className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>

      {/* Fullscreen lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center p-2"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-safe-top right-4 mt-4 w-10 h-10 bg-white/10 rounded-full text-white text-xl">×</button>
        </div>
      )}
    </>
  )
}
