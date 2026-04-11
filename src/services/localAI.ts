/**
 * Offline AI engine using @huggingface/transformers (Transformers.js).
 *
 * How it works:
 * - The model files (ONNX format) are downloaded from HuggingFace the first time.
 * - They are cached automatically in the browser's Cache Storage.
 * - All subsequent runs — including offline — use the cached files.
 * - Inference runs in WebGPU (if available) or WASM, entirely on-device.
 *
 * Supported models (balanced quality/size for mobile tour guide use):
 *   SmolLM2 1.7B  — HuggingFace · ~900MB · any device
 *   Qwen2.5 1.5B  — Alibaba Cloud · ~750MB · any device
 *   Gemma 3 1B    — Google (like AI Edge Gallery) · ~600MB · any device
 */

import type { Language } from '../types'
import type { AIRouteResult } from './ai'

// ─── Model registry ──────────────────────────────────────────────────────────

export type LocalModelId = 'smollm2-1.7b' | 'qwen25-1.5b' | 'gemma3-1b'

export interface LocalModelInfo {
  id: LocalModelId
  /** HuggingFace repo identifier used by Transformers.js */
  hfRepo: string
  name: string
  provider: string
  description_es: string
  description_en: string
  /** Approximate download size in GB */
  sizeGB: number
  /** ONNX quantization precision */
  dtype: 'q4' | 'q8'
  recommended: boolean
}

export const LOCAL_MODELS: LocalModelInfo[] = [
  {
    id: 'smollm2-1.7b',
    hfRepo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    name: 'SmolLM2 1.7B',
    provider: 'HuggingFace',
    description_es:
      'Modelo compacto y rápido. ~900 MB. Funciona en cualquier dispositivo vía WASM, sin necesitar WebGPU. Recomendado para la mayoría de usuarios.',
    description_en:
      'Compact and fast model. ~900 MB. Works on any device via WASM, no WebGPU required. Recommended for most users.',
    sizeGB: 0.9,
    dtype: 'q4',
    recommended: true,
  },
  {
    id: 'qwen25-1.5b',
    hfRepo: 'onnx-community/Qwen2.5-1.5B-Instruct',
    name: 'Qwen2.5 1.5B',
    provider: 'Alibaba Cloud',
    description_es:
      'Modelo de Alibaba Cloud, excelente en múltiples idiomas. ~750 MB. Ideal para rutas en ciudades de Asia, Europa del Este u otros idiomas no latinos.',
    description_en:
      'Alibaba Cloud model with excellent multilingual support. ~750 MB. Ideal for routes in Asian, Eastern European or non-Latin cities.',
    sizeGB: 0.75,
    dtype: 'q4',
    recommended: false,
  },
  {
    id: 'gemma3-1b',
    hfRepo: 'onnx-community/gemma-3-1b-it',
    name: 'Gemma 3 1B',
    provider: 'Google',
    description_es:
      'Modelo de Google, similar a los usados en Google AI Edge Gallery. ~600 MB. El más ligero y rápido; buena calidad para guiado turístico.',
    description_en:
      "Google's model, similar to Google AI Edge Gallery. ~600 MB. Lightest and fastest option; good quality for tourist guidance.",
    sizeGB: 0.6,
    dtype: 'q4',
    recommended: false,
  },
]

// ─── Persistent state (localStorage) ─────────────────────────────────────────

const ACTIVE_MODEL_KEY = 'guiago_local_ai_active'
const CACHED_MODELS_KEY = 'guiago_local_ai_cached'

export function getActiveLocalModel(): LocalModelId | null {
  return (localStorage.getItem(ACTIVE_MODEL_KEY) as LocalModelId) || null
}

export function setActiveLocalModel(id: LocalModelId | null): void {
  if (id) localStorage.setItem(ACTIVE_MODEL_KEY, id)
  else localStorage.removeItem(ACTIVE_MODEL_KEY)
}

export function isModelCached(id: LocalModelId): boolean {
  try {
    const arr: LocalModelId[] = JSON.parse(localStorage.getItem(CACHED_MODELS_KEY) || '[]')
    return arr.includes(id)
  } catch { return false }
}

function markModelCached(id: LocalModelId, cached: boolean): void {
  try {
    let arr: LocalModelId[] = JSON.parse(localStorage.getItem(CACHED_MODELS_KEY) || '[]')
    if (cached) {
      if (!arr.includes(id)) arr = [...arr, id]
    } else {
      arr = arr.filter(m => m !== id)
    }
    localStorage.setItem(CACHED_MODELS_KEY, JSON.stringify(arr))
  } catch { /* ignore */ }
}

// ─── Runtime state ────────────────────────────────────────────────────────────

export function isWebGPUAvailable(): boolean {
  return 'gpu' in navigator
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipeline: any = null
let _loadedModelId: LocalModelId | null = null
let _loadingPromise: Promise<void> | null = null

export function isLocalModelLoaded(): boolean {
  return _pipeline !== null
}

export function getLoadedModelId(): LocalModelId | null {
  return _loadedModelId
}

// ─── Model lifecycle ─────────────────────────────────────────────────────────

export type DownloadProgressCallback = (percent: number, label: string) => void

/**
 * Download (if not cached) and load a model into memory.
 * Subsequent calls with the same model ID are instant (no re-download, no re-load).
 * The browser's Cache Storage persists files across sessions → works offline.
 */
export async function loadLocalModel(
  modelId: LocalModelId,
  onProgress?: DownloadProgressCallback
): Promise<void> {
  if (_loadedModelId === modelId && _pipeline) return

  // Deduplicate concurrent calls
  if (_loadingPromise) { await _loadingPromise; return }

  const info = LOCAL_MODELS.find(m => m.id === modelId)
  if (!info) throw new Error(`Unknown local model: ${modelId}`)

  _loadingPromise = (async () => {
    // Dynamic import — Transformers.js is NOT in the main bundle (saves ~2 MB)
    const { pipeline, env } = await import('@huggingface/transformers')

    // Always read from / write to browser Cache Storage → offline capable
    env.useBrowserCache = true
    env.allowLocalModels = false

    // Load WASM runtime from CDN so it is not bundled into the app's dist.
    // This keeps the deployed site small; the WASM is downloaded only when needed.
    env.backends.onnx.wasm.wasmPaths =
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/'

    const device = isWebGPUAvailable() ? 'webgpu' : 'wasm'

    _pipeline = await pipeline(
      'text-generation',
      info.hfRepo,
      {
        device,
        dtype: info.dtype,
        progress_callback: (ev: { status: string; progress?: number; name?: string }) => {
          if (onProgress) {
            const pct = Math.round((ev.progress ?? 0) * 100)
            const lbl = ev.name
              ? ev.name.split('/').pop() || ev.name
              : ev.status
            onProgress(pct, lbl)
          }
        },
      }
    )

    _loadedModelId = modelId
    markModelCached(modelId, true)   // mark as available offline
    setActiveLocalModel(modelId)     // persist choice
  })()

  try {
    await _loadingPromise
  } finally {
    _loadingPromise = null
  }
}

/** Unload model from memory (frees RAM, keeps cached files on disk). */
export function unloadLocalModel(): void {
  _pipeline = null
  _loadedModelId = null
}

/**
 * Delete cached model files from Cache Storage.
 * Forces a full re-download next time the model is used.
 */
export async function deleteLocalModelCache(modelId: LocalModelId): Promise<void> {
  const info = LOCAL_MODELS.find(m => m.id === modelId)
  if (!info) return

  if ('caches' in window) {
    const cacheNames = await caches.keys()
    for (const name of cacheNames) {
      // Transformers.js stores files under cache keys containing the repo path
      if (name.toLowerCase().includes('transformers')) {
        const cache = await caches.open(name)
        const keys = await cache.keys()
        for (const req of keys) {
          const repoSlug = info.hfRepo.split('/')[1].toLowerCase()
          if (req.url.toLowerCase().includes(repoSlug)) {
            await cache.delete(req)
          }
        }
      }
    }
  }

  if (_loadedModelId === modelId) unloadLocalModel()
  markModelCached(modelId, false)
  if (getActiveLocalModel() === modelId) setActiveLocalModel(null)
}

// ─── Inference ────────────────────────────────────────────────────────────────

/**
 * Run inference on the currently loaded local model.
 * Exported so ai.ts can integrate it via callAI().
 */
export async function callLocalModel(
  system: string,
  user: string,
  maxTokens = 500
): Promise<string> {
  if (!_pipeline) throw new Error('No local model loaded')

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await _pipeline(messages, {
    max_new_tokens: maxTokens,
    temperature: 0.7,
    do_sample: true,
    return_full_text: false,
  })

  // Transformers.js chat output: [{ generated_text: [{role, content}...] | string }]
  const gen = result?.[0]?.generated_text
  if (Array.isArray(gen)) {
    // Find the last assistant turn
    const last = [...gen].reverse().find((m: { role: string }) => m.role === 'assistant')
    return (last as { content: string })?.content?.trim() ?? ''
  }
  return typeof gen === 'string' ? gen.trim() : ''
}

// ─── High-level generation functions ─────────────────────────────────────────

/** Generate a tourist route using the local model. Same contract as ai.ts. */
export async function generateLocalAIRoute(
  cityName: string,
  countryName: string,
  routeType: string,
  durationMinutes: number,
  lang: Language,
  excludeNames: string[]
): Promise<AIRouteResult | null> {
  const maxPOIs = Math.max(4, Math.min(10, Math.floor(durationMinutes / 20)))
  const locationDesc = countryName ? `${cityName}, ${countryName}` : cityName
  const excl = excludeNames.length > 0
    ? (lang === 'es'
      ? ` Excluye estos lugares ya visitados: ${excludeNames.slice(0, 10).join(', ')}.`
      : ` Exclude these already visited places: ${excludeNames.slice(0, 10).join(', ')}.`)
    : ''

  const system = lang === 'es'
    ? 'Eres un guía turístico experto. Respondes SOLO con JSON válido, sin texto fuera del JSON.'
    : 'You are an expert tour guide. Reply ONLY with valid JSON, no text outside the JSON.'

  const user = lang === 'es'
    ? `Ruta turística para ${locationDesc}. Temática: ${routeType}. Duración: ${durationMinutes} min. ${maxPOIs} paradas.${excl}
IMPORTANTE: Solo lugares en ${locationDesc}. Nombres como aparecen en Wikipedia.
JSON exacto:
{"routeStory":"narrativa 2-3 frases","suggestedPOIs":[{"name":"nombre Wikipedia","category":"categoría","reason":"por qué visitarlo","insiderTip":"consejo o null"}]}`
    : `Tour for ${locationDesc}. Theme: ${routeType}. Duration: ${durationMinutes} min. ${maxPOIs} stops.${excl}
IMPORTANT: Only places IN ${locationDesc}. Use Wikipedia names.
Exact JSON:
{"routeStory":"2-3 sentence narrative","suggestedPOIs":[{"name":"Wikipedia name","category":"category","reason":"why visit","insiderTip":"tip or null"}]}`

  try {
    const raw = await callLocalModel(system, user, 900)
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as AIRouteResult
    if (!Array.isArray(parsed.suggestedPOIs)) return null
    return parsed
  } catch (err) {
    console.error('[LocalAI] route generation error:', err)
    return null
  }
}

/** Generate a POI audio narration using the local model. Same contract as ai.ts. */
export async function generateLocalAIPOIScript(
  poiName: string,
  category: string,
  description: string,
  lang: Language
): Promise<string | null> {
  const system = lang === 'es'
    ? 'Eres un guía turístico apasionado. Narras de forma conversacional y emocionante. Solo la narración, sin comillas ni títulos.'
    : 'You are a passionate tour guide. Narrate in a conversational, exciting way. Only the narration text, no quotes or titles.'

  const user = lang === 'es'
    ? `Narración para "${poiName}" (${category}).
${description ? `Contexto: ${description.slice(0, 300)}` : ''}
Estructura: 1) Pide mirar la imagen en pantalla para confirmar el lugar. 2) Un dato fascinante. 3) Consejo insider. 4) Invita a disfrutar.
100-130 palabras. Voz viva y personal.`
    : `Narration for "${poiName}" (${category}).
${description ? `Context: ${description.slice(0, 300)}` : ''}
Structure: 1) Ask to look at screen image to confirm location. 2) One fascinating fact. 3) Insider tip. 4) Invite to enjoy.
100-130 words. Lively personal voice.`

  try {
    return await callLocalModel(system, user, 300)
  } catch (err) {
    console.error('[LocalAI] POI script error:', err)
    return null
  }
}

/** Generate a POI explanation for the "What to visit today?" search. */
export async function generateLocalAIPOIExplanation(
  poiName: string,
  cityName: string,
  description: string,
  lang: Language
): Promise<string | null> {
  const system = lang === 'es'
    ? 'Eres un guía turístico experto estilo Civitatis. Solo la narración, sin comillas ni títulos.'
    : 'You are an expert tour guide in the style of Civitatis. Only the narration, no quotes or titles.'

  const user = lang === 'es'
    ? `Explica "${poiName}" en ${cityName}.
${description ? `Información: ${description.slice(0, 300)}` : ''}
Empieza: "Mira la imagen en pantalla, ¿ves ${poiName}?" — luego 1 dato histórico sorprendente, qué mirar exactamente, un consejo práctico. 100-140 palabras.`
    : `Explain "${poiName}" in ${cityName}.
${description ? `Info: ${description.slice(0, 300)}` : ''}
Start: "Look at the screen image, can you see ${poiName}?" — then 1 surprising fact, what to look at specifically, a practical tip. 100-140 words.`

  try {
    return await callLocalModel(system, user, 300)
  } catch (err) {
    console.error('[LocalAI] POI explanation error:', err)
    return null
  }
}
