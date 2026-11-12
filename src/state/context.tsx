import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ISODate, LoadedPack, LogEvent, Pack, Subject } from '../model/types';
import type { PackFs } from '../storage/fs';
import {
  appendEvent,
  appendEventsTo,
  EVENTS_PATH,
  fileTimes,
  loadPack,
  subjectPath,
  updatePackFile,
  updateSubjectFile,
  type FileTimes,
} from '../storage/repo';
import { QueuedFs, type OutboxStatus } from '../storage/queued-fs';
import { applyEvent, newReplayState, progressEvent, replaySubject, type ProgressOp } from '../progress/ops';
import { today } from '../lib/dates';
import { loadAiSettings, saveAiSettings, type AiSettings } from '../ai/settings';

type EventInput = Omit<LogEvent, 'ts'>;

export interface PackApi {
  fs: PackFs;
  loaded: LoadedPack;
  subject(id: string): Subject | undefined;
  /** Applies `change` to a subject, saves it and logs `event`. */
  updateSubject(id: string, change: (s: Subject) => Subject, event?: EventInput): Promise<void>;
  updatePack(change: (p: Pack) => Pack, event?: EventInput): Promise<void>;
  /**
   * Records progress (answers, ratings, dates set by hand) of one subject.
   * Returns the ids of the progress events, e.g. for a later `replaces`.
   * In a migrated pack the ops become events (sent through the outbox, shown
   * at once); otherwise they change the subject file as before, with the same code.
   */
  record(subject: string, ops: ProgressOp[], event?: EventInput, on?: ISODate): Promise<string[]>;
  /** Answers and files still waiting on this device to be sent. */
  outbox: OutboxStatus | null;
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
  const [outbox, setOutbox] = useState<OutboxStatus | null>(null);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  // mtime of every file as it was when its content in `loaded` was read or
  // written. Saves compare against it, so outside edits (Claude Code, the
  // hosted sync job pulling cards) are never overwritten with stale data.
  const times = useRef<FileTimes>({});
  const busy = useRef(0);
  const outboxRef = useRef<OutboxStatus | null>(null);
  /** Quiz answers' cards before their first rating (for corrections), in packs that are not migrated. */
  const fileReplay = useRef(newReplayState());
  const eventsMode = () => loadedRef.current.pack.progress === 'events';
  const progressEvents = () => loadedRef.current.progress?.events ?? [];

  // The outbox of a server pack: its count for the header, and the log's time after each send.
  useEffect(() => {
    if (!(fs instanceof QueuedFs)) return;
    const stopStatus = fs.onStatus((st) => {
      outboxRef.current = st;
      setOutbox(st);
      if (st.logMtime !== undefined && st.logMtime !== null && eventsMode()) times.current = { ...times.current, [EVENTS_PATH]: st.logMtime };
    });
    const stopWatch = fs.watch();
    return () => {
      stopStatus();
      stopWatch();
    };
  }, [fs]);

  const sameTimes = (a: FileTimes, b: FileTimes) =>
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((p) => a[p] === b[p]);

  const reload = useCallback(async () => {
    // Read the times before the files: if a file changes in between, the
    // older time makes the next save reload it again, which is safe.
    const before = await fileTimes(fs, loadedRef.current);
    const next = await loadPack(fs);
    if (fs instanceof QueuedFs) fs.eventsMode = next.pack.progress === 'events';
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
      if (busy.current || document.hidden || (outboxRef.current?.pending ?? 0) > 0) return;
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

  const log = useCallback(
    async (event: EventInput) => {
      await appendEvent(fs, event);
      // Our own line must not look like another device's change.
      if (eventsMode() && !(fs instanceof QueuedFs)) times.current = { ...times.current, [EVENTS_PATH]: await fs.mtime(EVENTS_PATH) };
    },
    [fs],
  );

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
      // In a migrated pack the progress always comes from the events, whatever the file says.
      const view = (x: Subject) => (eventsMode() ? replaySubject(x, progressEvents()) : x);
      // Show the change at once; the saved version may differ if the file changed on disk.
      const optimistic = withSubject(current, view(change(before)));
      setLoaded(optimistic);
      loadedRef.current = optimistic;
      busy.current++;
      try {
        const { value: saved, reloaded } = await updateSubjectFile(fs, before, times.current[path], change, view);
        times.current = { ...times.current, [path]: await fs.mtime(path) };
        const value = view(saved);
        if (reloaded || eventsMode()) {
          const next = withSubject(loadedRef.current, value);
          loadedRef.current = next;
          setLoaded(next);
          if (reloaded) setNotice('This subject was changed outside the app (e.g. new cards). Your change was added to the new version.');
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

  const record = useCallback<PackApi['record']>(
    async (subjectId, ops, event, on = today()) => {
      // A pack migrated while this tab was open: notice it before writing the old way.
      if (!eventsMode() && fs.kind === 'server') {
        const known = times.current['pack.json'];
        if (known !== undefined && (await fs.mtime('pack.json')) !== known) await reload();
      }
      const settings = loadedRef.current.pack.settings;
      const actor = event?.actor;
      const events = ops.map((op) => progressEvent(subjectId, op, on, settings, actor ? { actor } : {}));
      if (!ops.length) {
        if (event) await log({ subject: subjectId, ...event });
        return [];
      }
      if (!eventsMode()) {
        // Not migrated: the same code changes the subject file, as before.
        await updateSubject(subjectId, (s) => events.reduce((acc, e) => applyEvent(acc, e, fileReplay.current), s), event);
        return events.map((e) => e.id);
      }
      const current = loadedRef.current;
      const all = [...(current.progress?.events ?? []), ...events];
      const next: LoadedPack = {
        ...current,
        progress: { events: all, skipped: current.progress?.skipped ?? 0 },
        subjects: current.subjects.map((s) => (s.id === subjectId ? replaySubject(s, all) : s)),
      };
      loadedRef.current = next;
      setLoaded(next);
      try {
        const { mtime } = await appendEventsTo(fs, events);
        if (!(fs instanceof QueuedFs)) times.current = { ...times.current, [EVENTS_PATH]: mtime };
        if (event) await log({ subject: subjectId, ...event });
      } catch (e) {
        // Only backends without an outbox get here (a local folder that went away).
        setNotice(`Saving failed: ${(e as Error).message}`);
        const back = { ...loadedRef.current, progress: current.progress, subjects: loadedRef.current.subjects.map((s) => (s.id === subjectId ? replaySubject(s, current.progress?.events ?? []) : s)) };
        loadedRef.current = back;
        setLoaded(back);
      }
      return events.map((e) => e.id);
    },
    [fs, reload, updateSubject, log],
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
      record,
      outbox,
      log,
      reload,
      close: props.onClose,
      ai,
      setAi,
      notice,
      setNotice,
    }),
    [fs, loaded, updateSubject, updatePack, record, outbox, log, reload, ai, setAi, notice, props.onClose],
  );

  return <Ctx.Provider value={api}>{props.children}</Ctx.Provider>;
}
