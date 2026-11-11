// Read-only HTTP API for an outside AI (docs/API.md "Read-only HTTP API").
//
//   node progress-api.mjs                         serve (PORT, default 8092)
//   node progress-api.mjs token add <user> <id>   new token for <user>'s pack, printed once
//   node progress-api.mjs token list
//   node progress-api.mjs token revoke <id>
//
// LC_DATA: folder with one pack per user (default /data/users; a single pack works
// too with LC_DATA=local and user = the pack's folder name). LC_API_TOKENS: the
// token file (default /data/api/tokens.json); only SHA-256 hashes are stored, and
// it is re-read when it changes, so a revoke takes effect at once. Built into one
// file with `npm run build:api` (dist-api/progress-api.mjs, no node_modules needed).

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { createApi, newToken, hashToken, readOnly, type TokenFile } from '../src/api/http';
import { today } from '../src/lib/dates';
import type { Session } from '../src/model/types';
import type { PackFs } from '../src/storage/fs';
import { listSessions, loadPack, loadSession } from '../src/storage/repo';
import { NodeFs } from './node-fs';

const DATA = resolve(process.env.LC_DATA ?? '/data/users');
const TOKENS = resolve(process.env.LC_API_TOKENS ?? '/data/api/tokens.json');
const PORT = Number(process.env.PORT ?? 8092);
const USER = /^[a-z0-9_-]{1,32}$/;

let cache: { mtime: number; file: TokenFile } | null = null;
function tokens(): TokenFile {
  let mtime: number;
  try {
    mtime = statSync(TOKENS).mtimeMs;
  } catch {
    return { tokens: [] };
  }
  if (cache?.mtime !== mtime) cache = { mtime, file: JSON.parse(readFileSync(TOKENS, 'utf8')) as TokenFile };
  return cache.file;
}

async function newest(fs: PackFs, paths: string[]): Promise<number | null> {
  const times = (await Promise.all(paths.map((p) => fs.mtime(p)))).filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

async function snapshot(user: string) {
  const dir = join(DATA, user);
  if (!USER.test(user) || !existsSync(join(dir, 'pack.json'))) throw new Error(`no pack for token user "${user}"`);
  const fs = readOnly(new NodeFs(dir));
  const loaded = await loadPack(fs);
  const ids = await listSessions(fs);
  const sessions = (await Promise.all(ids.map((id) => loadSession(fs, id).catch(() => null)))).filter((s): s is Session => !!s);
  const files = [
    'log/events.jsonl',
    'pack.json',
    ...loaded.subjects.map((s) => `subjects/${s.id}.json`),
    ...(await fs.list('sessions')).map((n) => `sessions/${n}`),
  ];
  const last = await newest(fs, files);
  return { snap: { loaded, sessions, on: today() }, freshness: { lastSync: last ? new Date(last).toISOString() : null } };
}

function saveTokens(file: TokenFile) {
  mkdirSync(dirname(TOKENS), { recursive: true });
  const tmp = TOKENS + '.tmp';
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, TOKENS);
}

function tokenCommand([cmd, a, b]: string[]) {
  const file = tokens();
  if (cmd === 'add') {
    if (!a || !USER.test(a) || !b || !/^[a-z0-9._-]{1,40}$/.test(b)) throw new Error('usage: token add <user> <id>   (id: a-z 0-9 . _ -)');
    if (file.tokens.some((t) => t.id === b && !t.revoked)) throw new Error(`token "${b}" exists; revoke it first`);
    if (!existsSync(join(DATA, a, 'pack.json'))) throw new Error(`no pack at ${join(DATA, a)}`);
    const token = newToken();
    file.tokens.push({ id: b, user: a, sha256: hashToken(token), created: new Date().toISOString() });
    saveTokens(file);
    console.log(token);
    console.error(`Token "${b}" for ${a}. Shown only now; only its hash is stored.`);
  } else if (cmd === 'revoke') {
    const t = file.tokens.find((x) => x.id === a && !x.revoked);
    if (!t) throw new Error(`no active token "${a}"`);
    t.revoked = new Date().toISOString();
    saveTokens(file);
    console.log(`Revoked "${a}".`);
  } else if (cmd === 'list') {
    for (const t of file.tokens) console.log(`${t.id}\t${t.user}\tcreated ${t.created}${t.revoked ? `\tREVOKED ${t.revoked}` : ''}`);
  } else {
    throw new Error('usage: token add <user> <id> | token list | token revoke <id>');
  }
}

const args = process.argv.slice(2);
if (args[0] === 'token') {
  try {
    tokenCommand(args.slice(1));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
} else {
  const handle = createApi({ tokens, snapshot });
  createServer(async (req, res) => {
    try {
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim();
      const out = await handle({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, ip });
      res.writeHead(out.status, out.headers);
      res.end(req.method === 'HEAD' ? undefined : out.body);
    } catch (e) {
      console.error(new Date().toISOString(), (e as Error).message);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"internal error"}');
    }
  }).listen(PORT, () => console.log(`progress API on :${PORT}, packs in ${DATA}, tokens in ${TOKENS}`));
}
