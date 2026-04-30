import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

// The renderer source lives under ./renderer; production assets are emitted
// to ./dist/renderer so Electron can load them via file:// alongside the
// compiled main process at ./dist/main.js.
export default defineConfig({
  root: path.resolve(__dirname, 'renderer'),
  plugins: [react()],
  // Relative base so the production build works when loaded via file:// in Electron.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: path.resolve(__dirname, 'renderer/src/test/setup.ts'),
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
