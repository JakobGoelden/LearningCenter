import { idbDelete, idbGet, idbSet, KV } from './idb';
import { splitPath, type PackFs } from './fs';

// File System Access API pieces missing from lib.dom.d.ts.
type PermissionMode = { mode: 'read' | 'readwrite' };
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(opts: PermissionMode): Promise<PermissionState>;
  requestPermission(opts: PermissionMode): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandle>;
  }
}

const HANDLE_KEY = 'folderHandle';

export const folderAccessSupported = () => typeof window !== 'undefined' && !!window.showDirectoryPicker;

/** Pack in a real folder on disk, opened via the File System Access API (Chrome, Edge). */
export class FolderFs implements PackFs {
  readonly kind = 'folder';
  readonly sharedWithAi = true;
  readonly label: string;

  constructor(private readonly root: DirHandle) {
    this.label = root.name;
  }

  /** Asks the user to pick a folder (must run inside a click handler). */
  static async pick(): Promise<FolderFs> {
    const handle = await window.showDirectoryPicker!({ id: 'learningcenter-pack', mode: 'readwrite' });
    await idbSet(KV, HANDLE_KEY, handle);
    return new FolderFs(handle);
  }

  /** The folder opened last time, if the browser remembers it. */
  static async remembered(): Promise<{ name: string; reconnect: () => Promise<FolderFs | null> } | null> {
    if (!folderAccessSupported()) return null;
    const handle = await idbGet<DirHandle>(KV, HANDLE_KEY);
    if (!handle) return null;
    return {
      name: handle.name,
      // Needs a user gesture if permission has to be asked again.
      reconnect: async () => {
        const opts: PermissionMode = { mode: 'readwrite' };
        if ((await handle.queryPermission(opts)) === 'granted') return new FolderFs(handle);
        return (await handle.requestPermission(opts)) === 'granted' ? new FolderFs(handle) : null;
      },
    };
  }

  static async forget() {
    await idbDelete(KV, HANDLE_KEY);
  }

  private async dir(dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let cur: FileSystemDirectoryHandle = this.root;
    for (const d of dirs) {
      try {
        cur = await cur.getDirectoryHandle(d, { create });
      } catch (e) {
        if (!create && (e as DOMException).name === 'NotFoundError') return null;
        throw e;
      }
    }
    return cur;
  }

  private async file(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const { dirs, name } = splitPath(path);
    const dir = await this.dir(dirs, create);
    if (!dir) return null;
    try {
      return await dir.getFileHandle(name, { create });
    } catch (e) {
      if (!create && (e as DOMException).name === 'NotFoundError') return null;
      throw e;
    }
  }

  async read(path: string) {
    const fh = await this.file(path, false);
    return fh ? (await fh.getFile()).text() : null;
  }

  private urls = new Map<string, string>();

  async fileUrl(path: string) {
    const fh = await this.file(path, false);
    if (!fh) return null;
    URL.revokeObjectURL(this.urls.get(path) ?? '');
    const url = URL.createObjectURL(await fh.getFile());
    this.urls.set(path, url);
    return url;
  }

  async write(path: string, text: string) {
    const fh = (await this.file(path, true))!;
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  async append(path: string, text: string) {
    const fh = (await this.file(path, true))!;
    const size = (await fh.getFile()).size;
    const w = await fh.createWritable({ keepExistingData: true });
    await w.seek(size);
    await w.write(text);
    await w.close();
  }

  async remove(path: string) {
    const { dirs, name } = splitPath(path);
    const dir = await this.dir(dirs, false);
    try {
      await dir?.removeEntry(name);
    } catch (e) {
      if ((e as DOMException).name !== 'NotFoundError') throw e;
    }
  }

  async list(dirPath: string) {
    const dir = (await this.dir(dirPath.split('/').filter(Boolean), false)) as DirHandle | null;
    if (!dir) return [];
    const names: string[] = [];
    for await (const h of dir.values()) if (h.kind === 'file') names.push(h.name);
    return names.sort();
  }

  async mtime(path: string) {
    const fh = await this.file(path, false);
    return fh ? (await fh.getFile()).lastModified : null;
  }
}
