import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { packFs } from './tools/vite-pack-fs';

// LC_PACK_DIR=local/my-pack npm run dev exposes that folder to the app (dev only).
// `open` starts the browser with `npm run dev` / `npm run preview` (BROWSER=none turns it off).
// `base: './'` keeps asset URLs relative, so the build works from any
// static host or folder.
export default defineConfig({
  base: './',
  plugins: [preact(), packFs()],
  server: { open: true },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] }, // loads its WebAssembly relative to itself
  preview: { open: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
