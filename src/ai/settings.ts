export type AdapterId = 'file-bridge' | 'api' | 'copy-prompt';
export type Provider = 'anthropic' | 'openai-compatible';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiSettings {
  adapter: AdapterId;
  provider: Provider;
  /** Stored only in this browser's localStorage, never in the pack. */
  apiKey: string;
  model: string;
  effort: Effort;
  /** For openai-compatible providers, e.g. https://api.openai.com/v1 or http://localhost:11434/v1 */
  baseUrl: string;
  pollSeconds: number;
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-5-5',
  'openai-compatible': '',
};

export const DEFAULT_SETTINGS: AiSettings = {
  adapter: 'copy-prompt',
  provider: 'anthropic',
  apiKey: '',
  model: DEFAULT_MODELS.anthropic,
  effort: 'medium',
  baseUrl: 'https://api.openai.com/v1',
  pollSeconds: 2,
};

const KEY = 'learningcenter.ai';

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AiSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAiSettings(s: AiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: settings last for this page only.
  }
}

export const ADAPTERS: { id: AdapterId; label: string; description: string }[] = [
  {
    id: 'file-bridge',
    label: 'Datei-Brücke (Claude Code)',
    description:
      'Schreibt die Anfrage nach inbox/. Claude Code (oder eine andere lokale KI) beantwortet sie in outbox/. Braucht einen geöffneten Pack-Ordner.',
  },
  {
    id: 'api',
    label: 'API',
    description: 'Fragt direkt mit deinem eigenen API-Schlüssel. Der Schlüssel bleibt in diesem Browser.',
  },
  {
    id: 'copy-prompt',
    label: 'Copy-Prompt',
    description: 'Erzeugt einen fertigen Prompt für jeden KI-Chat. Die Antwort fügst du wieder ein.',
  },
];
