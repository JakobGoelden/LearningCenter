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
      if (!(await fs.isEmpty()) && !confirm('This replaces the pack stored in the browser. Continue?')) return;
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
            A dashboard for your semester. All data lives as JSON in a learning pack that you or an AI maintain.
          </p>
        </div>
        {(props.error || error) && <div class="error">{props.error || error}</div>}

        <div class="panel stack setup-hint">
          <strong>New here? Let an AI set you up.</strong>
          <span class="small">
            Open this folder in Claude Code (or another AI tool) and say <em>"Set me up."</em> It gets your scripts, timetable,
            exercise sheets and notes in together with you, builds topics and dojos from them, and starts the app with your own
            pack.
          </span>
        </div>

        {options.rememberedFolder && (
          <button
            class="choice primary"
            onClick={run(async () => {
              const fs = await options.rememberedFolder!.reconnect();
              if (fs) await props.onOpen(fs);
            })}
          >
            <strong>Continue with folder "{options.rememberedFolder.name}"</strong>
          </button>
        )}
        {options.hasBrowserPack && (
          <button class="choice" onClick={run(() => props.onOpen(new BrowserFs()))}>
            <strong>Continue with the pack in this browser</strong>
            <small>Last saved in this browser.</small>
          </button>
        )}

        <h3>Open a pack</h3>
        {folderAccessSupported() ? (
          <button class="choice" onClick={run(async () => props.onOpen(await FolderFs.pick()))}>
            <strong>Open pack folder …</strong>
            <small>
              The app reads and writes the folder directly. This also enables the file bridge to Claude Code.
            </small>
          </button>
        ) : (
          <div class="panel small muted">
            This browser cannot open folders (Chrome and Edge can). Works in every browser: run{' '}
            <code>LC_PACK_DIR=local/my-pack npm run dev</code> in the repo.
          </div>
        )}
        <button
          class="choice"
          onClick={run(async () => {
            const text = await pickTextFile('.json,application/json');
            if (text) await intoBrowser(JSON.parse(text))();
          })}
        >
          <strong>Import pack file …</strong>
          <small>Load an exported .pack.json into browser storage.</small>
        </button>

        <h3>Start fresh</h3>
        <button class="choice" onClick={intoBrowser(demoBundle())}>
          <strong>Try the demo</strong>
          <small>Two subjects with topics, exercise sheets and dojos, stored in this browser.</small>
        </button>
        <button class="choice" onClick={intoBrowser(emptyBundle())}>
          <strong>Empty pack in this browser</strong>
          <small>
            For your own pack as a folder: copy <code>packs/empty</code> to <code>local/</code> and open it above.
          </small>
        </button>
      </div>
    </div>
  );
}
