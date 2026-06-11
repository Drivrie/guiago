import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Inject build identity so the running app can show users which version
// they have and detect when a newer one is deployed.
function gitInfo() {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim()
    return { sha, date: new Date().toISOString() }
  } catch {
    return { sha: 'dev', date: new Date().toISOString() }
  }
}
const BUILD = gitInfo()

export default defineConfig({
  base: '/guiago/',
  define: {
    __APP_VERSION__: JSON.stringify(BUILD.sha),
    __APP_BUILD_DATE__: JSON.stringify(BUILD.date),
  },
  plugins: [
    react(),
    {
      // Substitute %APP_VERSION% / %APP_BUILD_DATE% placeholders so the
      // running app can detect when a newer build is on the server.
      name: 'inject-build-version',
      transformIndexHtml(html) {
        return html
          .replace(/%APP_VERSION%/g, BUILD.sha)
          .replace(/%APP_BUILD_DATE%/g, BUILD.date)
      },
    },
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