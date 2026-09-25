import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://127.0.0.1:4310';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  // Fonts stay files: the site's CSP allows fonts only from itself, not data: URLs.
  build: { outDir: '../dist/web', emptyOutDir: true, assetsInlineLimit: (file) => (/\.(woff2?|ttf)$/.test(file) ? false : undefined) },
  server: {
    port: 5173,
    proxy: { '/api': api, '/run': api, '/_jhino': api },
  },
});
