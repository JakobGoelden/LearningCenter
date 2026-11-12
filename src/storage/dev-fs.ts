import { FsHttpError, type PackFs } from './fs';

const API = '/__lc/fs';

/** A request that hangs (a train in a tunnel) gives up after this long, so the outbox can try again. */
const TIMEOUT_MS = 60000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pack folder served by the Vite dev server (see tools/vite-pack-fs.ts).
 * Works in every browser while `npm run dev` runs with LC_PACK_DIR set. A
 * production build talks to a hosted LearningCenter with the same API instead;
 * there the files are on the server, out of reach of the person's AI.
 */
export class DevFs implements PackFs {
  readonly sharedWithAi: boolean;

  constructor(
    readonly label: string,
    readonly kind: 'dev' | 'server' = 'dev',
    /** Reaching a server from outside the browser: its address and login. */
    private readonly remote?: { origin: string; headers?: Record<string, string> },
  ) {
    this.sharedWithAi = kind === 'dev';
  }

  /**
   * Returns a DevFs when a server exposes a pack folder: the Vite dev server
   * (LC_PACK_DIR) or a hosted LearningCenter server with the same /__lc/fs API.
   */
  static async detect(): Promise<DevFs | null> {
    try {
      const res = await fetch(`${API}/info`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const info = (await res.json()) as { dir: string };
      return new DevFs(info.dir, import.meta.env.PROD ? 'server' : 'dev');
    } catch {
      return null;
    }
  }

  private async call(op: string, path: string, body?: string): Promise<Response> {
    const res = await fetchWithTimeout(`${this.remote?.origin ?? ''}${API}/${op}?path=${encodeURIComponent(path)}`, {
      method: body === undefined ? 'GET' : 'POST',
      body,
      headers: this.remote?.headers,
    });
    if (!res.ok && res.status !== 404) throw new FsHttpError(`${op} ${path}: ${res.status} ${await res.text()}`, res.status);
    return res;
  }

  async appendEvents(events: object[]) {
    const res = await fetchWithTimeout(`${this.remote?.origin ?? ''}/__lc/events`, {
      method: 'POST',
      body: JSON.stringify({ events }),
      headers: { 'content-type': 'application/json', ...this.remote?.headers },
    });
    if (!res.ok) throw new FsHttpError(`events: ${res.status} ${await res.text()}`, res.status);
    const out = (await res.json()) as { accepted?: string[]; mtime?: number | null };
    const sent = events.map((e) => (e as { id: string }).id);
    const accepted = new Set(out.accepted ?? []);
    if (sent.some((id) => !accepted.has(id))) throw new FsHttpError('events: the server did not accept every event', 502);
    return { mtime: typeof out.mtime === 'number' ? out.mtime : null };
  }

  async read(path: string) {
    const res = await this.call('read', path);
    return res.status === 404 ? null : res.text();
  }
  async write(path: string, text: string) {
    await this.call('write', path, text);
  }
  async append(path: string, text: string) {
    await this.call('append', path, text);
  }
  async remove(path: string) {
    await this.call('remove', path, '');
  }
  async list(dir: string) {
    const res = await this.call('list', dir);
    return res.status === 404 ? [] : ((await res.json()) as string[]);
  }
  async fileUrl(path: string) {
    return (await this.mtime(path)) === null ? null : `${API}/raw?path=${encodeURIComponent(path)}`;
  }
  async mtime(path: string) {
    const res = await this.call('mtime', path);
    return res.status === 404 ? null : Number(await res.text());
  }
}
