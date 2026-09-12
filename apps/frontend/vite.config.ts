import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Bind-mount file events on macOS (docker-compose.override.yml) can be
    // sluggish or missed — poll from the start rather than debugging it later.
    // See docs/2-design-doc.md §13 "Dev loop / hot reload".
    watch: {
      usePolling: true,
    },
    // Convenience so the dev server behaves like the nginx reverse proxy
    // (see nginx.conf) that fronts the production build. Defaults to plain
    // `npm run dev` outside Docker; docker-compose.override.yml points this
    // at the `backend` service's Docker DNS name instead of localhost.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
