import { useState } from 'react'
import { useAppStore } from '../stores/appStore'
import {
  getProvider, setProvider,
  getOpenAIKey, setOpenAIKey,
  getVoice, setVoice,
  POLLINATIONS_VOICES, OPENAI_VOICES,
  synthesize, getLastError,
  type NeuralProviderId,
} from '../services/neuralTTS'
import * as audioPlayback from '../services/audioPlayback'
import { speak, primeWebSpeech } from '../services/tts'

export function VoiceSettings() {
  const { language } = useAppStore()
  const es = language === 'es'
  const lang = es ? 'es' : 'en'

  const [provider, setLocalProvider] = useState<NeuralProviderId>(getProvider)
  const [voice, setLocalVoice] = useState(() => getVoice(lang))
  const [openaiKey, setOpenaiKeyLocal] = useState(() => getOpenAIKey())
  const [showKey, setShowKey] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const [errorDetail, setErrorDetail] = useState('')

  function applyProvider(p: NeuralProviderId) {
    setProvider(p)
    setLocalProvider(p)
    setVoice(lang, 'nova') // both neural providers share OpenAI-style voices
    setLocalVoice('nova')
  }

  function applyVoice(v: string) {
    setVoice(lang, v)
    setLocalVoice(v)
  }

  function applyKey() {
    setOpenAIKey(openaiKey)
  }

  async function preview() {
    setPreviewing(true)
    setPreviewError(false)
    setErrorDetail('')
    audioPlayback.stop()
    // BOTH unlocks must happen SYNCHRONOUSLY inside this tap. Without the
    // audio unlock iOS rejects the post-fetch <audio>.play(); without the
    // Web Speech prime, the system-voice fallback (which runs after `await
    // synthesize`) is also blocked because the gesture is lost — that left
    // the user with the amber warning and zero sound.
    audioPlayback.unlock()
    primeWebSpeech()
    const sample = es
      ? 'Hola, soy tu guía. Tienes delante uno de los lugares más fascinantes de la ciudad. Acompáñame.'
      : 'Hi, I\'m your guide. You\'re standing in front of one of the most fascinating places in the city. Come with me.'
    try {
      const blobs = await synthesize(sample, lang, `preview-${voice}`)
      if (blobs) {
        audioPlayback.play(blobs, { rate: 1.0, onEnd: () => setPreviewing(false) })
        return
      }
    } catch (err) {
      console.warn('[VoiceSettings] preview failed:', err)
      setErrorDetail(err instanceof Error ? err.message : String(err))
    }
    // Neural failed → make the failure AUDIBLE and VISIBLE.
    setPreviewError(true)
    setErrorDetail(prev => prev || getLastError())
    speak(sample, es ? 'es-ES' : 'en-US', { onEnd: () => setPreviewing(false) })
  }

  const voices = provider === 'openai' ? OPENAI_VOICES[lang] : POLLINATIONS_VOICES[lang]
  const needsKey = provider === 'openai' && !getOpenAIKey()

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 space-y-4">
      <div>
        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
          {es ? 'Voz del guía' : 'Guide voice'}
        </p>
        <p className="text-xs text-stone-500 mb-3">
          {es
            ? 'Una voz neuronal suena como un guía humano y NO se corta cuando bloqueas la pantalla (a diferencia de Siri).'
            : "A neural voice sounds like a human guide and DOESN'T cut off when you lock the screen (unlike Siri)."}
        </p>

        <div className="grid grid-cols-1 gap-2">
          {([
            { id: 'pollinations' as NeuralProviderId, name: es ? 'Neuronal gratis (recomendada)' : 'Neural free (recommended)', sub: es ? 'Sin cuenta, voces realistas, sobrevive a pantalla bloqueada' : 'No account, realistic voices, survives screen lock', badge: '✨' },
            { id: 'openai' as NeuralProviderId, name: es ? 'OpenAI · Premium' : 'OpenAI · Premium', sub: es ? 'Calidad cinematográfica · Requiere clave propia' : 'Cinematic quality · Bring your own key', badge: '🎙️' },
            { id: 'none' as NeuralProviderId, name: es ? 'Voz del sistema (Siri)' : 'System voice (Siri)', sub: es ? 'Sin red, pero se corta al bloquear el iPhone' : 'No network, but stops when you lock the iPhone', badge: '📱' },
          ]).map(opt => (
            <button
              key={opt.id}
              onClick={() => applyProvider(opt.id)}
              className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                provider === opt.id ? 'border-orange-500 bg-orange-50' : 'border-stone-200 bg-white'
              }`}
            >
              <span className="text-xl">{opt.badge}</span>
              <div className="flex-1 min-w-0">
                <p className={`font-bold text-sm ${provider === opt.id ? 'text-orange-700' : 'text-stone-800'}`}>{opt.name}</p>
                <p className="text-xs text-stone-500 mt-0.5">{opt.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {provider === 'openai' && (
        <div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
            {es ? 'Clave OpenAI' : 'OpenAI key'}
          </p>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={openaiKey}
              onChange={e => setOpenaiKeyLocal(e.target.value)}
              onBlur={applyKey}
              placeholder="sk-..."
              className="flex-1 bg-stone-50 rounded-xl px-3 py-2 text-sm border border-stone-200 font-mono"
            />
            <button
              onClick={() => setShowKey(s => !s)}
              className="px-3 rounded-xl bg-stone-100 text-stone-600 text-xs"
            >{showKey ? '🙈' : '👁️'}</button>
          </div>
          <p className="text-[11px] text-stone-400 mt-1">
            {es
              ? 'Coste estimado: ~$0.015 por POI (~300 palabras). Solo se usa para TTS, nunca se envía a otros servicios.'
              : 'Estimated cost: ~$0.015 per POI (~300 words). Used only for TTS, never sent elsewhere.'}
          </p>
        </div>
      )}

      {provider !== 'none' && !needsKey && (
        <div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
            {es ? 'Voz' : 'Voice'}
          </p>
          <select
            value={voice}
            onChange={e => applyVoice(e.target.value)}
            className="w-full bg-stone-50 rounded-xl px-3 py-2 text-sm border border-stone-200"
          >
            {voices.map(v => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
          <button
            onClick={preview}
            disabled={previewing}
            className="mt-3 w-full bg-orange-500 text-white font-bold py-2 rounded-xl active:scale-95 disabled:opacity-50"
          >
            {previewing ? (es ? 'Reproduciendo…' : 'Playing…') : (es ? '▶ Probar voz' : '▶ Preview voice')}
          </button>
          {previewError && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              <p>{es
                ? '⚠️ La voz neuronal no respondió — has oído la voz del sistema (Siri).'
                : '⚠️ The neural voice did not respond — you heard the system voice (Siri).'}</p>
              {errorDetail && (
                <p className="mt-1 font-mono text-[10px] text-amber-600 break-all">
                  {es ? 'Detalle: ' : 'Detail: '}{errorDetail}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
