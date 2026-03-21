import fs from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'vite';

function authCallbackRoutePlugin() {
  const callbackHtml = '/auth-callback.html';
  const callbackRoute = '/auth/callback';

  const rewriteRequest = (req) => {
    if (!req.url) {
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === callbackRoute) {
      req.url = `${callbackHtml}${url.search}`;
    }
  };

  return {
    name: 'auth-callback-route',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        rewriteRequest(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        rewriteRequest(req);
        next();
      });
    },
    closeBundle() {
      const sourcePath = path.resolve(process.cwd(), 'dist', 'auth-callback.html');
      const nestedDir = path.resolve(process.cwd(), 'dist', 'auth', 'callback');
      const nestedIndexPath = path.join(nestedDir, 'index.html');

      if (fs.existsSync(sourcePath)) {
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.copyFileSync(sourcePath, nestedIndexPath);
      }
    },
  };
}

export default defineConfig({
  // Ensure wasm and onnx files are treated as assets (not processed)
  assetsInclude: ['**/*.wasm', '**/*.onnx'],

  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7861',
        changeOrigin: true,
        ws: true,
      },
      '/files': {
        target: 'http://127.0.0.1:7861',
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
        authCallback: 'auth-callback.html',
      },
    },
  },

  // Plugin to set correct MIME types for .wasm files
  plugins: [
    authCallbackRoutePlugin(),
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
