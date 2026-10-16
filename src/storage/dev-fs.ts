import type { PackFs } from './fs';

const API = '/__lc/fs';

/**
 * Pack folder served by the Vite dev server (see tools/vite-pack-fs.ts).
 * Works in every browser while `npm run dev` runs with LC_PACK_DIR set.
 */
export class DevFs implements PackFs {
  readonly kind = 'dev';
  readonly sharedWithAi = true;

  constructor(readonly label: string) {}

  /** Returns a DevFs when the dev server exposes a pack folder. */
  static async detect(): Promise<DevFs | null> {
    if (!import.meta.env.DEV) return null;
    try {
      const res = await fetch(`${API}/info`);
      if (!res.ok) return null;
      const info = (await res.json()) as { dir: string };
      return new DevFs(info.dir);
    } catch {
      return null;
    }
  }

  private async call(op: string, path: string, body?: string): Promise<Response> {
    const res = await fetch(`${API}/${op}?path=${encodeURIComponent(path)}`, {
      method: body === undefined ? 'GET' : 'POST',
      body,
    });
    if (!res.ok && res.status !== 404) throw new Error(`${op} ${path}: ${res.status} ${await res.text()}`);
    return res;
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
