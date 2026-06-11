import { useState, useEffect, useRef, useMemo } from 'react'
import { speak, stop as stopTTS, pause as pauseTTS, resume as resumeTTS, isSpeaking, setRate as setTTSRate, SPEED_OPTIONS, prepareTextForSpeech } from '../services/tts'
import { startKeepAlive, stopKeepAlive } from '../services/backgroundKeepAlive'
import * as neuralPlayer from '../services/audioPlayback'
import { synthesize, isNeuralActive, getProviderLabel } from '../services/neuralTTS'
import { useAppStore } from '../stores/appStore'
import type { POI } from '../types'

interface AudioPlayerProps {
  text: string
  poiName: string
  /** When provided, neural-path metadata uses the full POI (image, category)
   *  so iOS lock-screen / Control Centre shows the right poster + title. */
  poi?: POI
  autoPlay?: boolean
  onPlayStart?: () => void
  onPlayEnd?: () => void
}

export function AudioPlayer({ text, poiName, poi, autoPlay = false, onPlayStart, onPlayEnd }: AudioPlayerProps) {
  const { language, audioRate, setAudioRate, setAudioPlaying } = useAppStore()
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [providerLabel, setProviderLabel] = useState(() => getProviderLabel())
  const hasAutoPlayed = useRef(false)
  // Stable waveform bar heights — only regenerated when text changes to prevent flicker
  const waveHeights = useMemo(
    () => Array.from({ length: 20 }, () => Math.random() * 70 + 30),
    [text]
  )

  // Decide audio path: neural (MP3 + <audio>) survives iOS lock screen and
  // sounds like a real human. Web Speech is the offline fallback.
  const neuralPath = isNeuralActive()

  useEffect(() => {
    return () => {
      neuralPlayer.stop()
      stopTTS()
      stopKeepAlive().catch(() => {})
    }
  }, [])

  // Stop when text changes, reset auto-play flag
  useEffect(() => {
    neuralPlayer.stop()
    stopTTS()
    setPlaying(false)
    setPaused(false)
    setBuffering(false)
    hasAutoPlayed.current = false
    setProviderLabel(getProviderLabel())
  }, [text])

  async function playNeural() {
    if (!poi && !poiName) return
    setBuffering(true)
    onPlayStart?.()
    try {
      const blobs = await synthesize(text, language === 'es' ? 'es' : 'en', poi?.id || poiName)
      setBuffering(false)
      if (!blobs) {
        // Neural failed — fall back to Web Speech for this play.
        playWebSpeech()
        return
      }
      setPlaying(true); setPaused(false); setAudioPlaying(true)
      neuralPlayer.play(blobs, {
        rate: audioRate,
        poi,
        onEnd: () => {
          setPlaying(false); setPaused(false); setAudioPlaying(false); onPlayEnd?.()
        },
      })
    } catch (err) {
      console.warn('[AudioPlayer] neural failed:', err)
      setBuffering(false)
      playWebSpeech()
    }
  }

  function playWebSpeech() {
    setTTSRate(audioRate)
    const prepared = prepareTextForSpeech(text, language)
    speak(prepared, language === 'es' ? 'es-ES' : 'en-US', {
      onStart: () => { setPlaying(true); setPaused(false); setAudioPlaying(true); onPlayStart?.() },
      onEnd: () => { setPlaying(false); setPaused(false); setAudioPlaying(false); onPlayEnd?.() }
    })
  }

  // Auto-play when text is ready and autoPlay is true
  useEffect(() => {
    if (!autoPlay || !text || hasAutoPlayed.current) return
    hasAutoPlayed.current = true
    // Keep-alive (wake lock + silent audio) so navigation survives the lock
    // screen even on the non-neural path.
    startKeepAlive().catch(() => {})
    const timer = setTimeout(() => {
      if (neuralPath) playNeural()
      else playWebSpeech()
    }, neuralPath ? 100 : 900)
    return () => clearTimeout(timer)
  }, [text, autoPlay])

  function handlePlay() {
    // Start keep-alive + unlock the narration <audio> element synchronously
    // inside the user gesture — iOS only allows later (post-fetch) play()
    // calls on elements that have already played within a gesture.
    startKeepAlive().catch(() => {})
    neuralPlayer.unlock()

    if (paused) {
      if (neuralPath) neuralPlayer.resume()
      else resumeTTS()
      setPlaying(true); setPaused(false)
      return
    }
    hasAutoPlayed.current = true
    if (neuralPath) playNeural()
    else playWebSpeech()
  }

  function handlePause() {
    if (neuralPath && neuralPlayer.isPlaying()) {
      neuralPlayer.pause()
      setPlaying(false); setPaused(true)
      return
    }
    if (isSpeaking()) {
      pauseTTS()
      setPlaying(false); setPaused(true)
    }
  }

  function handleStop() {
    neuralPlayer.stop()
    stopTTS()
    setPlaying(false); setPaused(false); setAudioPlaying(false)
  }

  function handleRateChange(rate: number) {
    setAudioRate(rate)
    if (neuralPath) neuralPlayer.setRate(rate)
    else setTTSRate(rate)
    if (playing && !neuralPath) {
      // Web Speech can't change rate mid-utterance — restart.
      handleStop()
      setTimeout(() => handlePlay(), 100)
    }
  }

  return (
    <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <span className="text-xl">🎧</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-800 text-sm truncate">{poiName}</p>
          <p className="text-[11px] text-stone-400 truncate">{providerLabel}</p>
        </div>
      </div>

      {/* Waveform / buffering indicator */}
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
      {buffering && !playing && (
        <p className="text-xs text-orange-600 mb-3">
          {language === 'es' ? 'Generando voz neuronal…' : 'Synthesising neural voice…'}
        </p>
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
          disabled={buffering}
          className="flex-1 h-12 rounded-xl bg-orange-500 text-white flex items-center justify-center gap-2 shadow-md shadow-orange-200 active:scale-95 transition-transform font-semibold disabled:opacity-60"
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
