import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Manual chunk groups. The goal is a small initial bundle (React + UI) so the
// first paint is quick, while heavy optional code (on-device LLM, map library)
// is kept in its own chunk. The dependency graph still forces these to load,
// but in parallel — not blocking each other — and with much better HTTP cache
// reuse when we deploy minor changes.
export default defineConfig({
  base: '/guiago/',
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    // WASM model file is ~22 MB by nature; the JS bundle should stay under 600 KB.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // React + router — required on first paint.
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // State + storage — small but used almost immediately after React.
          'state-vendor': ['zustand', 'idb'],
          // Maps — heavier, only used on the active-route page.
          'map-vendor': ['leaflet', 'react-leaflet'],
          // On-device AI (Transformers.js + ORT). Massive dependency kept in
          // its own chunk so it caches separately from app code.
          'ai-local': ['@huggingface/transformers'],
        },
      },
    },
  },
})
