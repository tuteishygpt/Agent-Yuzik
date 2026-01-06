import { defineConfig } from 'vite';

export default defineConfig({
  // Ensure wasm and onnx files are treated as assets (not processed)
  assetsInclude: ['**/*.wasm', '**/*.onnx'],

  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
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
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Configure optimizeDeps to exclude onnxruntime-web as it has special loading requirements
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@ricky0123/vad-web'],
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

  // Plugin to set correct MIME types for .wasm files
  plugins: [
    {
      name: 'wasm-mime-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
          next();
        });
      },
    },
  ],
});
