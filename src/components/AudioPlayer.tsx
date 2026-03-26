import { useState, useEffect } from 'react'
import { speak, stop, pause, resume, isSpeaking, isPaused, setRate, getRate, SPEED_OPTIONS, prepareTextForSpeech } from '../services/tts'
import { useAppStore } from '../stores/appStore'

interface AudioPlayerProps {
  text: string
  poiName: string
  onPlayStart?: () => void
  onPlayEnd?: () => void
}

export function AudioPlayer({ text, poiName, onPlayStart, onPlayEnd }: AudioPlayerProps) {
  const { language, audioRate, setAudioRate, setAudioPlaying } = useAppStore()
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [supported] = useState(() => 'speechSynthesis' in window)

  useEffect(() => {
    return () => { stop() }
  }, [])

  // Stop when text changes
  useEffect(() => {
    stop()
    setPlaying(false)
    setPaused(false)
  }, [text])

  function handlePlay() {
    if (!supported) return

    if (paused) {
      resume()
      setPlaying(true)
      setPaused(false)
      return
    }

    setRate(audioRate)
    const prepared = prepareTextForSpeech(text, language)
    speak(prepared, language === 'es' ? 'es-ES' : 'en-US', {
      onStart: () => {
        setPlaying(true)
        setPaused(false)
        setAudioPlaying(true)
        onPlayStart?.()
      },
      onEnd: () => {
        setPlaying(false)
        setPaused(false)
        setAudioPlaying(false)
        onPlayEnd?.()
      }
    })
  }

  function handlePause() {
    if (isSpeaking()) {
      pause()
      setPlaying(false)
      setPaused(true)
    }
  }

  function handleStop() {
    stop()
    setPlaying(false)
    setPaused(false)
    setAudioPlaying(false)
  }

  function handleRateChange(rate: number) {
    setAudioRate(rate)
    setRate(rate)
    if (playing) {
      handleStop()
      setTimeout(() => handlePlay(), 100)
    }
  }

  if (!supported) {
    return (
      <div className="bg-amber-50 rounded-2xl p-4 text-center">
        <p className="text-amber-700 text-sm">
          {language === 'es' ? 'Audio no disponible en este navegador' : 'Audio not available in this browser'}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <span className="text-xl">🎧</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-800 text-sm truncate">{poiName}</p>
          <p className="text-xs text-stone-400">
            {language === 'es' ? 'Guía de audio' : 'Audio guide'}
          </p>
        </div>
      </div>

      {/* Waveform animation when playing */}
      {playing && (
        <div className="flex items-center gap-0.5 mb-3 h-6">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="flex-1 bg-orange-400 rounded-full animate-pulse"
              style={{
                height: `${Math.random() * 70 + 30}%`,
                animationDelay: `${i * 0.05}s`,
                animationDuration: `${0.5 + Math.random() * 0.5}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleStop}
          disabled={!playing && !paused}
          className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm disabled:opacity-30 active:scale-95 transition-transform"
        >
          <svg className="w-4 h-4 text-stone-600" fill="currentColor" viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>

        <button
          onClick={playing ? handlePause : handlePlay}
          className="flex-1 h-12 rounded-xl bg-orange-500 text-white flex items-center justify-center gap-2 shadow-md shadow-orange-200 active:scale-95 transition-transform font-semibold"
        >
          {playing ? (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
              {language === 'es' ? 'Pausar' : 'Pause'}
            </>
          ) : paused ? (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {language === 'es' ? 'Continuar' : 'Resume'}
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {language === 'es' ? 'Escuchar' : 'Listen'}
            </>
          )}
        </button>
      </div>

      {/* Speed control */}
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-stone-400">{language === 'es' ? 'Velocidad:' : 'Speed:'}</span>
        <div className="flex gap-1">
          {SPEED_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleRateChange(opt.value)}
              className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                audioRate === opt.value
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-stone-500 hover:bg-stone-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
