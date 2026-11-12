import { defineConfig } from 'vite';

// `npm run build:api`: the read-only HTTP API (scripts/progress-api.ts) as one
// file with every dependency inside, so the server needs only Node.
export default defineConfig({
  // public/ holds the PWA files of the app; the API needs none of them.
  publicDir: false,
  build: {
    ssr: 'scripts/progress-api.ts',
    outDir: 'dist-api',
    emptyOutDir: true,
    target: 'node18',
    rollupOptions: { output: { entryFileNames: 'progress-api.mjs', format: 'es', inlineDynamicImports: true } },
  },
  ssr: { noExternal: true, target: 'node' },
});
