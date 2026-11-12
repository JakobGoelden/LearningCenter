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
import { applyEvent, newReplayState, progressEvent, replaySubject, type ProgressEvent, type ProgressOp } from '../progress/ops';
import { DevFs } from '../storage/dev-fs';
import { today } from '../lib/dates';
import { loadAiSettings, saveAiSettings, type AiSettings } from '../ai/settings';

type EventInput = Omit<LogEvent, 'ts'>;

export interface PackApi {
  fs: PackFs;
  loaded: LoadedPack;
  subject(id: string): Subject | undefined;
  /** Applies `change` to a subject, saves it and logs `event`. False when saving failed (the change is undone). */
  updateSubject(id: string, change: (s: Subject) => Subject, event?: EventInput): Promise<boolean>;
  updatePack(change: (p: Pack) => Pack, event?: EventInput): Promise<boolean>;
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
  /** Appends to the log one after another: a local folder or the browser store cannot append atomically. */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const serially = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(job, job);
    chain.current = run.catch(() => undefined);
    return run;
  };
  /**
   * After our own append: take the log's new time as known only if nobody else
   * wrote in between (its time before our write is the one we knew); otherwise
   * leave it, so the next look reloads and shows the other device's answers.
   */
  const ownLogWrite = (before: number | null | undefined, after: number | null) => {
    if (!eventsMode()) return;
    const known = times.current[EVENTS_PATH];
    if (before === undefined || known === undefined || before === known) times.current = { ...times.current, [EVENTS_PATH]: after };
  };
  const lastSend = useRef(0);
  const looking = useRef(false);

  // The outbox of a server pack: its count for the header, and the log's time after each send.
  useEffect(() => {
    if (!(fs instanceof QueuedFs)) return;
    const stopStatus = fs.onStatus((st) => {
      outboxRef.current = st;
      setOutbox(st);
      // Each send once: a later status (count, problem) carries the same, old numbers.
      if (st.sends && st.sends !== lastSend.current) {
        lastSend.current = st.sends;
        if (st.logMtime !== undefined) ownLogWrite(st.logBefore, st.logMtime);
      }
    });
    const stopWatch = fs.watch();
    return () => {
      stopStatus();
      stopWatch();
    };
  }, [fs]);

  const sameTimes = (a: FileTimes, b: FileTimes) =>
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((p) => a[p] === b[p]);

  /** `base` with events recorded on this device that it lacks (they may still be on the way), replayed. */
  const withLocalEvents = (base: LoadedPack): LoadedPack => {
    if (base.pack.progress !== 'events' || !base.progress) return base;
    const have = new Set(base.progress.events.map((e) => e.id));
    const missing = progressEvents().filter((e) => !have.has(e.id));
    if (!missing.length) return base;
    const events = [...base.progress.events, ...missing];
    const touched = new Set(missing.map((e) => e.subject));
    return {
      ...base,
      progress: { ...base.progress, events },
      subjects: base.subjects.map((s) => (touched.has(s.id) ? replaySubject(s, events) : s)),
    };
  };

  /** The reload in flight: a second call joins it instead of starting another. */
  const reloading = useRef<Promise<void> | null>(null);

  const reload = useCallback((): Promise<void> => {
    reloading.current ??= loadAgain().finally(() => {
      reloading.current = null;
    });
    return reloading.current;
  }, [fs]);

  const loadAgain = async () => {
    // Read the times before the files: if a file changes in between, the
    // older time makes the next save reload it again, which is safe.
    const before = await fileTimes(fs, loadedRef.current);
    if (fs instanceof DevFs || fs instanceof QueuedFs) fs.takeCached();
    const loadedNow = await loadPack(fs);
    if (fs instanceof QueuedFs) fs.eventsMode = loadedNow.pack.progress === 'events';
    const after = await fileTimes(fs, loadedNow);
    const t: FileTimes = Object.fromEntries(Object.keys(after).map((p) => [p, p in before ? before[p] : after[p]]));
    // Files that came from the offline copy may be old: unknown time, so the next look reloads them.
    if (fs instanceof DevFs || fs instanceof QueuedFs) for (const p of fs.takeCached().reads) if (p in t) t[p] = null;
    times.current = t;
    // Answers recorded while the files were loading are not lost from view.
    const next = withLocalEvents(loadedNow);
    loadedRef.current = next;
    setLoaded(next);
  };

  useEffect(() => {
    // `initial` was read before the times could be taken; load again so
    // content and times belong together.
    reload().catch((e) => setNotice(`Reload failed: ${(e as Error).message}`));
  }, []);

  // Pick up edits made outside the app, e.g. by Claude Code in the pack folder or the hosted sync job.
  useEffect(() => {
    if (fs.kind === 'browser') return;
    const timer = setInterval(async () => {
      // One look at a time; a reload on a slow line can take longer than the interval.
      if (looking.current || reloading.current || busy.current || document.hidden || (outboxRef.current?.pending ?? 0) > 0) return;
      looking.current = true;
      try {
        await look();
      } finally {
        looking.current = false;
      }
    }, fs.kind === 'server' ? SERVER_POLL_MS : POLL_MS);
    const look = async () => {
      const cache = fs instanceof DevFs || fs instanceof QueuedFs ? fs : null;
      cache?.takeCached();
      // A failed look is not worth a message: nothing was lost and the next one tries again.
      const now = await fileTimes(fs, loadedRef.current).catch(() => null);
      // Times from the offline copy say nothing about the server: no connection, look again later.
      if (cache && cache.takeCached().any) return;
      if (!now || sameTimes(now, times.current) || busy.current) return;
      try {
        await reload();
        setNotice('The pack was changed outside the app and has been reloaded.');
      } catch (e) {
        setNotice(`Reload failed: ${(e as Error).message}`);
      }
    };
    return () => clearInterval(timer);
  }, [fs, reload]);

  const log = useCallback(
    (event: EventInput) =>
      serially(async () => {
        const watch = eventsMode() && !(fs instanceof QueuedFs);
        const before = watch ? await fs.mtime(EVENTS_PATH) : undefined;
        await appendEvent(fs, event);
        // Our own line must not look like another device's change.
        if (watch) ownLogWrite(before, await fs.mtime(EVENTS_PATH));
      }),
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
        // Replayed with the events as they are now (answers may have come in while saving).
        const value = view(saved);
        if (reloaded || eventsMode()) {
          const next = withSubject(loadedRef.current, value);
          loadedRef.current = next;
          setLoaded(next);
          if (reloaded) setNotice('This subject was changed outside the app (e.g. new cards). Your change was added to the new version.');
        }
        if (event) await log({ subject: id, ...event });
        return true;
      } catch (e) {
        setNotice(`Saving failed: ${(e as Error).message}`);
        // Undo only this change: answers recorded meanwhile stay.
        const back = withSubject(loadedRef.current, view(before));
        loadedRef.current = back;
        setLoaded(back);
        return false;
      } finally {
        busy.current--;
      }
    },
    [fs, log],
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
        if (event) await log(event);
        return true;
      } catch (e) {
        setNotice(`Saving failed: ${(e as Error).message}`);
        const back = { ...loadedRef.current, pack: current.pack };
        loadedRef.current = back;
        setLoaded(back);
        return false;
      } finally {
        busy.current--;
      }
    },
    [fs, log],
  );

  const record = useCallback<PackApi['record']>(
    async (subjectId, ops, event, on = today()) => {
      busy.current++;
      try {
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
        const mine = new Set(events.map((e) => e.id));
        const show = (base: LoadedPack, list: ProgressEvent[]): LoadedPack => ({
          ...base,
          progress: { events: list, skipped: base.progress?.skipped ?? 0 },
          subjects: base.subjects.map((s) => (s.id === subjectId ? replaySubject(s, list) : s)),
        });
        const next = show(loadedRef.current, [...progressEvents(), ...events]);
        loadedRef.current = next;
        setLoaded(next);
        try {
          await serially(async () => {
            const watch = !(fs instanceof QueuedFs);
            const before = watch ? await fs.mtime(EVENTS_PATH) : undefined;
            const { mtime } = await appendEventsTo(fs, events);
            if (watch) ownLogWrite(before, mtime);
          });
        } catch (e) {
          // Only backends without an outbox get here (a local folder that went away).
          setNotice(`Saving failed: ${(e as Error).message}`);
          const back = show(loadedRef.current, progressEvents().filter((x) => !mine.has(x.id)));
          loadedRef.current = back;
          setLoaded(back);
          return [];
        }
        if (event) await log({ subject: subjectId, ...event });
        return events.map((e) => e.id);
      } finally {
        busy.current--;
      }
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
