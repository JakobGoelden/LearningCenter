import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LoadedPack, LogEvent, Pack, Subject } from '../model/types';
import type { PackFs } from '../storage/fs';
import {
  appendEvent,
  fileTimes,
  loadPack,
  subjectPath,
  updatePackFile,
  updateSubjectFile,
  type FileTimes,
} from '../storage/repo';
import { loadAiSettings, saveAiSettings, type AiSettings } from '../ai/settings';

type EventInput = Omit<LogEvent, 'ts'>;

export interface PackApi {
  fs: PackFs;
  loaded: LoadedPack;
  subject(id: string): Subject | undefined;
  /** Applies `change` to a subject, saves it and logs `event`. */
  updateSubject(id: string, change: (s: Subject) => Subject, event?: EventInput): Promise<void>;
  updatePack(change: (p: Pack) => Pack, event?: EventInput): Promise<void>;
  log(event: EventInput): Promise<void>;
  reload(): Promise<void>;
  close(): void;
  ai: AiSettings;
  setAi(s: AiSettings): void;
  notice: string | null;
  setNotice(n: string | null): void;
}

const Ctx = createContext<PackApi | null>(null);

export function usePack(): PackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePack outside PackProvider');
  return v;
}

const POLL_MS = 3000;
/** A hosted pack only changes through the sync job or another device, and every look costs a request per file. */
const SERVER_POLL_MS = 30000;

export function PackProvider(props: {
  fs: PackFs;
  initial: LoadedPack;
  onClose(): void;
  children: ComponentChildren;
}) {
  const { fs } = props;
  const [loaded, setLoaded] = useState(props.initial);
  const [ai, setAiState] = useState(loadAiSettings);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  // mtime of every file as it was when its content in `loaded` was read or
  // written. Saves compare against it, so outside edits (Claude Code, the
  // hosted sync job pulling cards) are never overwritten with stale data.
  const times = useRef<FileTimes>({});
  const busy = useRef(0);

  const sameTimes = (a: FileTimes, b: FileTimes) =>
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((p) => a[p] === b[p]);

  const reload = useCallback(async () => {
    // Read the times before the files: if a file changes in between, the
    // older time makes the next save reload it again, which is safe.
    const before = await fileTimes(fs, loadedRef.current);
    const next = await loadPack(fs);
    const after = await fileTimes(fs, next);
    times.current = Object.fromEntries(Object.keys(after).map((p) => [p, p in before ? before[p] : after[p]]));
    loadedRef.current = next;
    setLoaded(next);
  }, [fs]);

  useEffect(() => {
    // `initial` was read before the times could be taken; load again so
    // content and times belong together.
    reload().catch((e) => setNotice(`Reload failed: ${(e as Error).message}`));
  }, []);

  // Pick up edits made outside the app, e.g. by Claude Code in the pack folder or the hosted sync job.
  useEffect(() => {
    if (fs.kind === 'browser') return;
    const timer = setInterval(async () => {
      if (busy.current || document.hidden) return;
      // A failed look is not worth a message: nothing was lost and the next one tries again.
      const now = await fileTimes(fs, loadedRef.current).catch(() => null);
      if (!now || sameTimes(now, times.current)) return;
      try {
        await reload();
        setNotice('The pack was changed outside the app and has been reloaded.');
      } catch (e) {
        setNotice(`Reload failed: ${(e as Error).message}`);
      }
    }, fs.kind === 'server' ? SERVER_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [fs, reload]);

  const log = useCallback((event: EventInput) => appendEvent(fs, event), [fs]);

  const updateSubject = useCallback<PackApi['updateSubject']>(
    async (id, change, event) => {
      const current = loadedRef.current;
      const before = current.subjects.find((s) => s.id === id);
      if (!before) throw new Error(`Unknown subject: ${id}`);
      const path = subjectPath(id);
      const withSubject = (base: LoadedPack, s: Subject) => ({
        ...base,
        subjects: base.subjects.map((x) => (x.id === id ? s : x)),
      });
      // Show the change at once; the saved version may differ if the file changed on disk.
      const optimistic = withSubject(current, change(before));
      setLoaded(optimistic);
      loadedRef.current = optimistic;
      busy.current++;
      try {
        const { value, reloaded } = await updateSubjectFile(fs, before, times.current[path], change);
        times.current = { ...times.current, [path]: await fs.mtime(path) };
        if (reloaded) {
          const next = withSubject(loadedRef.current, value);
          loadedRef.current = next;
          setLoaded(next);
          setNotice('This subject was changed outside the app (e.g. new cards). Your change was added to the new version.');
        }
        if (event) await appendEvent(fs, { subject: id, ...event });
      } catch (e) {
        setNotice(`Saving failed: ${(e as Error).message}`);
        loadedRef.current = current;
        setLoaded(current);
      } finally {
        busy.current--;
      }
    },
    [fs],
  );

  const updatePack = useCallback<PackApi['updatePack']>(
    async (change, event) => {
      const current = loadedRef.current;
      const optimistic = { ...current, pack: change(current.pack) };
      setLoaded(optimistic);
      loadedRef.current = optimistic;
      busy.current++;
      try {
        const { value, reloaded } = await updatePackFile(fs, current.pack, times.current['pack.json'], change);
        times.current = { ...times.current, 'pack.json': await fs.mtime('pack.json') };
        if (reloaded) {
          const next = { ...loadedRef.current, pack: value };
          loadedRef.current = next;
          setLoaded(next);
        }
        if (event) await appendEvent(fs, event);
      } catch (e) {
        setNotice(`Saving failed: ${(e as Error).message}`);
        loadedRef.current = current;
        setLoaded(current);
      } finally {
        busy.current--;
      }
    },
    [fs],
  );

  const setAi = useCallback((s: AiSettings) => {
    saveAiSettings(s);
    setAiState(s);
  }, []);

  const api = useMemo<PackApi>(
    () => ({
      fs,
      loaded,
      subject: (id) => loaded.subjects.find((s) => s.id === id),
      updateSubject,
      updatePack,
      log,
      reload,
      close: props.onClose,
      ai,
      setAi,
      notice,
      setNotice,
    }),
    [fs, loaded, updateSubject, updatePack, log, reload, ai, setAi, notice, props.onClose],
  );

  return <Ctx.Provider value={api}>{props.children}</Ctx.Provider>;
}
