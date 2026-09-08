import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Everything under /api is forwarded to the daemon. This is why the backend needs no
    // CORS configuration: to the browser, client and API share an origin. In Tauri the
    // same SPA will talk to the sidecar the same way.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3777',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
