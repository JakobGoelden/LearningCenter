// Which pack the AI tools work on: --pack <dir>, else LC_URL (hosted app), else
// LC_PACK, else the most recently changed personal pack in local/.
import { join } from 'node:path';
import { DevFs } from '../src/storage/dev-fs';
import type { PackFs } from '../src/storage/fs';
import { NodeFs } from './node-fs';
import { personalPacks, ROOT } from './packs.mjs';

export function openPack(dir?: string): PackFs {
  const url = process.env.LC_URL;
  if (!dir && url) {
    const { LC_USER: user, LC_PASSWORD: password } = process.env;
    const headers: Record<string, string> = user ? { authorization: `Basic ${Buffer.from(`${user}:${password ?? ''}`).toString('base64')}` } : {};
    return new DevFs(url, 'server', { origin: url.replace(/\/+$/, ''), headers });
  }
  const given = dir ?? process.env.LC_PACK;
  if (given) return new NodeFs(given);
  const newest = personalPacks().find((p) => !p.dir.includes('.backup'));
  if (!newest) throw new Error('No pack found: set LC_PACK to a pack folder, or LC_URL for the hosted app.');
  return new NodeFs(join(ROOT, newest.dir));
}
