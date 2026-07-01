import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8800',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:8800',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // noVNC's entrypoint uses top-level await; es2022 is the floor that allows it.
    target: 'es2022',
    rollupOptions: {
      output: {
        // Split large, stable vendor libs into their own long-cached chunks so app
        // code can change without busting them. xterm/@novnc are left alone — they
        // ride along with the already-lazy Terminal chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@tanstack')) return 'react-query';
          if (id.includes('lucide-react')) return 'lucide-react';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/')
          ) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
