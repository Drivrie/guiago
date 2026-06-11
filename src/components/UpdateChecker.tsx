import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { APP_VERSION, formatBuildDate, fetchLatestVersion, forceUpdate } from '../services/appVersion'

type Status = 'idle' | 'checking' | 'up-to-date' | 'available' | 'updating' | 'error'

/**
 * Self-contained "what version am I running / is there a newer one" panel.
 * Designed for the Settings page but works anywhere — also runs a silent
 * background check on mount so a user who simply opens Settings sees a
 * "newer version available" banner without tapping anything.
 */
export function UpdateChecker({ compact = false }: { compact?: boolean }) {
  const { language } = useAppStore()
  const es = language === 'es'
  const [status, setStatus] = useState<Status>('idle')
  const [latest, setLatest] = useState<string | null>(null)

  async function check() {
    setStatus('checking')
    const v = await fetchLatestVersion()
    if (v === null) { setStatus('error'); return }
    setLatest(v)
    setStatus(v === APP_VERSION ? 'up-to-date' : 'available')
  }

  // Silent check on mount (don't surface errors).
  useEffect(() => {
    fetchLatestVersion().then(v => {
      if (!v) return
      setLatest(v)
      if (v !== APP_VERSION) setStatus('available')
    })
  }, [])

  async function applyUpdate() {
    setStatus('updating')
    await forceUpdate()
  }

  const buildDate = formatBuildDate(es ? 'es' : 'en')

  if (compact) {
    return (
      <button
        onClick={check}
        className="text-stone-400 text-[11px] underline-offset-2 hover:underline active:opacity-70"
        title={es ? 'Pulsa para comprobar actualizaciones' : 'Tap to check for updates'}
      >
        v{APP_VERSION}{buildDate ? ` · ${buildDate}` : ''}
        {status === 'available' && <span className="ml-1 text-orange-500 font-bold">●</span>}
      </button>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100">
      <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
        {es ? 'Versión instalada' : 'Installed version'}
      </p>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm text-stone-700">v{APP_VERSION}</p>
          {buildDate && <p className="text-xs text-stone-400 mt-0.5">{buildDate}</p>}
        </div>
        <button
          onClick={check}
          disabled={status === 'checking' || status === 'updating'}
          className="text-sm font-semibold px-3 py-2 rounded-xl bg-stone-100 text-stone-700 active:scale-95 disabled:opacity-50"
        >
          {status === 'checking'
            ? (es ? 'Comprobando…' : 'Checking…')
            : (es ? 'Buscar actualizaciones' : 'Check for updates')}
        </button>
      </div>

      {status === 'up-to-date' && (
        <p className="mt-3 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
          ✅ {es ? 'Tienes la última versión.' : 'You have the latest version.'}
        </p>
      )}

      {status === 'available' && latest && (
        <div className="mt-3 bg-orange-50 rounded-xl px-3 py-3 border border-orange-100">
          <p className="text-sm text-orange-800 font-semibold">
            ✨ {es ? 'Nueva versión disponible' : 'New version available'}
          </p>
          <p className="text-xs text-orange-700 mt-1">
            {es ? 'Servidor en' : 'Server at'} <span className="font-mono">v{latest}</span>.
            {' '}
            {es
              ? 'Actualiza para tener las últimas mejoras de rutas y narraciones.'
              : 'Update to get the latest route and narration improvements.'}
          </p>
          <button
            onClick={applyUpdate}
            disabled={status !== 'available'}
            className="mt-3 w-full bg-orange-500 text-white font-bold py-2 rounded-xl active:scale-95 disabled:opacity-50"
          >
            {es ? 'Actualizar ahora' : 'Update now'}
          </button>
        </div>
      )}

      {status === 'error' && (
        <p className="mt-3 text-sm text-stone-500">
          {es ? 'No se pudo comprobar. ¿Estás sin conexión?' : 'Could not check. Are you offline?'}
        </p>
      )}
    </div>
  )
}
