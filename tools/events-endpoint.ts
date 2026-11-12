import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * POST /__lc/events for the dev server, with the same contract as the hosted
 * server (learn/server.py): body {"events": [...]}, each with id/ts/type;
 * all-or-nothing validation; ids the log already has are skipped; new lines
 * go in one append; answer {accepted, added, mtime}. Calls must not overlap
 * (the caller queues them).
 */
const ID = /^[A-Za-z0-9_-]{1,100}$/;
export const MAX_EVENTS = 500;
export const MAX_BYTES = 1024 * 1024;

export async function acceptEvents(logPath: string, raw: string): Promise<{ status: number; body: string }> {
  if (Buffer.byteLength(raw) > MAX_BYTES) return { status: 413, body: 'too big' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: 'not valid JSON' };
  }
  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) return { status: 400, body: 'expected {"events": [...]}' };
  if (events.length > MAX_EVENTS) return { status: 413, body: `more than ${MAX_EVENTS} events` };
  for (const [i, e] of events.entries()) {
    const ev = e as Record<string, unknown>;
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return { status: 400, body: `event ${i}: not an object` };
    if (typeof ev.id !== 'string' || !ID.test(ev.id)) return { status: 400, body: `event ${i}: bad id` };
    if (typeof ev.ts !== 'string' || typeof ev.type !== 'string') return { status: 400, body: `event ${i}: ts and type must be strings` };
  }
  let text = '';
  let before: number | null = null;
  try {
    before = (await stat(logPath)).mtimeMs;
    text = await readFile(logPath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const known = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.includes('"id"')) continue;
    try {
      const id = (JSON.parse(line) as { id?: unknown }).id;
      if (typeof id === 'string') known.add(id);
    } catch {
      /* a broken line has no usable id */
    }
  }
  const accepted: string[] = [];
  let out = '';
  for (const e of events as { id: string }[]) {
    if (!accepted.includes(e.id)) accepted.push(e.id);
    if (known.has(e.id)) continue;
    known.add(e.id);
    out += JSON.stringify(e) + '\n';
  }
  if (out) {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, (text && !text.endsWith('\n') ? '\n' : '') + out, 'utf8');
  }
  const mtime = out || text ? (await stat(logPath)).mtimeMs : null;
  return { status: 200, body: JSON.stringify({ accepted, added: out.split('\n').length - 1, mtime, before }) };
}
