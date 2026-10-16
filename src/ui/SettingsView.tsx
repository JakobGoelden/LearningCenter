import { useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { ADAPTERS, DEFAULT_MODELS, type AiSettings, type Effort, type Provider } from '../ai/settings';
import { DEFAULT_LADDER } from '../scheduling/scheduler';
import { exportBundle, importBundle, toJson } from '../storage/repo';
import { downloadText, pickTextFile } from '../lib/download';
import { today } from '../lib/dates';
import { href } from './router';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function SettingsView() {
  const { ai, setAi, fs, loaded, updatePack, reload, setNotice } = usePack();
  const settings = loaded.pack.settings ?? {};
  const [ladder, setLadder] = useState((settings.reviewLadder ?? DEFAULT_LADDER).join(', '));
  const set = (patch: Partial<AiSettings>) => setAi({ ...ai, ...patch });

  const savePackSettings = (patch: Partial<NonNullable<typeof loaded.pack.settings>>) =>
    updatePack((p) => ({ ...p, settings: { ...p.settings, ...patch } }), { type: 'pack.settings', data: patch });

  const saveLadder = () => {
    const values = ladder
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    if (values.length < 2) {
      setNotice('The ladder needs at least two intervals in days, e.g. 1, 3, 7, 14.');
      return;
    }
    void savePackSettings({ reviewLadder: [...new Set(values)].sort((a, b) => a - b) });
  };

  const importInto = async () => {
    const text = await pickTextFile();
    if (!text) return;
    if (!confirm(`Imported files overwrite files with the same name in "${fs.label}". Continue?`)) return;
    try {
      await importBundle(fs, JSON.parse(text));
      await reload();
      setNotice('Import finished.');
    } catch (e) {
      setNotice(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div class="stack">
      <div class="page-head subject-head" data-kanji="設">
        <a href={href({ name: 'dashboard' })}>← Dashboard</a>
        <h1>Settings</h1>
      </div>

      <section class="panel stack">
        <h2>AI connection</h2>
        {ADAPTERS.map((a) => (
          <label class="row" style="align-items:flex-start;gap:10px">
            <input type="radio" name="adapter" checked={ai.adapter === a.id} onChange={() => set({ adapter: a.id })} />
            <span>
              <strong>{a.label}</strong>
              <div class="small muted">{a.description}</div>
              {a.id === 'file-bridge' && !fs.sharedWithAi && (
                <div class="small" style="color:var(--warn)">
                  The current pack lives in the browser. Open a pack folder to use the file bridge.
                </div>
              )}
            </span>
          </label>
        ))}

        {ai.adapter === 'api' && (
          <div class="stack" style="border-top:1px solid var(--border);padding-top:12px">
            <label class="field">
              <span>Provider</span>
              <select
                value={ai.provider}
                onChange={(e) => {
                  const provider = e.currentTarget.value as Provider;
                  set({ provider, model: DEFAULT_MODELS[provider] || ai.model });
                }}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai-compatible">OpenAI-compatible (OpenAI, OpenRouter, Ollama, …)</option>
              </select>
            </label>
            {ai.provider === 'openai-compatible' && (
              <label class="field">
                <span>Base URL</span>
                <input value={ai.baseUrl} onChange={(e) => set({ baseUrl: e.currentTarget.value })} placeholder="https://api.openai.com/v1" />
              </label>
            )}
            <label class="field">
              <span>API key</span>
              <input type="password" autoComplete="off" value={ai.apiKey} onChange={(e) => set({ apiKey: e.currentTarget.value.trim() })} />
              <span class="small">
                Stored only in this browser (localStorage), never in the pack or an export.
              </span>
            </label>
            <label class="field">
              <span>Model</span>
              <input value={ai.model} onChange={(e) => set({ model: e.currentTarget.value.trim() })} />
            </label>
            {ai.provider === 'anthropic' && (
              <label class="field">
                <span>Effort</span>
                <select value={ai.effort} onChange={(e) => set({ effort: e.currentTarget.value as Effort })}>
                  {EFFORTS.map((x) => (
                    <option value={x}>{x}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {ai.adapter === 'file-bridge' && (
          <label class="field" style="max-width:240px">
            <span>Check the outbox every … seconds</span>
            <input type="number" min={1} max={60} value={ai.pollSeconds} onChange={(e) => set({ pollSeconds: Math.max(1, Number(e.currentTarget.value) || 2) })} />
          </label>
        )}
      </section>

      <section class="panel stack">
        <h2>Study plan</h2>
        <label class="field">
          <span>Review intervals in days (spaced repetition)</span>
          <div class="row">
            <input value={ladder} onInput={(e) => setLadder(e.currentTarget.value)} style="flex:1" />
            <button onClick={saveLadder}>Save</button>
          </div>
          <span class="small">Topics you answer well move one step up; shaky ones stay on the first steps.</span>
        </label>
        <label class="row">
          <input type="checkbox" checked={settings.skipWeekends ?? true} onChange={(e) => savePackSettings({ skipWeekends: e.currentTarget.checked })} />
          No reviews on weekends (move them to Monday)
        </label>
        <div class="row">
          <label class="field">
            <span>Questions per quiz</span>
            <input
              type="number"
              min={1}
              max={30}
              value={settings.questionsPerQuiz ?? 5}
              onChange={(e) => savePackSettings({ questionsPerQuiz: Math.min(30, Math.max(1, Number(e.currentTarget.value) || 5)) })}
            />
          </label>
          <label class="field">
            <span>AI language</span>
            <select value={settings.language ?? 'en'} onChange={(e) => savePackSettings({ language: e.currentTarget.value })}>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </select>
          </label>
        </div>
      </section>

      <section class="panel stack">
        <h2>Data</h2>
        <div class="small muted">
          Stored in: {fs.kind === 'browser' ? 'this browser (IndexedDB)' : `folder "${fs.label}"`}.
        </div>
        <div class="row">
          <button onClick={async () => downloadText(`${loaded.pack.id}-${today()}.pack.json`, toJson(await exportBundle(fs)))}>
            Export as file
          </button>
          <button onClick={importInto}>Import file …</button>
          <button onClick={() => reload().then(() => setNotice('Reloaded.'))}>Reload</button>
        </div>
      </section>
    </div>
  );
}
