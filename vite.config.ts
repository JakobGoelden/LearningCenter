import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// `base: './'` keeps asset URLs relative, so the build works on GitHub Pages
// under /<repo>/ as well as from any other static host.
export default defineConfig({
  base: './',
  plugins: [preact()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
