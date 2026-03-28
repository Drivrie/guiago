import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { Button } from '../components/ui/Button'
import { validateApiKey } from '../services/ai'

export function SettingsPage() {
  const navigate = useNavigate()
  const {
    language, anthropicApiKey, setAnthropicApiKey,
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

        {/* ---- AI Section ---- */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🤖</span>
            <h2 className="font-black text-stone-900 text-lg">
              {es ? 'Guía con Inteligencia Artificial' : 'AI-Powered Guide'}
            </h2>
          </div>
          <p className="text-stone-500 text-sm mb-4 ml-8">
            {es
              ? 'Conecta tu clave de API de Claude (Anthropic) para obtener rutas de calidad profesional — como las de Civitatis o Walkative — con narraciones de audio únicas y personalizadas.'
              : 'Connect your Claude (Anthropic) API key to get professional-quality routes — like Civitatis or Walkative — with unique, personalized audio narrations.'}
          </p>

          {/* Benefits */}
          <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-4 mb-4 border border-orange-100">
            <p className="text-sm font-semibold text-orange-800 mb-2">
              {es ? '✨ Con IA activada obtienes:' : '✨ With AI enabled you get:'}
            </p>
            <ul className="text-sm text-orange-700 space-y-1">
              <li>• {es ? 'Rutas curadas como operadores turísticos profesionales' : 'Routes curated like professional tour operators'}</li>
              <li>• {es ? 'Narraciones de audio naturales y apasionadas' : 'Natural and passionate audio narrations'}</li>
              <li>• {es ? 'Historia y datos insider en cada parada' : 'History and insider facts at each stop'}</li>
              <li>• {es ? 'Rutas personalizadas excluyendo lo ya visitado' : 'Routes excluding places already visited'}</li>
            </ul>
          </div>

          {/* API Key input */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100">
            <label className="block text-sm font-semibold text-stone-700 mb-2">
              {es ? 'Clave API de Anthropic (Claude)' : 'Anthropic (Claude) API Key'}
            </label>
            <div className="relative mb-3">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={e => { setKeyInput(e.target.value); setValidationResult(null) }}
                placeholder="sk-ant-..."
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
              <p className="text-green-600 text-sm mb-3 flex items-center gap-1.5">
                <span>✅</span>
                {es ? 'Clave válida. ¡IA activada!' : 'Valid key. AI activated!'}
              </p>
            )}
            {validationResult === 'error' && (
              <p className="text-red-600 text-sm mb-3 flex items-center gap-1.5">
                <span>❌</span>
                {es ? 'Clave inválida o sin crédito disponible.' : 'Invalid key or no credits available.'}
              </p>
            )}
            {anthropicApiKey && validationResult === null && (
              <p className="text-green-600 text-sm mb-3 flex items-center gap-1.5">
                <span>🤖</span>
                {es ? 'IA actualmente activada' : 'AI currently active'}
              </p>
            )}

            <div className="flex gap-2">
              <Button fullWidth onClick={handleSaveKey} loading={validating}>
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

            <p className="text-stone-400 text-xs mt-3">
              {es
                ? '🔒 Tu clave se guarda solo en tu dispositivo. Obtén una clave gratuita en console.anthropic.com'
                : '🔒 Your key is stored only on your device. Get a free key at console.anthropic.com'}
            </p>
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
              Powered by Wikipedia · OpenStreetMap · Claude AI
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
