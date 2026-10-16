/**
 * Minimal file-system abstraction over a pack folder. Paths are relative to
 * the pack root and use '/' (e.g. "subjects/db.json").
 */
export interface PackFs {
  readonly kind: 'folder' | 'dev' | 'browser';
  /** Shown in the UI, e.g. the folder name. */
  readonly label: string;
  /** True when an outside AI (Claude Code) can see the files, so the file bridge works. */
  readonly sharedWithAi: boolean;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  append(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** File names (not paths) directly inside `dir`; [] when missing. */
  list(dir: string): Promise<string[]>;
  /** Last modification time in ms, or null when the file is missing. */
  mtime(path: string): Promise<number | null>;
  /**
   * A URL the browser can display for a (possibly binary) file such as a PDF,
   * or null when the file is missing. Absent on backends without real files.
   */
  fileUrl?(path: string): Promise<string | null>;
}

export function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.')) throw new Error(`Invalid path: ${path}`);
  const name = parts.pop();
  if (!name) throw new Error(`Invalid path: ${path}`);
  return { dirs: parts, name };
}
