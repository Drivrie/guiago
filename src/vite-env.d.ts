/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MISTRAL_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Injected at build time by vite.config.ts via `define`.
declare const __APP_VERSION__: string
declare const __APP_BUILD_DATE__: string
