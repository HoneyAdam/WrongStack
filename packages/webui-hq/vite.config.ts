import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// HQ dashboard — offline React app served by the HQ server (port 3499).
// No CDN dependencies; everything bundles into dist/ for LAN/offline use.
export default defineConfig({
  plugins: [react()],
  base: '/',
  // React 19 requires modern browsers; esbuild's default browser targets
  // (es2020/chrome87) can't transform its destructuring patterns.
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  esbuild: {
    target: 'esnext',
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
  },
});
