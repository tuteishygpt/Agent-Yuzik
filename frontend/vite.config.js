import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7860',
        changeOrigin: true,
        ws: true,
      },
      '/files': {
        target: 'http://127.0.0.1:7860',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        voice: 'voice.html',
      },
    },
  },
});
