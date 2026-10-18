import { useCallback, useEffect, useState } from 'preact/hooks';
import type { LoadedPack } from '../model/types';
import type { PackFs } from '../storage/fs';
import { loadPack } from '../storage/repo';
import { PackProvider, usePack } from '../state/context';
import { detectStartup, rememberSource, type StartupOptions } from '../state/source';
import { useRoute } from './router';
import { StartScreen } from './StartScreen';
import { Header } from './Header';
import { Dashboard } from './Dashboard';
import { TopicsView } from './TopicsView';
import { SubjectView } from './SubjectView';
import { SheetView } from './SheetView';
import { QuizView } from './QuizView';
import { DojoView } from './DojoView';
import { SettingsView } from './SettingsView';
import { LogView } from './LogView';
import { EndlessView } from './EndlessView';
import { StudyView } from './StudyView';

type Open = { fs: PackFs; loaded: LoadedPack };

export function App() {
  const [startup, setStartup] = useState<StartupOptions | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openFs = useCallback(async (fs: PackFs) => {
    setError(null);
    try {
      const loaded = await loadPack(fs);
      rememberSource(fs.kind);
      setOpen({ fs, loaded });
    } catch (e) {
      setError(`Could not load the pack from "${fs.label}":\n${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    detectStartup().then(async (s) => {
      setStartup(s);
      if (s.auto) await openFs(s.auto);
    });
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    detectStartup().then(setStartup);
  }, []);

  if (!startup) return <div class="wrap muted">Loading …</div>;
  if (!open) return <StartScreen options={startup} onOpen={openFs} error={error} />;
  return (
    <PackProvider key={open.fs.label + open.fs.kind} fs={open.fs} initial={open.loaded} onClose={close}>
      <Shell />
    </PackProvider>
  );
}

/** Remounting <main> per page replays the page entrance. */
const routeKey = (r: ReturnType<typeof useRoute>) => Object.values(r).join('/');

function Shell() {
  const route = useRoute();
  const { notice, setNotice } = usePack();
  return (
    <div class="wrap">
      <Header />
      {notice && (
        <div class="notice" role="status">
          <span style="flex:1">{notice}</span>
          <button class="ghost small" onClick={() => setNotice(null)} aria-label="Dismiss notice">
            ✕
          </button>
        </div>
      )}
      <main key={routeKey(route)} class="page">
        {route.name === 'dashboard' && <Dashboard />}
        {route.name === 'subject' && <SubjectView subjectId={route.subject} />}
        {route.name === 'sheet' && <SheetView key={`${route.subject}/${route.sheet}`} subjectId={route.subject} sheetId={route.sheet} />}
        {route.name === 'topics' && <TopicsView subjectId={route.subject} />}
        {route.name === 'quiz' && <QuizView key={`${route.subject}/${route.ahead ?? ''}`} subjectId={route.subject} ahead={route.ahead} />}
        {route.name === 'endless' && <EndlessView key={route.subject} subjectId={route.subject} />}
        {route.name === 'dojo' && <DojoView key={`${route.subject}/${route.dojo}`} subjectId={route.subject} dojoId={route.dojo} />}
        {route.name === 'settings' && <SettingsView />}
        {route.name === 'log' && <LogView />}
        {route.name === 'study' && <StudyView />}
      </main>
    </div>
  );
}
