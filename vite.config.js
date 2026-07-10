import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',

  build: {
    outDir: 'dist',
    // Target modern browsers that support top-level await (Telegram WebView is Chromium-based)
    target: 'es2022',
    rollupOptions: {
      input: 'index.html',
    },
    assetsInlineLimit: 4096,
    sourcemap: true,
  },

  server: {
    port: 3000,
    open: false,
  },

  worker: {
    format: 'es',
  },
});
