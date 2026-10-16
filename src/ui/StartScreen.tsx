import { useState } from 'preact/hooks';
import { BrowserFs } from '../storage/browser-fs';
import { FolderFs, folderAccessSupported } from '../storage/folder-fs';
import { demoBundle, emptyBundle } from '../storage/builtin';
import { importBundle } from '../storage/repo';
import type { PackFs } from '../storage/fs';
import type { StartupOptions } from '../state/source';
import { pickTextFile } from '../lib/download';

export function StartScreen(props: { options: StartupOptions; onOpen(fs: PackFs): Promise<void>; error: string | null }) {
  const { options } = props;
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError((e as Error).message);
    }
  };

  const intoBrowser = (bundle: unknown) =>
    run(async () => {
      const fs = new BrowserFs();
      if (!(await fs.isEmpty()) && !confirm('Das im Browser gespeicherte Pack wird ersetzt. Fortfahren?')) return;
      await fs.clear();
      await importBundle(fs, bundle);
      await props.onOpen(fs);
    });

  return (
    <div class="wrap">
      <div class="start stack">
        <div>
          <h1>LearningCenter</h1>
          <p class="muted">
            Ein Dashboard fürs Semester. Alle Daten liegen als JSON in einem Learning Pack, das du oder eine KI pflegt.
          </p>
        </div>
        {(props.error || error) && <div class="error">{props.error || error}</div>}

        {options.rememberedFolder && (
          <button
            class="choice primary"
            onClick={run(async () => {
              const fs = await options.rememberedFolder!.reconnect();
              if (fs) await props.onOpen(fs);
            })}
          >
            <strong>Weiter mit Ordner „{options.rememberedFolder.name}“</strong>
          </button>
        )}
        {options.hasBrowserPack && (
          <button class="choice" onClick={run(() => props.onOpen(new BrowserFs()))}>
            <strong>Weiter mit dem Pack im Browser</strong>
            <small>Zuletzt im Browser gespeichert.</small>
          </button>
        )}

        <h3>Pack öffnen</h3>
        {folderAccessSupported() ? (
          <button class="choice" onClick={run(async () => props.onOpen(await FolderFs.pick()))}>
            <strong>Pack-Ordner öffnen …</strong>
            <small>
              Die App liest und schreibt direkt im Ordner. Damit funktioniert auch die Datei-Brücke zu Claude Code.
            </small>
          </button>
        ) : (
          <div class="panel small muted">
            Dieser Browser kann keine Ordner öffnen (geht in Chrome und Edge). Alternative für alle Browser: im Repo{' '}
            <code>LC_PACK_DIR=local/mein-pack npm run dev</code> starten.
          </div>
        )}
        <button
          class="choice"
          onClick={run(async () => {
            const text = await pickTextFile('.json,application/json');
            if (text) await intoBrowser(JSON.parse(text))();
          })}
        >
          <strong>Pack-Datei importieren …</strong>
          <small>Eine exportierte .pack.json in den Browser-Speicher laden.</small>
        </button>

        <h3>Neu anfangen</h3>
        <button class="choice" onClick={intoBrowser(demoBundle())}>
          <strong>Demo ausprobieren</strong>
          <small>Zwei Fächer mit Themen, Übungsblättern und Dojos, im Browser gespeichert.</small>
        </button>
        <button class="choice" onClick={intoBrowser(emptyBundle())}>
          <strong>Leeres Pack im Browser</strong>
          <small>
            Für ein eigenes Pack als Ordner: <code>packs/empty</code> nach <code>local/</code> kopieren und oben öffnen.
          </small>
        </button>
      </div>
    </div>
  );
}
