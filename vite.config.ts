import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * VoiceBill is a client-only application: no server, no API keys, no database.
 * `base: './'` keeps every asset path relative so the same build works on
 * Vercel, Cloudflare Pages, GitHub Pages or a plain folder on a laptop.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // The Arena preview proxies the dev server through a different host name.
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
  },
})
