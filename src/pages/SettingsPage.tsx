import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { Button } from '../components/ui/Button'
import { validateApiKey, hasBuiltInKey, activeEngine } from '../services/ai'

export function SettingsPage() {
  const navigate = useNavigate()
  const {
    language, setLanguage, anthropicApiKey, setAnthropicApiKey,
    visitedPOIs, clearVisitHistory
  } = useAppStore()

  const [keyInput, setKeyInput] = useState(anthropicApiKey)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<'ok' | 'error' | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)

  const totalVisited = Object.values(visitedPOIs).reduce((acc, arr) => acc + arr.length, 0)
  const citiesVisited = Object.keys(visitedPOIs).length

  async function handleSaveKey() {
    const key = keyInput.trim()
    if (!key) {
      setAnthropicApiKey('')
      setValidationResult(null)
      return
    }
    setValidating(true)
    setValidationResult(null)
    const ok = await validateApiKey(key)
    if (ok) {
      setAnthropicApiKey(key)
      setValidationResult('ok')
    } else {
      setValidationResult('error')
    }
    setValidating(false)
  }

  const es = language === 'es'
  const engine = activeEngine(anthropicApiKey)

  return (
    <div className="min-h-screen bg-stone-50 safe-top">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-stone-100">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 bg-stone-100 rounded-xl flex items-center justify-center text-stone-600"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="font-black text-stone-900 text-xl">
          {es ? 'Configuración' : 'Settings'}
        </h1>
      </div>

      <div className="px-4 py-6 flex flex-col gap-6 pb-20">

        {/* ---- Language Section ---- */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🌍</span>
            <h2 className="font-black text-stone-900 text-lg">
              {es ? 'Idioma' : 'Language'}
            </h2>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setLanguage('es')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all active:scale-95 ${
                language === 'es'
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                  : 'bg-white text-stone-600 border border-stone-200'
              }`}
            >
              🇪🇸 Español
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all active:scale-95 ${
                language === 'en'
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                  : 'bg-white text-stone-600 border border-stone-200'
              }`}
            >
              🇬🇧 English
            </button>
          </div>
        </section>

        {/* ---- AI Section ---- */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🤖</span>
            <h2 className="font-black text-stone-900 text-lg">
              {es ? 'Inteligencia Artificial' : 'AI Guide'}
            </h2>
          </div>

          {/* Active AI engine badge */}
          <div className={`rounded-2xl p-4 mb-4 border ${
            engine === 'mistral_user' ? 'bg-gradient-to-br from-purple-50 to-indigo-50 border-purple-200' :
            engine === 'mistral_builtin' ? 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200' :
            'bg-gradient-to-br from-green-50 to-emerald-50 border-green-100'
          }`}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">
                {engine === 'mistral_user' ? '🟣' : engine === 'mistral_builtin' ? '🔵' : '✅'}
              </span>
              <p className={`font-bold text-sm ${
                engine === 'mistral_user' ? 'text-purple-800' :
                engine === 'mistral_builtin' ? 'text-blue-800' :
                'text-green-800'
              }`}>
                {engine === 'mistral_user'
                  ? (es ? 'Usando tu clave Mistral AI' : 'Using your Mistral AI key')
                  : engine === 'mistral_builtin'
                  ? (es ? 'Usando Mistral AI integrado' : 'Using built-in Mistral AI')
                  : (es ? 'IA gratuita activa — sin configurar nada' : 'Free AI active — no setup needed')}
              </p>
            </div>
            <ul className={`text-sm space-y-1 ml-9 ${
              engine === 'mistral_user' ? 'text-purple-700' :
              engine === 'mistral_builtin' ? 'text-blue-700' :
              'text-green-700'
            }`}>
              <li>• {es ? 'Rutas curadas estilo Civitatis · narraciones apasionadas' : 'Civitatis-style curated routes · passionate narrations'}</li>
              <li>• {engine === 'pollinations'
                ? (es ? 'Motor: Pollinations.ai (GPT-4o-mini gratuito, sin cuenta)' : 'Engine: Pollinations.ai (free GPT-4o-mini, no account)')
                : (es ? 'Motor: Mistral AI open-mistral-nemo · máxima fiabilidad' : 'Engine: Mistral AI open-mistral-nemo · maximum reliability')
              }</li>
            </ul>
          </div>

          {/* Built-in key info if env key active */}
          {hasBuiltInKey() && engine !== 'mistral_user' && (
            <div className="bg-blue-50 rounded-2xl px-4 py-3 mb-4 border border-blue-100">
              <p className="text-blue-700 text-xs">
                {es
                  ? '🔒 Clave Mistral integrada por el desarrollador. No necesitas añadir la tuya.'
                  : '🔒 Mistral key built-in by the developer. No need to add your own.'}
              </p>
            </div>
          )}

          {/* Optional Mistral key upgrade */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100">
            <p className="text-sm font-semibold text-stone-700 mb-1">
              {es ? '⚡ Mejora opcional: clave Mistral AI' : '⚡ Optional upgrade: Mistral AI key'}
            </p>
            <p className="text-stone-400 text-xs mb-3">
              {es
                ? 'Si tienes cuenta gratuita en console.mistral.ai, añade tu clave para mayor fiabilidad y límites más altos.'
                : 'If you have a free account at console.mistral.ai, add your key for better reliability and higher limits.'}
            </p>
            <div className="relative mb-3">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={e => { setKeyInput(e.target.value); setValidationResult(null) }}
                placeholder={es ? 'Tu clave Mistral (opcional)...' : 'Your Mistral key (optional)...'}
                className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-mono pr-10 focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400"
              >
                {showKey ? '🙈' : '👁️'}
              </button>
            </div>

            {validationResult === 'ok' && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-2">
                <span>✅</span>
                <div>
                  <p className="text-green-700 text-sm font-semibold">
                    {es ? '¡Clave Mistral guardada y activa!' : 'Mistral key saved and active!'}
                  </p>
                  <p className="text-green-600 text-xs">
                    {es ? 'La app usará Mistral AI para todas las rutas y narraciones.' : 'The app will use Mistral AI for all routes and narrations.'}
                  </p>
                </div>
              </div>
            )}
            {validationResult === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-2">
                <span>❌</span>
                <div>
                  <p className="text-red-700 text-sm font-semibold">
                    {es ? 'Clave inválida o sin conexión' : 'Invalid key or no connection'}
                  </p>
                  <p className="text-red-600 text-xs">
                    {es ? 'Verifica la clave en console.mistral.ai' : 'Check your key at console.mistral.ai'}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button fullWidth onClick={handleSaveKey} loading={validating} variant="secondary">
                {es ? 'Guardar y verificar' : 'Save & verify'}
              </Button>
              {anthropicApiKey && (
                <Button
                  variant="ghost"
                  onClick={() => { setKeyInput(''); setAnthropicApiKey(''); setValidationResult(null) }}
                >
                  {es ? 'Borrar' : 'Clear'}
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* ---- Visit History Section ---- */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">📍</span>
            <h2 className="font-black text-stone-900 text-lg">
              {es ? 'Historial de visitas' : 'Visit history'}
            </h2>
          </div>
          <p className="text-stone-500 text-sm mb-4 ml-8">
            {es
              ? 'GuiAgo recuerda los lugares que has visitado para proponerte siempre rutas nuevas con sitios que aún no has visto.'
              : 'GuiAgo remembers places you\'ve visited to always suggest new routes with places you haven\'t seen yet.'}
          </p>

          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100">
            {totalVisited > 0 ? (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1">
                    <p className="font-bold text-stone-800">
                      {totalVisited} {es ? 'lugares visitados' : 'places visited'}
                    </p>
                    <p className="text-stone-400 text-sm">
                      {es ? `en ${citiesVisited} ${citiesVisited === 1 ? 'ciudad' : 'ciudades'}` : `in ${citiesVisited} ${citiesVisited === 1 ? 'city' : 'cities'}`}
                    </p>
                  </div>
                  <span className="text-3xl">🗺️</span>
                </div>

                {/* Per-city breakdown */}
                <div className="flex flex-col gap-2 mb-4">
                  {Object.entries(visitedPOIs).map(([cityId, names]) => (
                    <div key={cityId} className="flex items-center justify-between py-2 border-t border-stone-100">
                      <div>
                        <p className="font-semibold text-stone-700 text-sm capitalize">{cityId}</p>
                        <p className="text-stone-400 text-xs">{names.length} {es ? 'lugares' : 'places'}</p>
                      </div>
                      <button
                        onClick={() => clearVisitHistory(cityId)}
                        className="text-red-400 text-xs px-2 py-1 rounded-lg hover:bg-red-50"
                      >
                        {es ? 'Limpiar' : 'Clear'}
                      </button>
                    </div>
                  ))}
                </div>

                {clearConfirm ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { clearVisitHistory(); setClearConfirm(false) }}
                      className="flex-1 py-2.5 bg-red-500 text-white text-sm font-semibold rounded-xl"
                    >
                      {es ? 'Sí, borrar todo' : 'Yes, clear all'}
                    </button>
                    <button
                      onClick={() => setClearConfirm(false)}
                      className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-semibold rounded-xl"
                    >
                      {es ? 'Cancelar' : 'Cancel'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setClearConfirm(true)}
                    className="w-full py-2.5 bg-red-50 text-red-600 text-sm font-semibold rounded-xl border border-red-100"
                  >
                    {es ? '🗑️ Borrar todo el historial' : '🗑️ Clear all history'}
                  </button>
                )}
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-stone-400 text-sm">
                  {es
                    ? 'Aún no has completado ninguna ruta. Completa tu primera ruta para empezar a guardar tu historial.'
                    : "You haven't completed any routes yet. Complete your first route to start saving your history."}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ---- About Section ---- */}
        <section>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 text-center">
            <p className="text-2xl mb-2">🗺️</p>
            <p className="font-bold text-stone-800">GuiAgo</p>
            <p className="text-stone-400 text-xs mt-1">
              {es ? 'Tu guía turístico inteligente' : 'Your intelligent tourist guide'}
            </p>
            <p className="text-stone-300 text-xs mt-2">
              Powered by Wikipedia · OpenStreetMap · Pollinations.ai
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
