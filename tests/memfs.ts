import type { PackFs } from '../src/storage/fs';

export class MemFs implements PackFs {
  readonly kind = 'browser';
  readonly label = 'mem';
  readonly sharedWithAi = false;
  files = new Map<string, string>();
  async read(p: string) {
    return this.files.get(p) ?? null;
  }
  async write(p: string, t: string) {
    this.files.set(p, t);
  }
  async append(p: string, t: string) {
    this.files.set(p, (this.files.get(p) ?? '') + t);
  }
  async remove(p: string) {
    this.files.delete(p);
  }
  async list(dir: string) {
    return [...this.files.keys()]
      .filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'))
      .map((k) => k.slice(dir.length + 1));
  }
  async mtime(p: string) {
    return this.files.has(p) ? 1 : null;
  }
}
