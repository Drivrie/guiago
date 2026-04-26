/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MISTRAL_KEY?: string
  readonly VITE_TRANSLATE_API_KEY?: string
  readonly VITE_OPENROUTE_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
