import { BrowserFs } from '../storage/browser-fs';
import { DevFs } from '../storage/dev-fs';
import { FolderFs } from '../storage/folder-fs';
import type { PackFs } from '../storage/fs';

const KEY = 'learningcenter.source';
export type SourceKind = PackFs['kind'];

export function rememberSource(kind: SourceKind) {
  try {
    localStorage.setItem(KEY, kind);
  } catch {
    // ignore
  }
}

function lastSource(): SourceKind | null {
  try {
    return localStorage.getItem(KEY) as SourceKind | null;
  } catch {
    return null;
  }
}

export interface StartupOptions {
  /** Ready to use without a click. */
  auto: PackFs | null;
  /** A folder the browser remembers; reconnecting needs a click. */
  rememberedFolder: Awaited<ReturnType<typeof FolderFs.remembered>>;
  hasBrowserPack: boolean;
}

export async function detectStartup(): Promise<StartupOptions> {
  const dev = await DevFs.detect();
  const browser = new BrowserFs();
  const hasBrowserPack = !(await browser.isEmpty().catch(() => true));
  const rememberedFolder = await FolderFs.remembered().catch(() => null);
  if (dev) return { auto: dev, rememberedFolder, hasBrowserPack };
  const last = lastSource();
  if (last === 'browser' && hasBrowserPack) return { auto: browser, rememberedFolder, hasBrowserPack };
  return { auto: null, rememberedFolder, hasBrowserPack };
}
