import React, { useEffect } from 'react'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  snapPoints?: ('half' | 'full')
}

export function BottomSheet({ isOpen, onClose, title, children, snapPoints = 'half' }: BottomSheetProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  const heightClass = snapPoints === 'full' ? 'h-[92vh]' : 'max-h-[60vh]'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[9000]" onClick={onClose} />
      <div className={`fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-[9001] ${heightClass} flex flex-col safe-bottom`}>
        <div className="flex flex-col items-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-stone-200 rounded-full" />
          {title && <h2 className="text-lg font-bold text-stone-800 mt-3 mb-1 px-4">{title}</h2>}
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
          {children}
        </div>
      </div>
    </>
  )
}
