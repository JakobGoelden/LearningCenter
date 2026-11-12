import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { splitPath, type PackFs } from '../src/storage/fs';

/** PackFs over a folder on disk, for scripts run with Node. */
export class NodeFs implements PackFs {
  readonly kind = 'folder';
  readonly sharedWithAi = true;
  readonly label: string;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.label = basename(this.root);
  }

  private abs(path: string) {
    const { dirs, name } = splitPath(path);
    return join(this.root, ...dirs, name);
  }

  async read(path: string) {
    try {
      return await readFile(this.abs(path), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  /** Atomic: a crash or a reader in between never sees half a file. */
  async write(path: string, text: string) {
    const p = this.abs(path);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, p);
  }
  async append(path: string, text: string) {
    const p = this.abs(path);
    await mkdir(dirname(p), { recursive: true });
    await appendFile(p, text, 'utf8');
  }
  async remove(path: string) {
    await rm(this.abs(path), { force: true });
  }
  async list(dir: string) {
    try {
      const entries = await readdir(join(this.root, ...dir.split('/').filter(Boolean)), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }
  async mtime(path: string) {
    try {
      return (await stat(this.abs(path))).mtimeMs;
    } catch {
      return null;
    }
  }
}
