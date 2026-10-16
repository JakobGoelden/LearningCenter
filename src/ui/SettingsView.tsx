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
      setNotice('Die Leiter braucht mindestens zwei Abstände in Tagen, z.B. 1, 3, 7, 14.');
      return;
    }
    void savePackSettings({ reviewLadder: [...new Set(values)].sort((a, b) => a - b) });
  };

  const importInto = async () => {
    const text = await pickTextFile();
    if (!text) return;
    if (!confirm(`Dateien aus dem Import überschreiben gleichnamige Dateien in „${fs.label}“. Fortfahren?`)) return;
    try {
      await importBundle(fs, JSON.parse(text));
      await reload();
      setNotice('Import abgeschlossen.');
    } catch (e) {
      setNotice(`Import fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  return (
    <div class="stack">
      <div class="page-head">
        <a href={href({ name: 'dashboard' })}>← Dashboard</a>
        <h1>Einstellungen</h1>
      </div>

      <section class="panel stack">
        <h2>KI-Anbindung</h2>
        {ADAPTERS.map((a) => (
          <label class="row" style="align-items:flex-start;gap:10px">
            <input type="radio" name="adapter" checked={ai.adapter === a.id} onChange={() => set({ adapter: a.id })} />
            <span>
              <strong>{a.label}</strong>
              <div class="small muted">{a.description}</div>
              {a.id === 'file-bridge' && !fs.sharedWithAi && (
                <div class="small" style="color:var(--warn)">
                  Das aktuelle Pack liegt im Browser. Für die Datei-Brücke einen Pack-Ordner öffnen.
                </div>
              )}
            </span>
          </label>
        ))}

        {ai.adapter === 'api' && (
          <div class="stack" style="border-top:1px solid var(--border);padding-top:12px">
            <label class="field">
              <span>Anbieter</span>
              <select
                value={ai.provider}
                onChange={(e) => {
                  const provider = e.currentTarget.value as Provider;
                  set({ provider, model: DEFAULT_MODELS[provider] || ai.model });
                }}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai-compatible">OpenAI-kompatibel (OpenAI, OpenRouter, Ollama, …)</option>
              </select>
            </label>
            {ai.provider === 'openai-compatible' && (
              <label class="field">
                <span>Basis-URL</span>
                <input value={ai.baseUrl} onChange={(e) => set({ baseUrl: e.currentTarget.value })} placeholder="https://api.openai.com/v1" />
              </label>
            )}
            <label class="field">
              <span>API-Schlüssel</span>
              <input type="password" autoComplete="off" value={ai.apiKey} onChange={(e) => set({ apiKey: e.currentTarget.value.trim() })} />
              <span class="small">
                Wird nur in diesem Browser gespeichert (localStorage), nie im Pack und nie im Export.
              </span>
            </label>
            <label class="field">
              <span>Modell</span>
              <input value={ai.model} onChange={(e) => set({ model: e.currentTarget.value.trim() })} />
            </label>
            {ai.provider === 'anthropic' && (
              <label class="field">
                <span>Denktiefe (effort)</span>
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
            <span>Inbox prüfen alle … Sekunden</span>
            <input type="number" min={1} max={60} value={ai.pollSeconds} onChange={(e) => set({ pollSeconds: Math.max(1, Number(e.currentTarget.value) || 2) })} />
          </label>
        )}
      </section>

      <section class="panel stack">
        <h2>Lernplan</h2>
        <label class="field">
          <span>Abstände in Tagen (Spaced Repetition)</span>
          <div class="row">
            <input value={ladder} onInput={(e) => setLadder(e.currentTarget.value)} style="flex:1" />
            <button onClick={saveLadder}>Speichern</button>
          </div>
          <span class="small">Gut beantwortete Themen gehen eine Stufe weiter, unsichere bleiben bei den ersten Stufen.</span>
        </label>
        <label class="row">
          <input type="checkbox" checked={settings.skipWeekends ?? true} onChange={(e) => savePackSettings({ skipWeekends: e.currentTarget.checked })} />
          Keine Abfragen am Wochenende (auf Montag schieben)
        </label>
        <div class="row">
          <label class="field">
            <span>Fragen pro Abfrage</span>
            <input
              type="number"
              min={1}
              max={30}
              value={settings.questionsPerQuiz ?? 5}
              onChange={(e) => savePackSettings({ questionsPerQuiz: Math.min(30, Math.max(1, Number(e.currentTarget.value) || 5)) })}
            />
          </label>
          <label class="field">
            <span>Sprache der KI</span>
            <select value={settings.language ?? 'de'} onChange={(e) => savePackSettings({ language: e.currentTarget.value })}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      </section>

      <section class="panel stack">
        <h2>Daten</h2>
        <div class="small muted">
          Gespeichert in: {fs.kind === 'browser' ? 'diesem Browser (IndexedDB)' : `Ordner „${fs.label}“`}.
        </div>
        <div class="row">
          <button onClick={async () => downloadText(`${loaded.pack.id}-${today()}.pack.json`, toJson(await exportBundle(fs)))}>
            Als Datei exportieren
          </button>
          <button onClick={importInto}>Datei importieren …</button>
          <button onClick={() => reload().then(() => setNotice('Neu geladen.'))}>Neu laden</button>
        </div>
      </section>
    </div>
  );
}
