import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

// The service worker is plain JS in public/ (no build step). Its policy file
// puts its API on the global object; the worker itself runs below in a
// sandbox with a fake Cache API and a fake network.
const POLICY_SRC = readFileSync(new URL('../public/sw-policy.js', import.meta.url), 'utf8');
const SW_SRC = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

interface Policy {
  CACHES: Record<string, string>;
  classify(url: string, method: string, mode: string, scope: string): { kind: string; op?: string; path?: string };
  dataKey(origin: string, op: string, path: string): string;
  guardsWrites(path: string): boolean;
  isStorableData(res: { status: number; redirected: boolean; type: string; contentType: string | null }, op: string, path: string): boolean;
  assetUrlsFromHtml(html: string, pageUrl: string, scope: string): string[];
  fontUrlsFromCss(css: string, cssUrl: string, scope: string): string[];
  listWith(json: string, name: string): string | null;
  listWithout(json: string, name: string): string | null;
  logWithEvents(text: string, body: string): string | null;
}

function loadPolicy(): Policy {
  const ctx: Record<string, unknown> = { URL };
  vm.createContext(ctx);
  vm.runInContext(POLICY_SRC, ctx);
  return ctx.LcSwPolicy as Policy;
}

const P = loadPolicy();
const ORIGIN = 'https://learn.example';
const SCOPE = `${ORIGIN}/`;

describe('sw policy: classify', () => {
  const c = (path: string, method = 'GET', mode = 'cors') => P.classify(ORIGIN + path, method, mode, SCOPE);

  it('handles the page, build files and static files', () => {
    expect(c('/', 'GET', 'navigate').kind).toBe('shell');
    expect(c('/index.html', 'GET', 'navigate').kind).toBe('shell');
    expect(c('/?x=1', 'GET', 'navigate').kind).toBe('shell');
    expect(c('/login', 'GET', 'navigate').kind).toBe('bypass');
    expect(c('/assets/index-abc123.js').kind).toBe('asset');
    expect(c('/assets/KaTeX_Main-Regular-abc.woff2').kind).toBe('asset');
    expect(c('/manifest.webmanifest').kind).toBe('static');
    expect(c('/icons/icon-192.png').kind).toBe('static');
    expect(c('/something-else.js').kind).toBe('bypass');
    expect(P.classify('https://api.anthropic.com/v1/messages', 'POST', 'cors', SCOPE).kind).toBe('bypass');
    expect(P.classify('https://cdn.example/x.js', 'GET', 'cors', SCOPE).kind).toBe('bypass');
  });

  it('handles the file API and never the login, session, admin or AI routes', () => {
    expect(c('/__lc/fs/read?path=pack.json')).toEqual({ kind: 'data', op: 'read', path: 'pack.json' });
    expect(c('/__lc/fs/list?path=')).toEqual({ kind: 'data', op: 'list', path: '' });
    expect(c('/__lc/fs/mtime?path=a%2Fb.json')).toEqual({ kind: 'data', op: 'mtime', path: 'a/b.json' });
    expect(c('/__lc/fs/info').kind).toBe('data');
    expect(c('/__lc/fs/raw?path=m%2Fs.pdf')).toEqual({ kind: 'raw', op: 'raw', path: 'm/s.pdf' });
    expect(c('/__lc/fs/raw?path=m%2Fs.pdf', 'GET', 'navigate').kind).toBe('raw');
    expect(c('/__lc/fs/write?path=pack.json', 'POST')).toEqual({ kind: 'mutation', op: 'write', path: 'pack.json' });
    expect(c('/__lc/fs/append?path=log%2Fevents.jsonl', 'POST').kind).toBe('mutation');
    expect(c('/__lc/fs/remove?path=x', 'POST').kind).toBe('mutation');
    expect(c('/__lc/events', 'POST')).toEqual({ kind: 'events', path: 'log/events.jsonl' });
    for (const p of ['/__lc/login', '/__lc/logout', '/__lc/join?code=1', '/__lc/session', '/__lc/admin/users', '/api/x', '/__lc/other']) {
      expect(c(p).kind, p).toBe('bypass');
      expect(c(p, 'POST').kind, p).toBe('bypass');
    }
    expect(c('/__lc/fs/read?path=x', 'POST').kind).toBe('bypass');
    expect(c('/__lc/fs/write?path=x', 'GET').kind).toBe('bypass');
    expect(c('/__lc/fs/read').kind).toBe('bypass'); // no path
    expect(c('/assets/x.js', 'POST').kind).toBe('bypass');
  });

  it('respects a scope below the root', () => {
    const scope = `${ORIGIN}/app/`;
    expect(P.classify(`${ORIGIN}/app/`, 'GET', 'navigate', scope).kind).toBe('shell');
    expect(P.classify(`${ORIGIN}/`, 'GET', 'navigate', scope).kind).toBe('bypass');
    expect(P.classify(`${ORIGIN}/app/assets/a.js`, 'GET', 'cors', scope).kind).toBe('asset');
    expect(P.classify(`${ORIGIN}/assets/a.js`, 'GET', 'cors', scope).kind).toBe('bypass');
  });

  it('checks writes only of files others change too', () => {
    for (const p of ['pack.json', 'subjects/db.json', 'dojos/db-sql.json']) expect(P.guardsWrites(p), p).toBe(true);
    for (const p of ['sessions/x.json', 'work/db/s1.json', 'log/events.jsonl', 'shared.json', 'subjects/x/y.json']) expect(P.guardsWrites(p), p).toBe(false);
  });

  it('builds one cache key per file however the path was spelled', () => {
    expect(P.dataKey(ORIGIN, 'read', 'subjects/db.json')).toBe(`${ORIGIN}/__lc/fs/read?path=subjects%2Fdb.json`);
    expect(P.dataKey(ORIGIN, 'info', '')).toBe(`${ORIGIN}/__lc/fs/info`);
  });
});

describe('sw policy: what is stored', () => {
  const res = (over: Partial<{ status: number; redirected: boolean; type: string; contentType: string | null }>) => ({
    status: 200,
    redirected: false,
    type: 'basic',
    contentType: 'text/plain',
    ...over,
  });
  it('stores API answers, including "no such file"', () => {
    expect(P.isStorableData(res({}), 'read', 'pack.json')).toBe(true);
    expect(P.isStorableData(res({ status: 404 }), 'read', 'x.json')).toBe(true);
    expect(P.isStorableData(res({ contentType: 'application/json' }), 'info', '')).toBe(true);
  });
  it('never stores login pages, redirects, errors or opaque answers', () => {
    expect(P.isStorableData(res({ redirected: true }), 'read', 'pack.json')).toBe(false);
    expect(P.isStorableData(res({ contentType: 'text/html; charset=utf-8' }), 'read', 'pack.json')).toBe(false);
    expect(P.isStorableData(res({ contentType: 'text/html' }), 'info', '')).toBe(false);
    expect(P.isStorableData(res({ status: 401 }), 'read', 'pack.json')).toBe(false);
    expect(P.isStorableData(res({ status: 500 }), 'read', 'pack.json')).toBe(false);
    expect(P.isStorableData(res({ status: 404 }), 'info', '')).toBe(false);
    expect(P.isStorableData(res({ type: 'opaqueredirect', status: 0 }), 'read', 'pack.json')).toBe(false);
  });
});

describe('sw policy: helpers', () => {
  it('finds the build files of a page and the fonts of a stylesheet', () => {
    const html = `<script type="module" crossorigin src="./assets/index-A1.js"></script>
      <link rel="modulepreload" href="./assets/vendor-B2.js"><link rel="stylesheet" crossorigin href="./assets/index-C3.css">
      <link rel="manifest" href="./manifest.webmanifest"><script src="https://cdn.example/x.js"></script>`;
    expect(P.assetUrlsFromHtml(html, SCOPE, SCOPE)).toEqual([
      `${ORIGIN}/assets/index-A1.js`,
      `${ORIGIN}/assets/vendor-B2.js`,
      `${ORIGIN}/assets/index-C3.css`,
    ]);
    const css = `@font-face{src:url(./KaTeX_Main-Regular-X.woff2) format("woff2"),url(./KaTeX_Main-Regular-X.woff) format("woff")}
      @font-face{src:url("KaTeX_Math-Italic-Y.woff2?v=1")}`;
    expect(P.fontUrlsFromCss(css, `${ORIGIN}/assets/index-C3.css`, SCOPE)).toEqual([
      `${ORIGIN}/assets/KaTeX_Main-Regular-X.woff2`,
      `${ORIGIN}/assets/KaTeX_Math-Italic-Y.woff2`,
    ]);
  });
  it('updates directory listings', () => {
    expect(P.listWith('["b.json"]', 'a.json')).toBe('["a.json","b.json"]');
    expect(P.listWith('["a.json"]', 'a.json')).toBe('["a.json"]');
    expect(P.listWithout('["a.json","b.json"]', 'a.json')).toBe('["b.json"]');
    expect(P.listWith('<html>', 'a.json')).toBeNull();
  });
  it('appends events like the server: known ids skipped, newline kept', () => {
    const log = '{"id":"e1","ts":"t","type":"x"}';
    const body = JSON.stringify({ events: [{ id: 'e1', ts: 't', type: 'x' }, { id: 'e2', ts: 't', type: 'y' }] });
    expect(P.logWithEvents(log, body)).toBe(`${log}\n{"id":"e2","ts":"t","type":"y"}\n`);
    expect(P.logWithEvents('', body)).toBe('{"id":"e1","ts":"t","type":"x"}\n{"id":"e2","ts":"t","type":"y"}\n');
    expect(P.logWithEvents(log, 'nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The service worker itself, against a fake network and Cache API.

type Handler = (url: string, init: { method: string; body: string }) => Response | Promise<Response>;

class FakeCache {
  entries = new Map<string, Response>();
  async match(req: string | { url: string }) {
    const r = this.entries.get(typeof req === 'string' ? req : req.url);
    return r ? r.clone() : undefined;
  }
  async put(req: string | { url: string }, res: Response) {
    const buf = await res.arrayBuffer();
    this.entries.set(typeof req === 'string' ? req : req.url, new Response(buf, { status: res.status, headers: res.headers }));
  }
  async delete(req: string | { url: string }) {
    return this.entries.delete(typeof req === 'string' ? req : req.url);
  }
}

function redirected(res: Response): Response {
  Object.defineProperty(res, 'redirected', { value: true });
  return res;
}

interface Worker {
  caches: Map<string, FakeCache>;
  online: boolean;
  server: Handler;
  fetchLog: string[];
  dispatch(type: string, event?: object): Promise<void>;
  request(path: string, opts?: { method?: string; body?: string; mode?: string }): Promise<Response>;
  cached(cache: string, path: string): Promise<string | null>;
}

function startWorker(): Worker {
  const caches = new Map<string, FakeCache>();
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const w: Worker = {
    caches,
    online: true,
    server: () => new Response('not found', { status: 404 }),
    fetchLog: [],
    async dispatch(type, event = {}) {
      const waits: Promise<unknown>[] = [];
      const e = { ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) };
      for (const l of listeners[type] ?? []) l(e);
      await settle(waits);
    },
    async request(path, opts = {}) {
      const url = path.startsWith('http') ? path : ORIGIN + path;
      const method = opts.method ?? 'GET';
      const body = opts.body ?? '';
      const req = {
        url,
        method,
        mode: opts.mode ?? 'cors',
        cache: 'default',
        clone: () => ({ text: async () => body }),
        text: async () => body,
        _body: body,
      };
      let response: Promise<Response> | null = null;
      const waits: Promise<unknown>[] = [];
      const e = {
        request: req,
        respondWith: (p: Promise<Response>) => (response = Promise.resolve(p)),
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      };
      for (const l of listeners.fetch ?? []) l(e);
      const res = response ? await (response as Promise<Response>) : await netFetch(req);
      await settle(waits);
      return res;
    },
    async cached(cache, path) {
      const r = await caches.get(cache)?.match(ORIGIN + path);
      return r ? `${r.status} ${await r.text()}` : null;
    },
  };
  async function settle(waits: Promise<unknown>[]) {
    // Background work can add more waitUntil promises; wait until none are new.
    for (let n = 0; n < waits.length || n === 0; ) {
      const batch = waits.slice(n);
      n = waits.length;
      await Promise.allSettled(batch);
      await new Promise((r) => setTimeout(r, 5));
      if (waits.length === n) break;
    }
  }
  async function netFetch(req: string | { url: string; method?: string; _body?: string }) {
    const url = typeof req === 'string' ? req : req.url;
    const method = typeof req === 'string' ? 'GET' : (req.method ?? 'GET');
    w.fetchLog.push(`${method} ${url.replace(ORIGIN, '')}`);
    if (!w.online) throw new TypeError('Failed to fetch');
    return w.server(url, { method, body: typeof req === 'string' ? '' : (req._body ?? '') });
  }
  const ctx: Record<string, unknown> = {
    URL,
    Response,
    Headers,
    console,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms / 200), // 4 s → 20 ms
    location: { origin: ORIGIN },
    registration: { scope: SCOPE },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] ??= []).push(fn),
    importScripts: () => vm.runInContext(POLICY_SRC, ctx),
    fetch: (req: string | { url: string }) => netFetch(req),
    caches: {
      open: async (name: string) => {
        if (!caches.has(name)) caches.set(name, new FakeCache());
        return caches.get(name)!;
      },
      keys: async () => [...caches.keys()],
      delete: async (name: string) => caches.delete(name),
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(SW_SRC, ctx);
  return w;
}

const DATA = P.CACHES.data;
const text = (body: string, status = 200, type = 'text/plain') => new Response(body, { status, headers: { 'content-type': type } });

describe('service worker: pack files', () => {
  let w: Worker;
  let files: Record<string, string>;
  beforeEach(() => {
    w = startWorker();
    files = { 'pack.json': '{"v":1}', 'subjects/db.json': '{"a":1}' };
    w.server = (url, { method, body }) => {
      const u = new URL(url);
      const op = u.pathname.split('/').pop()!;
      const path = u.searchParams.get('path') ?? '';
      if (op === 'info') return text('{"dir":"x"}', 200, 'application/json');
      if (method === 'POST' && op === 'write') return (files[path] = body), text('ok');
      if (method === 'POST' && op === 'append') return (files[path] = (files[path] ?? '') + body), text('ok');
      if (method === 'POST' && op === 'remove') return delete files[path], text('ok');
      if (u.pathname === '/__lc/events') {
        const events = JSON.parse(body).events as { id: string }[];
        files['log/events.jsonl'] = (files['log/events.jsonl'] ?? '') + events.map((e) => JSON.stringify(e) + '\n').join('');
        return text(JSON.stringify({ accepted: events.map((e) => e.id), mtime: 5 }), 200, 'application/json');
      }
      if (op === 'list') {
        const names = Object.keys(files).filter((f) => (path ? f.startsWith(path + '/') : !f.includes('/')) && !f.slice(path ? path.length + 1 : 0).includes('/'));
        return text(JSON.stringify(names.map((n) => n.slice(n.lastIndexOf('/') + 1)).sort()), 200, 'application/json');
      }
      if (!(path in files)) return text('not found', 404);
      if (op === 'read') return text(files[path]);
      if (op === 'mtime') return text('123');
      return text('?', 400);
    };
  });

  const read = (path: string) => w.request(`/__lc/fs/read?path=${encodeURIComponent(path)}`);

  it('serves the offline copy when the network is gone, and 404s too', async () => {
    expect(await (await read('pack.json')).text()).toBe('{"v":1}');
    expect((await read('shared.json')).status).toBe(404);
    w.online = false;
    expect(await (await read('pack.json')).text()).toBe('{"v":1}');
    expect((await read('shared.json')).status).toBe(404);
    await expect(read('never-read.json')).rejects.toThrow();
  });

  it('passes a login redirect through and keeps the old copy', async () => {
    await read('pack.json');
    w.server = () => redirected(text('<html>login</html>', 200, 'text/html'));
    const res = await read('pack.json');
    expect(await res.text()).toContain('login');
    expect(await w.cached(DATA, '/__lc/fs/read?path=pack.json')).toBe('200 {"v":1}');
  });

  it('falls back to the copy on server errors and slow networks', async () => {
    await read('pack.json');
    const server = w.server;
    w.server = () => text('bad gateway', 502);
    expect(await (await read('pack.json')).text()).toBe('{"v":1}');
    w.server = (u, i) => new Promise((r) => setTimeout(() => r(server(u, i)), 60)); // > 20 ms "4 s"
    expect(await (await read('pack.json')).text()).toBe('{"v":1}');
  });

  it('after a successful write, never serves the old content', async () => {
    await read('subjects/db.json');
    await w.request('/__lc/fs/mtime?path=subjects%2Fdb.json');
    await w.request('/__lc/fs/list?path=subjects');
    let res = await w.request('/__lc/fs/write?path=subjects%2Fdb.json', { method: 'POST', body: '{"a":2}' });
    expect(res.status).toBe(200);
    res = await w.request('/__lc/fs/write?path=subjects%2Fnew.json', { method: 'POST', body: '{"n":1}' });
    w.online = false;
    expect(await (await read('subjects/db.json')).text()).toBe('{"a":2}');
    expect(await (await read('subjects/new.json')).text()).toBe('{"n":1}');
    expect(await w.cached(DATA, '/__lc/fs/mtime?path=subjects%2Fdb.json')).toBeNull();
    expect(await (await w.request('/__lc/fs/list?path=subjects')).text()).toBe('["db.json","new.json"]');
  });

  it('a read that was under way during a write does not bring the old content back', async () => {
    await read('subjects/db.json');
    const server = w.server;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // The read leaves before the write and its (old) answer arrives after it.
    w.server = (u, i) => {
      if (i.method === 'GET') {
        const old = server(u, i);
        return gate.then(() => old);
      }
      return server(u, i);
    };
    const slowRead = read('subjects/db.json');
    await w.request('/__lc/fs/write?path=subjects%2Fdb.json', { method: 'POST', body: '{"a":3}' });
    release();
    await slowRead;
    w.online = false;
    expect(await (await read('subjects/db.json')).text()).toBe('{"a":3}');
  });

  it('remove, append and events keep the copy in the written state', async () => {
    await read('pack.json');
    await read('notes.md');
    await read('log/events.jsonl');
    await w.request('/__lc/fs/remove?path=pack.json', { method: 'POST' });
    await w.request('/__lc/fs/append?path=notes.md', { method: 'POST', body: 'hello\n' });
    await w.request('/__lc/events', { method: 'POST', body: JSON.stringify({ events: [{ id: 'e1', ts: 't', type: 'x' }] }) });
    w.online = false;
    expect((await read('pack.json')).status).toBe(404);
    expect(await (await read('notes.md')).text()).toBe('hello\n');
    expect(await (await read('log/events.jsonl')).text()).toBe('{"id":"e1","ts":"t","type":"x"}\n');
  });

  it('a write answered by the login page counts as failed', async () => {
    await read('pack.json');
    w.server = () => redirected(text('<html>login</html>', 200, 'text/html'));
    const res = await w.request('/__lc/fs/write?path=pack.json', { method: 'POST', body: '{"v":9}' });
    expect(res.status).toBe(401);
    w.online = false;
    expect(await (await read('pack.json')).text()).toBe('{"v":1}');
  });

  it('a failed write leaves the copy alone', async () => {
    await read('pack.json');
    w.online = false;
    await expect(w.request('/__lc/fs/write?path=pack.json', { method: 'POST', body: '{"v":9}' })).rejects.toThrow();
    expect(await (await read('pack.json')).text()).toBe('{"v":1}');
  });

  it('refuses to overwrite a file that changed on the server since it came from the copy', async () => {
    await read('subjects/db.json');
    w.online = false;
    expect(await (await read('subjects/db.json')).text()).toBe('{"a":1}'); // from the copy
    w.online = true;
    files['subjects/db.json'] = '{"a":1,"pulled":true}'; // e.g. the sync job pulled cards
    const res = await w.request('/__lc/fs/write?path=subjects%2Fdb.json', { method: 'POST', body: '{"a":1,"mine":true}' });
    expect(res.status).toBe(409);
    expect(files['subjects/db.json']).toBe('{"a":1,"pulled":true}');
    // After loading the server's version, writing works again.
    expect(await (await read('subjects/db.json')).text()).toBe('{"a":1,"pulled":true}');
    const ok = await w.request('/__lc/fs/write?path=subjects%2Fdb.json', { method: 'POST', body: '{"both":true}' });
    expect(ok.status).toBe(200);
    expect(files['subjects/db.json']).toBe('{"both":true}');
  });

  it('does not check files only this device writes', async () => {
    files['work/db/s1.json'] = '{"old":1}';
    await read('work/db/s1.json');
    w.online = false;
    await read('work/db/s1.json');
    w.online = true;
    files['work/db/s1.json'] = '{"other":1}';
    const res = await w.request('/__lc/fs/write?path=work%2Fdb%2Fs1.json', { method: 'POST', body: '{"mine":1}' });
    expect(res.status).toBe(200);
  });

  it('lets the write through when the copy matched the server after all', async () => {
    await read('subjects/db.json');
    w.online = false;
    await read('subjects/db.json');
    w.online = true;
    const res = await w.request('/__lc/fs/write?path=subjects%2Fdb.json', { method: 'POST', body: '{"a":5}' });
    expect(res.status).toBe(200);
    expect(files['subjects/db.json']).toBe('{"a":5}');
  });

  it('never caches PDFs on its own', async () => {
    files['m/s.pdf'] = 'PDF';
    w.server = () => text('PDF', 200, 'application/pdf');
    const res = await w.request('/__lc/fs/raw?path=m%2Fs.pdf');
    expect(await res.text()).toBe('PDF');
    for (const c of w.caches.values()) expect([...c.entries.keys()].some((k) => k.includes('raw'))).toBe(false);
  });

  it('leaves non-GET and login routes to the browser', async () => {
    w.server = () => text('ok');
    await w.request('/__lc/login', { method: 'POST', body: 'x' });
    await w.request('/__lc/session');
    for (const c of w.caches.values()) expect(c.entries.size).toBe(0);
  });
});

describe('service worker: app shell', () => {
  const HTML = (v: string) =>
    `<!doctype html><script type="module" src="./assets/index-${v}.js"></script><link rel="stylesheet" href="./assets/index-${v}.css">`;

  function serve(w: Worker, v: string, extra: Record<string, Response> = {}) {
    w.server = (url) => {
      const p = url.replace(ORIGIN, '');
      if (p === '/' || p === '/?x') return text(HTML(v), 200, 'text/html');
      if (p === `/assets/index-${v}.js`) return text(`js ${v}`, 200, 'text/javascript');
      if (p === `/assets/index-${v}.css`) return text(`@font-face{src:url(./font-${v}.woff2)}`, 200, 'text/css');
      if (p === `/assets/font-${v}.woff2`) return text('font', 200, 'font/woff2');
      if (extra[p]) return extra[p];
      return text('missing', 404);
    };
  }

  it('precaches the page, its build files and fonts on install, then works offline', async () => {
    const w = startWorker();
    serve(w, 'v1');
    await w.dispatch('install');
    w.online = false;
    const page = await w.request('/', { mode: 'navigate' });
    expect(await page.text()).toBe(HTML('v1'));
    expect(await (await w.request('/assets/index-v1.js')).text()).toBe('js v1');
    expect(await (await w.request('/assets/font-v1.woff2')).text()).toBe('font');
  });

  it('takes a new page online, keeps it only with its build files, and drops the old ones', async () => {
    const w = startWorker();
    serve(w, 'v1');
    await w.dispatch('install');
    serve(w, 'v2');
    expect(await (await w.request('/', { mode: 'navigate' })).text()).toBe(HTML('v2'));
    w.online = false;
    expect(await (await w.request('/', { mode: 'navigate' })).text()).toBe(HTML('v2'));
    expect(await (await w.request('/assets/index-v2.js')).text()).toBe('js v2');
    await expect(w.request('/assets/index-v1.js')).rejects.toThrow();
  });

  it('keeps the old page when the new build files cannot be fetched', async () => {
    const w = startWorker();
    serve(w, 'v1');
    await w.dispatch('install');
    w.server = (url) => (url === SCOPE ? text(HTML('v2'), 200, 'text/html') : text('down', 503));
    await w.request('/', { mode: 'navigate' });
    w.online = false;
    expect(await (await w.request('/', { mode: 'navigate' })).text()).toBe(HTML('v1'));
  });

  it('passes the login redirect of the page through and does not keep it', async () => {
    const w = startWorker();
    serve(w, 'v1');
    await w.dispatch('install');
    w.server = () => redirected(text('<html>login</html>', 200, 'text/html'));
    expect(await (await w.request('/', { mode: 'navigate' })).text()).toContain('login');
    w.online = false;
    expect(await (await w.request('/', { mode: 'navigate' })).text()).toBe(HTML('v1'));
  });

  it('caches lazily loaded build files when first fetched', async () => {
    const w = startWorker();
    serve(w, 'v1', { '/assets/pglite-X.js': text('engine', 200, 'text/javascript') });
    await w.request('/assets/pglite-X.js');
    w.online = false;
    expect(await (await w.request('/assets/pglite-X.js')).text()).toBe('engine');
  });
});
