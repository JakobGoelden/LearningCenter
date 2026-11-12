import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemFs } from './memfs';
import { FsHttpError } from '../src/storage/fs';
import { EVENTS_LOG, MemoryOutbox, QueuedFs } from '../src/storage/queued-fs';
import { acceptEvents } from '../tools/events-endpoint';

/** A server that can go offline, refuse, or ask for a login. */
class FakeServer extends MemFs {
  mode: 'ok' | 'offline' | 'login' = 'ok';
  refuse = new Set<string>();
  refusePaths = new Set<string>();
  calls = 0;
  private check() {
    if (this.mode === 'offline') throw new TypeError('Failed to fetch');
    if (this.mode === 'login') throw new FsHttpError('401', 401);
  }
  async write(p: string, t: string) {
    this.check();
    if (this.refusePaths.has(p)) throw new FsHttpError('413 too big', 413);
    return super.write(p, t);
  }
  async read(p: string) {
    this.check();
    return super.read(p);
  }
  async appendEvents(events: object[]) {
    this.calls++;
    this.check();
    if (events.some((e) => this.refuse.has((e as { id: string }).id))) throw new FsHttpError('400 bad event', 400);
    const have = (await super.read(EVENTS_LOG)) ?? '';
    const add = events.filter((e) => !have.includes(`"id":"${(e as { id: string }).id}"`)).map((e) => JSON.stringify(e) + '\n');
    await super.append(EVENTS_LOG, add.join(''));
    return { mtime: await this.mtime(EVENTS_LOG) };
  }
}

const ev = (id: string) => ({ id, ts: '2026-11-12T10:00:00.000Z', type: 'progress', subject: 's', data: {} });
const ids = (text: string | null) => (text ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l).id);
const settle = async (q: QueuedFs) => {
  for (let i = 0; i < 5; i++) await q.flush();
};

describe('QueuedFs outbox', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  const make = (server = new FakeServer(), store = new MemoryOutbox()) => {
    const q = new QueuedFs(server, 'test', store);
    q.eventsMode = true;
    return { q, server, store };
  };

  it('passes everything through until the pack is migrated', async () => {
    const { q, server, store } = make();
    q.eventsMode = false;
    await q.write('sessions/a.json', '{}');
    expect(server.files.get('sessions/a.json')).toBe('{}');
    expect(store.data.size).toBe(0);
  });

  it('keeps answers given offline, shows them in reads, and sends them once back online', async () => {
    const { q, server, store } = make();
    server.mode = 'offline';
    await q.appendEvents([ev('a'), ev('b')]);
    await q.write('sessions/s1.json', '{"v":1}');
    await settle(q);
    expect(store.data.size).toBe(3);
    server.mode = 'ok';
    // Reads see what waits: the log has the events, the session its newest text.
    expect(ids(await q.read(EVENTS_LOG))).toEqual(['a', 'b']);
    expect(await q.read('sessions/s1.json')).toBe('{"v":1}');
    expect(await q.list('sessions')).toEqual(['s1.json']);
    await settle(q);
    expect(store.data.size).toBe(0);
    expect(ids(server.files.get(EVENTS_LOG)!)).toEqual(['a', 'b']);
    expect(server.files.get('sessions/s1.json')).toBe('{"v":1}');
  });

  it('only the newest write of a file is sent', async () => {
    const { q, server } = make();
    server.mode = 'offline';
    await q.write('sessions/s1.json', '1');
    await q.write('sessions/s1.json', '2');
    server.mode = 'ok';
    await settle(q);
    expect(server.files.get('sessions/s1.json')).toBe('2');
  });

  it('subject files are never queued: offline, saving them fails loudly', async () => {
    const { q, server } = make();
    server.mode = 'offline';
    await expect(q.write('subjects/x.json', '{}')).rejects.toThrow();
  });

  it('a refused event is set aside, the others still go through', async () => {
    const { q, server, store } = make();
    server.refuse.add('bad');
    const seen: string[] = [];
    q.onStatus((s) => seen.push(`${s.pending}/${s.failed}/${s.problem}`));
    await q.appendEvents([ev('a'), ev('bad'), ev('c')]);
    await settle(q);
    expect(ids(server.files.get(EVENTS_LOG)!)).toEqual(['a', 'c']);
    expect([...store.data.keys()].filter((k) => k.startsWith('outbox-failed|'))).toHaveLength(1);
    expect(seen.at(-1)).toBe('0/1/refused');
  });

  it('a refused file is set aside and does not hold back later files', async () => {
    const { q, server, store } = make();
    server.refusePaths.add('sessions/big.json');
    server.mode = 'offline';
    await q.write('sessions/big.json', 'x');
    await q.write('sessions/next.json', 'y');
    server.mode = 'ok';
    await settle(q);
    expect(server.files.get('sessions/next.json')).toBe('y');
    expect([...store.data.keys()].filter((k) => k.startsWith('outbox|'))).toHaveLength(0);
    expect([...store.data.keys()].filter((k) => k.startsWith('outbox-failed|'))).toHaveLength(1);
  });

  it('counts each send once and passes on the time before it', async () => {
    const { q } = make();
    const sends: (number | undefined)[] = [];
    q.onStatus((s) => sends.push(s.sends));
    await q.appendEvents([ev('a')]);
    await settle(q);
    await q.appendEvents([ev('b')]);
    await settle(q);
    expect(new Set(sends.filter(Boolean))).toEqual(new Set([1, 2]));
  });

  it('an expired login keeps everything and says so', async () => {
    const { q, server, store } = make();
    server.mode = 'login';
    let last = '';
    q.onStatus((s) => (last = String(s.problem)));
    await q.appendEvents([ev('a')]);
    await settle(q);
    expect(last).toBe('login');
    expect(store.data.size).toBe(1);
  });

  it('two tabs on one outbox lose nothing and send nothing twice', async () => {
    const server = new FakeServer();
    const store = new MemoryOutbox();
    const one = make(server, store).q;
    const two = make(server, store).q;
    server.mode = 'offline';
    await one.appendEvents([ev('a')]);
    await two.appendEvents([ev('b')]);
    server.mode = 'ok';
    await Promise.all([settle(one), settle(two)]);
    expect(ids(server.files.get(EVENTS_LOG)!).sort()).toEqual(['a', 'b']);
    expect(store.data.size).toBe(0);
  });

  it('retries with backoff after a failure', async () => {
    const { q, server } = make();
    server.mode = 'offline';
    await q.appendEvents([ev('a')]);
    await settle(q);
    const before = server.calls;
    server.mode = 'ok';
    await vi.advanceTimersByTimeAsync(2500);
    expect(server.calls).toBeGreaterThan(before);
    expect(ids(server.files.get(EVENTS_LOG)!)).toEqual(['a']);
  });

  it('log lines appended the old way get an id and go through the outbox', async () => {
    const { q, server } = make();
    await q.append(EVENTS_LOG, JSON.stringify({ ts: '2026-11-12T10:00:00.000Z', type: 'quiz.start' }) + '\n');
    await settle(q);
    const [line] = server.files.get(EVENTS_LOG)!.split('\n');
    expect(JSON.parse(line).id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('dev server POST /__lc/events', () => {
  let dir: string;
  let log: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lc-events-'));
    log = join(dir, 'log', 'events.jsonl');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const post = (events: unknown) => acceptEvents(log, JSON.stringify({ events }));

  it('appends new ids once, answers with every accepted id', async () => {
    const r1 = await post([ev('a'), ev('b'), ev('a')]);
    expect(r1.status).toBe(200);
    expect(JSON.parse(r1.body)).toMatchObject({ accepted: ['a', 'b'], added: 2 });
    const r2 = await post([ev('b'), ev('c')]);
    expect(JSON.parse(r2.body)).toMatchObject({ accepted: ['b', 'c'], added: 1, before: JSON.parse(r1.body).mtime });
    expect(ids(await readFile(log, 'utf8'))).toEqual(['a', 'b', 'c']);
  });

  it('is all-or-nothing', async () => {
    const r = await post([ev('a'), { id: 'bad id', ts: 'x', type: 'y' }]);
    expect(r.status).toBe(400);
    await expect(readFile(log, 'utf8')).rejects.toThrow();
  });

  it('repairs a half line before appending', async () => {
    await post([ev('a')]);
    await writeFile(log, (await readFile(log, 'utf8')) + '{"half', 'utf8');
    await post([ev('b')]);
    const lines = (await readFile(log, 'utf8')).split('\n');
    expect(lines[1]).toBe('{"half');
    expect(JSON.parse(lines[2]).id).toBe('b');
  });

  it('refuses too many events and bodies that are not JSON', async () => {
    expect((await post(Array.from({ length: 501 }, (_, i) => ev(`e${i}`)))).status).toBe(413);
    expect((await acceptEvents(log, '{"events": [')).status).toBe(400);
    expect((await acceptEvents(log, '{"nope": 1}')).status).toBe(400);
  });
});
