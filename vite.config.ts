import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production-tuned config:
//   * No source maps in the shipped bundle (saves ~1 MB and avoids
//     leaking paths inside the MSI).
//   * Manual chunks split tesseract.js into its own async chunk so the
//     initial paint isn't blocked by ~3 MB of WASM glue.
//   * `target: 'es2022'` matches WebView2's evergreen baseline.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ['@mlc-ai/web-llm'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mlc-ai/web-llm')) return 'web-llm'
            if (id.includes('tesseract.js')) return 'tesseract'
            if (id.includes('@radix-ui')) return 'radix-ui'
            if (id.includes('react-dom') || /node_modules[\\/]react[\\/]/.test(id)) return 'react'
          }
          return undefined
        },
      },
    },
  },
})
