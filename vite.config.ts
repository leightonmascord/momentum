import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/momentum/' : '/',
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      workbox: {
        navigateFallback: 'index.html',
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Momentum — Study Tracker',
        short_name: 'Momentum',
        description: 'Local-first study tracker with timer, assignments, marks, habits, and reports.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
}))