/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base: the build runs from any sub-path (GitHub Pages project sites,
// web-game portals, CDNs) without per-host configuration. The original build
// hard-coded absolute '/assets/...' URLs and failed to boot on Pages.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  preview: { host: '127.0.0.1', port: 4199, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
