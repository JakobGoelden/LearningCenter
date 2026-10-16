import { FILES, idbClear, idbDelete, idbGet, idbKeys, idbSet } from './idb';
import { splitPath, type PackFs } from './fs';

interface Entry {
  text: string;
  mtime: number;
}

/** Pack stored inside the browser (IndexedDB). Works everywhere, invisible to outside tools. */
export class BrowserFs implements PackFs {
  readonly kind = 'browser';
  readonly label = 'Browser-Speicher';
  readonly sharedWithAi = false;

  async read(path: string) {
    splitPath(path);
    return (await idbGet<Entry>(FILES, path))?.text ?? null;
  }
  async write(path: string, text: string) {
    splitPath(path);
    await idbSet(FILES, path, { text, mtime: Date.now() } satisfies Entry);
  }
  async append(path: string, text: string) {
    await this.write(path, ((await this.read(path)) ?? '') + text);
  }
  async remove(path: string) {
    await idbDelete(FILES, path);
  }
  async list(dir: string) {
    const prefix = dir.replace(/\/?$/, '/');
    return (await idbKeys(FILES))
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => k.slice(prefix.length));
  }
  async mtime(path: string) {
    return (await idbGet<Entry>(FILES, path))?.mtime ?? null;
  }
  async isEmpty() {
    return (await idbGet<Entry>(FILES, 'pack.json')) === undefined;
  }
  async clear() {
    await idbClear(FILES);
  }
}
