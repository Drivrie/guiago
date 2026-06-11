import { useState } from 'react'
import { useAppStore } from '../stores/appStore'

const DISMISS_KEY = 'guiago-ios-install-dismissed'

function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * One-time hint shown to iOS Safari users explaining how to install GuiAgo
 * on the home screen. iOS has no `beforeinstallprompt` event, so the only
 * path to a full-screen, app-like experience is the manual Share → Add to
 * Home Screen flow — most users don't know it exists.
 */
export function IOSInstallHint() {
  const { language } = useAppStore()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (dismissed || !isIOS() || isStandalone()) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="mb-4 bg-stone-900 rounded-2xl p-4 flex items-start gap-3 text-white">
      <span className="text-2xl flex-shrink-0">📲</span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">
          {language === 'es' ? 'Instala GuiAgo en tu iPhone' : 'Install GuiAgo on your iPhone'}
        </p>
        <p className="text-stone-300 text-xs mt-1 leading-relaxed">
          {language === 'es'
            ? <>Pulsa <span className="inline-block px-1 bg-stone-700 rounded">Compartir ⎋</span> y luego <strong>«Añadir a pantalla de inicio»</strong>. Tendrás GuiAgo a pantalla completa, con su icono, como una app más.</>
            : <>Tap <span className="inline-block px-1 bg-stone-700 rounded">Share ⎋</span> then <strong>“Add to Home Screen”</strong>. You'll get GuiAgo full-screen, with its own icon, like a native app.</>}
        </p>
      </div>
      <button onClick={dismiss} className="text-stone-400 text-lg leading-none flex-shrink-0 p-1">×</button>
    </div>
  )
}
