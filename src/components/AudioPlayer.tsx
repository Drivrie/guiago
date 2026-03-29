import { useState, useEffect, useRef, useMemo } from 'react'
import { speak, stop, pause, resume, isSpeaking, isPaused, setRate, SPEED_OPTIONS, prepareTextForSpeech } from '../services/tts'
import { useAppStore } from '../stores/appStore'

interface AudioPlayerProps {
  text: string
  poiName: string
  autoPlay?: boolean
  onPlayStart?: () => void
  onPlayEnd?: () => void
}

export function AudioPlayer({ text, poiName, autoPlay = false, onPlayStart, onPlayEnd }: AudioPlayerProps) {
  const { language, audioRate, setAudioRate, setAudioPlaying } = useAppStore()
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [supported] = useState(() => 'speechSynthesis' in window)
  const hasAutoPlayed = useRef(false)
  // Stable waveform bar heights — only regenerated when text changes to prevent flicker
  const waveHeights = useMemo(
    () => Array.from({ length: 20 }, () => Math.random() * 70 + 30),
    [text]
  )

  useEffect(() => {
    return () => {
      stop()
      // Clear MediaSession on unmount
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null
      }
    }
  }, [])

  // MediaSession API — lock screen controls on iOS/Android
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: poiName,
      artist: language === 'es' ? 'GuiAgo · Guía turístico' : 'GuiAgo · Tour guide',
      album: language === 'es' ? 'Guía de audio' : 'Audio guide',
    })
    navigator.mediaSession.setActionHandler('play', () => handlePlay())
    navigator.mediaSession.setActionHandler('pause', () => handlePause())
    navigator.mediaSession.setActionHandler('stop', () => handleStop())
  }, [poiName, language, text])

  // Stop when text changes, reset auto-play flag
  useEffect(() => {
    stop()
    setPlaying(false)
    setPaused(false)
    hasAutoPlayed.current = false
  }, [text])

  // Auto-play when text is ready and autoPlay is true
  useEffect(() => {
    if (!autoPlay || !text || !supported || hasAutoPlayed.current) return
    hasAutoPlayed.current = true
    // Small delay to let voices load on iOS
    const timer = setTimeout(() => {
      setRate(audioRate)
      const prepared = prepareTextForSpeech(text, language)
      speak(prepared, language === 'es' ? 'es-ES' : 'en-US', {
        onStart: () => { setPlaying(true); setPaused(false); setAudioPlaying(true); onPlayStart?.() },
        onEnd: () => { setPlaying(false); setPaused(false); setAudioPlaying(false); onPlayEnd?.() }
      })
    }, 900)
    return () => clearTimeout(timer)
  }, [text, autoPlay, supported])

  function handlePlay() {
    if (!supported) return

    if (paused) {
      resume()
      setPlaying(true)
      setPaused(false)
      return
    }

    hasAutoPlayed.current = true // prevent double auto-play if user manually presses play
    setRate(audioRate)
    const prepared = prepareTextForSpeech(text, language)
    speak(prepared, language === 'es' ? 'es-ES' : 'en-US', {
      onStart: () => { setPlaying(true); setPaused(false); setAudioPlaying(true); onPlayStart?.() },
      onEnd: () => { setPlaying(false); setPaused(false); setAudioPlaying(false); onPlayEnd?.() }
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
          {waveHeights.map((h, i) => (
            <div
              key={i}
              className="flex-1 bg-orange-400 rounded-full animate-pulse"
              style={{
                height: `${h}%`,
                animationDelay: `${i * 0.05}s`,
                animationDuration: `${0.6 + (i % 3) * 0.15}s`,
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
