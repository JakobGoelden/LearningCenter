// Finds the personal packs in local/ (shared by start.mjs and session-start.mjs).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Personal packs, most recently changed first: [{ dir: 'local/s3', setupOpen: 3 }]. */
export function personalPacks() {
  const local = join(ROOT, 'local');
  if (!existsSync(local)) return [];
  return readdirSync(local, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(local, d.name, 'pack.json')))
    .map((d) => {
      const dir = join(local, d.name);
      const setup = join(dir, 'SETUP.md');
      const setupOpen = existsSync(setup) ? (readFileSync(setup, 'utf8').match(/^\s*[-*] \[ \]/gm) ?? []).length : 0;
      return { dir: `local/${d.name}`, setupOpen, mtime: statSync(join(dir, 'pack.json')).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}
