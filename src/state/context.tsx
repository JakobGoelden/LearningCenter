import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LoadedPack, LogEvent, Pack, Subject } from '../model/types';
import type { PackFs } from '../storage/fs';
import { appendEvent, fingerprint, loadPack, savePack, saveSubject } from '../storage/repo';
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
  const print = useRef<string>('');
  const busy = useRef(0);

  const refreshPrint = useCallback(async (l: LoadedPack) => {
    print.current = await fingerprint(fs, l);
  }, [fs]);

  useEffect(() => {
    void refreshPrint(props.initial);
  }, []);

  const reload = useCallback(async () => {
    const next = await loadPack(fs);
    setLoaded(next);
    await refreshPrint(next);
  }, [fs, refreshPrint]);

  // Pick up edits made outside the app, e.g. by Claude Code in the pack folder.
  useEffect(() => {
    if (!fs.sharedWithAi) return;
    const timer = setInterval(async () => {
      if (busy.current || document.hidden) return;
      try {
        const now = await fingerprint(fs, loadedRef.current);
        if (now !== print.current) {
          await reload();
          setNotice('Pack wurde außerhalb der App geändert und neu geladen.');
        }
      } catch (e) {
        setNotice(`Neu laden fehlgeschlagen: ${(e as Error).message}`);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [fs, reload]);

  const log = useCallback((event: EventInput) => appendEvent(fs, event), [fs]);

  const updateSubject = useCallback<PackApi['updateSubject']>(
    async (id, change, event) => {
      const current = loadedRef.current;
      const before = current.subjects.find((s) => s.id === id);
      if (!before) throw new Error(`Unbekanntes Fach: ${id}`);
      const after = change(before);
      const next = { ...current, subjects: current.subjects.map((s) => (s.id === id ? after : s)) };
      setLoaded(next);
      loadedRef.current = next;
      busy.current++;
      try {
        await saveSubject(fs, after);
        if (event) await appendEvent(fs, { subject: id, ...event });
        await refreshPrint(next);
      } catch (e) {
        setNotice(`Speichern fehlgeschlagen: ${(e as Error).message}`);
        setLoaded(current);
      } finally {
        busy.current--;
      }
    },
    [fs, refreshPrint],
  );

  const updatePack = useCallback<PackApi['updatePack']>(
    async (change, event) => {
      const current = loadedRef.current;
      const next = { ...current, pack: change(current.pack) };
      setLoaded(next);
      loadedRef.current = next;
      busy.current++;
      try {
        await savePack(fs, next.pack);
        if (event) await appendEvent(fs, event);
        await refreshPrint(next);
      } catch (e) {
        setNotice(`Speichern fehlgeschlagen: ${(e as Error).message}`);
        setLoaded(current);
      } finally {
        busy.current--;
      }
    },
    [fs, refreshPrint],
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
