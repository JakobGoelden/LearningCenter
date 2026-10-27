import type { PackFs } from '../src/storage/fs';

export class MemFs implements PackFs {
  readonly kind = 'browser';
  readonly label = 'mem';
  readonly sharedWithAi = false;
  files = new Map<string, string>();
  /** Fake modification times: a counter that grows with every write. */
  times = new Map<string, number>();
  private clock = 0;
  async read(p: string) {
    return this.files.get(p) ?? null;
  }
  async write(p: string, t: string) {
    this.files.set(p, t);
    this.times.set(p, ++this.clock);
  }
  async append(p: string, t: string) {
    this.files.set(p, (this.files.get(p) ?? '') + t);
    this.times.set(p, ++this.clock);
  }
  async remove(p: string) {
    this.files.delete(p);
    this.times.delete(p);
  }
  async list(dir: string) {
    return [...this.files.keys()]
      .filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'))
      .map((k) => k.slice(dir.length + 1));
  }
  async mtime(p: string) {
    return this.files.has(p) ? (this.times.get(p) ?? 0) : null;
  }
}
