import { defineConfig } from 'vite';

// `npm run build:progress`: `npm run progress` as one file with every
// dependency inside, so it runs on the server with plain Node (e.g. the
// node:22-alpine image) next to the packs.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'scripts/progress.ts',
    outDir: 'dist-progress',
    emptyOutDir: true,
    target: 'node18',
    rollupOptions: { output: { entryFileNames: 'progress.mjs', format: 'es', inlineDynamicImports: true } },
  },
  ssr: { noExternal: true, target: 'node' },
});
