import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { packFs } from './tools/vite-pack-fs';

// LC_PACK_DIR=local/my-pack npm run dev exposes that folder to the app (dev only).
// `base: './'` keeps asset URLs relative, so the build works on GitHub Pages
// under /<repo>/ as well as from any other static host.
export default defineConfig({
  base: './',
  plugins: [preact(), packFs()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
