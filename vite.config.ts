import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    // Prevent Vite from pre-bundling Transformers.js (loaded lazily on demand)
    exclude: ['@huggingface/transformers'],
  },
  build: {
    rollupOptions: {
      // Exclude Transformers.js WASM/worker assets from the build output.
      // The library loads its own WASM from CDN at runtime when a model is used.
      external: [],
      output: {
        // Keep Transformers.js as a separate lazy chunk so it never loads at startup
        manualChunks(id) {
          if (id.includes('@huggingface/transformers')) {
            return 'transformers'
          }
        },
      },
    },
    // Suppress the chunk size warning for the Transformers.js lazy chunk
    chunkSizeWarningLimit: 600,
    assetsInlineLimit: 0,
  },
})