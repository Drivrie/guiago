import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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

      {/* Fullscreen lightbox — rendered via portal on document.body.
          Inside the page tree it inherited the transformed/overflow ancestors'
          stacking context, so `fixed` was clipped BEHIND the app content and
          could not be dismissed. The portal escapes all of that. */}
      {lightbox && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-black/95 flex items-center justify-center p-3"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            className="max-w-full max-h-[85vh] object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute right-4 w-11 h-11 bg-white/15 backdrop-blur-sm rounded-full text-white text-2xl leading-none flex items-center justify-center active:scale-90"
            style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
            aria-label="Cerrar"
          >×</button>
          <p className="absolute bottom-6 left-0 right-0 text-center text-white/50 text-xs">
            Toca fuera de la foto para cerrar
          </p>
        </div>,
        document.body
      )}
    </>
  )
}
