import { nowIso } from '../lib/dates';
import { assertValid } from '../model/validate';
import type { Bundle, Dojo, LoadedPack, LogEvent, Pack, Session, SheetWork, Subject } from '../model/types';
import type { PackFs } from './fs';
import { parseProgress, replaySubject, type ProgressEvent } from '../progress/ops';

const SCHEMA_ROOT = '../../schema/';

/** Pretty JSON with a trailing newline, keeping `$schema` first for editors. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

async function readJson(fs: PackFs, path: string): Promise<unknown> {
  const text = await fs.read(path);
  if (text === null) throw new Error(`${path} is missing.`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${(e as Error).message}`);
  }
}

/** pack.json exactly as stored (validated), e.g. to change one field. */
export async function readPackJson(fs: PackFs): Promise<Pack> {
  const { $schema: _s, ...pack } = assertValid('pack', await readJson(fs, 'pack.json'), 'pack.json');
  return pack;
}

/** The progress events of the log (empty without a log). */
export async function loadProgress(fs: PackFs): Promise<{ events: ProgressEvent[]; skipped: number }> {
  return parseProgress((await fs.read(EVENTS_PATH)) ?? '');
}

/** The subjects with their progress replayed from `events`. */
export const withReplay = (subjects: Subject[], events: ProgressEvent[]) => subjects.map((s) => replaySubject(s, events));

export async function loadPack(fs: PackFs): Promise<LoadedPack> {
  const pack = assertValid('pack', await readJson(fs, 'pack.json'), 'pack.json');
  const subjects: Subject[] = [];
  for (const id of pack.subjects) {
    const path = `subjects/${id}.json`;
    subjects.push(assertValid('subject', await readJson(fs, path), path));
  }
  const dojos: Dojo[] = [];
  for (const id of pack.dojos ?? []) {
    const path = `dojos/${id}.json`;
    dojos.push(assertValid('dojo', await readJson(fs, path), path));
  }
  if (pack.progress !== 'events') return { pack, subjects, dojos };
  const progress = await loadProgress(fs);
  return { pack, subjects: withReplay(subjects, progress.events), dojos, progress };
}

export type FileTimes = Record<string, number | null>;

export const subjectPath = (id: string) => `subjects/${id}.json`;

/** Most file checks at once: a pack has dozens of files, and a hosted server queues only so many. */
const PARALLEL_CHECKS = 6;

/** Modification time of every file the app reads, keyed by path. */
export async function fileTimes(fs: PackFs, loaded: LoadedPack): Promise<FileTimes> {
  const paths = [
    'pack.json',
    ...loaded.pack.subjects.map(subjectPath),
    ...(loaded.pack.dojos ?? []).map((id) => `dojos/${id}.json`),
    // Progress lives in the log: another device's answers show up there.
    ...(loaded.pack.progress === 'events' ? [EVENTS_PATH] : []),
  ];
  const times = new Array<number | null>(paths.length);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      times[i] = await fs.mtime(paths[i]);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_CHECKS }, worker));
  return Object.fromEntries(paths.map((p, i) => [p, times[i]]));
}

/** Modification times of all files the app reads, to notice outside edits. */
export async function fingerprint(fs: PackFs, loaded: LoadedPack): Promise<string> {
  return Object.values(await fileTimes(fs, loaded)).join(',');
}

/**
 * Applies `change` to a file and saves it, without losing outside edits.
 * `known` is the file's mtime when `current` was loaded. If the file changed
 * since (e.g. the sync job pulled new cards while the app was open), the
 * change is applied to the version on disk instead of the stale `current`.
 * Pass `known` as undefined when it is not known; then `current` is used.
 */
async function updateFile<T>(
  fs: PackFs,
  path: string,
  current: T,
  known: number | null | undefined,
  change: (value: T) => T,
  load: (data: unknown) => T,
  save: (value: T) => Promise<void>,
): Promise<{ value: T; reloaded: boolean }> {
  let base = current;
  let reloaded = false;
  if (known !== undefined && (await fs.mtime(path)) !== known) {
    base = load(await readJson(fs, path));
    reloaded = true;
  }
  const value = change(base);
  await save(value);
  return { value, reloaded };
}

/** `view`: turns the subject as read from its file into what the app shows (e.g. replays progress). */
export function updateSubjectFile(
  fs: PackFs,
  current: Subject,
  known: number | null | undefined,
  change: (s: Subject) => Subject,
  view: (s: Subject) => Subject = (s) => s,
): Promise<{ value: Subject; reloaded: boolean }> {
  const path = subjectPath(current.id);
  return updateFile(fs, path, current, known, change, (d) => view(assertValid('subject', d, path)), (s) =>
    saveSubject(fs, s),
  );
}

export function updatePackFile(
  fs: PackFs,
  current: Pack,
  known: number | null | undefined,
  change: (p: Pack) => Pack,
): Promise<{ value: Pack; reloaded: boolean }> {
  return updateFile(fs, 'pack.json', current, known, change, (d) => assertValid('pack', d, 'pack.json'), (p) =>
    savePack(fs, p),
  );
}

export async function savePack(fs: PackFs, pack: Pack) {
  assertValid('pack', pack);
  await fs.write('pack.json', toJson({ $schema: `${SCHEMA_ROOT}pack.schema.json`, ...pack }));
}

export async function saveSubject(fs: PackFs, subject: Subject) {
  assertValid('subject', subject, `subjects/${subject.id}.json`);
  await fs.write(
    `subjects/${subject.id}.json`,
    toJson({ $schema: `../${SCHEMA_ROOT}subject.schema.json`, ...subject }),
  );
}

export async function saveDojo(fs: PackFs, dojo: Dojo) {
  assertValid('dojo', dojo, `dojos/${dojo.id}.json`);
  await fs.write(`dojos/${dojo.id}.json`, toJson({ $schema: `../${SCHEMA_ROOT}dojo.schema.json`, ...dojo }));
}

export async function saveSession(fs: PackFs, session: Session) {
  assertValid('session', session, `sessions/${session.id}.json`);
  await fs.write(
    `sessions/${session.id}.json`,
    toJson({ $schema: `../${SCHEMA_ROOT}session.schema.json`, ...session }),
  );
}

export async function loadSession(fs: PackFs, id: string): Promise<Session | null> {
  const text = await fs.read(`sessions/${id}.json`);
  return text ? assertValid('session', JSON.parse(text), `sessions/${id}.json`) : null;
}

export async function listSessions(fs: PackFs): Promise<string[]> {
  return (await fs.list('sessions')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
}

export const workPath = (subject: string, sheet: string) => `work/${subject}/${sheet}.json`;

/** The learner's answers to a sheet, or an empty record. */
export async function loadWork(fs: PackFs, subject: string, sheet: string): Promise<SheetWork> {
  const path = workPath(subject, sheet);
  const text = await fs.read(path);
  return text ? assertValid('work', JSON.parse(text), path) : { subject, sheet, answers: {} };
}

export async function saveWork(fs: PackFs, work: SheetWork) {
  const path = workPath(work.subject, work.sheet);
  const data: SheetWork = { $schema: '../../../schema/work.schema.json', ...work, updatedAt: nowIso() };
  assertValid('work', data, path);
  await fs.write(path, toJson(data));
}

export const EVENTS_PATH = 'log/events.jsonl';

export async function appendEvent(fs: PackFs, event: Omit<LogEvent, 'ts'> & { ts?: string }) {
  const full: LogEvent = { ts: event.ts ?? nowIso(), actor: 'user', ...event };
  assertValid('event', full);
  await fs.append(EVENTS_PATH, JSON.stringify(full) + '\n');
}

const CHUNK_EVENTS = 200;
const CHUNK_BYTES = 512 * 1024;

/** Events in requests of at most 200 events and about 512 KB. */
export function chunkEvents<T>(events: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const e of events) {
    const size = JSON.stringify(e).length + 1;
    if (cur.length && (cur.length >= CHUNK_EVENTS || bytes + size > CHUNK_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Appends events to the log, each once: ids the log already has are skipped,
 * and all new lines go in one append. Uses the backend's own atomic version
 * (the server's POST /__lc/events) when it has one.
 */
export async function appendEventsTo(fs: PackFs, events: LogEvent[]): Promise<{ mtime: number | null }> {
  for (const e of events) {
    if (!e.id) throw new Error('appendEventsTo: every event needs an id.');
    assertValid('event', e);
  }
  if (fs.appendEvents) {
    // The server takes at most 500 events and 1 MB per request.
    let mtime: number | null = null;
    for (const chunk of chunkEvents(events)) ({ mtime } = await fs.appendEvents(chunk));
    return { mtime };
  }
  const text = (await fs.read(EVENTS_PATH)) ?? '';
  const known = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /"id":"([A-Za-z0-9_-]+)"/.exec(line);
    if (!m) continue;
    try {
      const id = (JSON.parse(line) as LogEvent).id;
      if (id) known.add(id);
    } catch {
      /* a broken line has no usable id */
    }
  }
  const lines: string[] = [];
  for (const e of events) {
    if (known.has(e.id!)) continue;
    known.add(e.id!);
    lines.push(JSON.stringify(e) + '\n');
  }
  if (lines.length) await fs.append(EVENTS_PATH, (text && !text.endsWith('\n') ? '\n' : '') + lines.join(''));
  return { mtime: await fs.mtime(EVENTS_PATH) };
}

export async function readEvents(fs: PackFs, limit = 200): Promise<LogEvent[]> {
  const text = (await fs.read(EVENTS_PATH)) ?? '';
  return text
    .split('\n')
    .filter((l) => l.trim())
    .slice(-limit)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as LogEvent];
      } catch {
        return [];
      }
    });
}

const BUNDLE_DIRS = ['subjects', 'dojos', 'sessions'];

/** Collects every pack file into one JSON document. */
export async function exportBundle(fs: PackFs): Promise<Bundle> {
  const files: Record<string, string> = {};
  const add = async (path: string) => {
    const text = await fs.read(path);
    if (text !== null) files[path] = text;
  };
  await add('pack.json');
  for (const dir of BUNDLE_DIRS) {
    for (const name of await fs.list(dir)) if (name.endsWith('.json')) await add(`${dir}/${name}`);
  }
  await add(EVENTS_PATH);
  const pack = files['pack.json'] ? (JSON.parse(files['pack.json']) as Pack) : null;
  for (const id of pack?.subjects ?? []) {
    for (const name of await fs.list(`work/${id}`)) if (name.endsWith('.json')) await add(`work/${id}/${name}`);
  }
  return { format: 'learningcenter-bundle', schemaVersion: 1, exportedAt: nowIso(), files };
}

/** Writes all files of a bundle into `fs`, after validating the manifest. */
export async function importBundle(fs: PackFs, data: unknown): Promise<void> {
  const bundle = assertValid('bundle', data, 'Bundle');
  if (!bundle.files['pack.json']) throw new Error('Bundle contains no pack.json.');
  for (const [path, text] of Object.entries(bundle.files)) await fs.write(path, text);
}

/** Wraps a plain file map (e.g. the demo pack) as a bundle. */
export function bundleOf(files: Record<string, string>): Bundle {
  return { format: 'learningcenter-bundle', schemaVersion: 1, files };
}
