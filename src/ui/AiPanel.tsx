import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import type { AiRequest, AiResponse } from '../model/types';
import { finalizeResponse } from '../ai/response';
import { sendViaFileBridge, INBOX, OUTBOX } from '../ai/file-bridge';
import { sendViaApi } from '../ai/api';
import { copyPromptText, parsePasted } from '../ai/copy-prompt';
import type { AdapterId } from '../ai/settings';
import { href } from './router';

interface Pending {
  req: AiRequest;
  mode: AdapterId;
  resolve(r: AiResponse): void;
  reject(e: Error): void;
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}

/**
 * Runs AI requests through the adapter chosen in the settings and renders the
 * matching panel (waiting for Claude Code, waiting for the API, or copy/paste).
 */
export function useAi() {
  const { fs, ai, log } = usePack();
  const [pending, setPending] = useState<Pending | null>(null);

  const run = useCallback(
    (req: AiRequest) =>
      new Promise<AiResponse>((resolve, reject) => {
        const mode: AdapterId = ai.adapter === 'file-bridge' && !fs.sharedWithAi ? 'copy-prompt' : ai.adapter;
        void log({ type: 'ai.request', subject: req.subject, ref: req.id, actor: 'app', data: { kind: req.kind, adapter: mode, summary: req.summary } });
        setPending({
          req,
          mode,
          resolve: (r) => {
            setPending(null);
            void log({ type: 'ai.response', subject: req.subject, ref: req.id, actor: 'ai', data: { kind: req.kind } });
            resolve(r);
          },
          reject: (e) => {
            setPending(null);
            reject(e);
          },
        });
      }),
    [ai.adapter, fs, log],
  );

  const panel = pending ? (
    <AiPanel
      key={pending.req.id + pending.mode}
      pending={pending}
      switchMode={(mode) => setPending({ ...pending, mode })}
      bridgeUnavailable={ai.adapter === 'file-bridge' && !fs.sharedWithAi}
    />
  ) : null;

  return { run, busy: pending !== null, panel };
}

function AiPanel(props: { pending: Pending; switchMode(m: AdapterId): void; bridgeUnavailable: boolean }) {
  const { fs, ai } = usePack();
  const { req, mode, resolve, reject } = props.pending;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const accept = (raw: unknown) => {
    try {
      resolve(finalizeResponse(req, raw));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (mode === 'copy-prompt') return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    const p = mode === 'file-bridge' ? sendViaFileBridge(fs, req, ctrl.signal, ai.pollSeconds) : sendViaApi(req, ai, ctrl.signal);
    p.then(accept, (e: Error) => {
      if (!ctrl.signal.aborted) setError(e.message);
    });
    return () => ctrl.abort();
  }, [mode, attempt]);

  const cancel = () => {
    abort.current?.abort();
    reject(new Cancelled());
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyPromptText(req));
      setCopied(true);
    } catch {
      setError('Copying is not allowed here. Select the text and copy it by hand.');
    }
  };

  return (
    <div class="panel ai-panel stack" role="status" aria-live="polite">
      <div class="row">
        <strong style="flex:1">{req.summary}</strong>
        <button class="small ghost" onClick={cancel}>
          Cancel
        </button>
      </div>

      {mode === 'file-bridge' && (
        <div class="stack small">
          <div class="row">
            <span class="spinner" /> Waiting for Claude Code …
          </div>
          <div>
            The request is in <code>{`${INBOX}/${req.id}.json`}</code>. In the pack folder, run{' '}
            <code>claude "Process the inbox"</code>. The answer shows up here as soon as{' '}
            <code>{`${OUTBOX}/${req.id}.json`}</code> exists.
          </div>
        </div>
      )}

      {mode === 'api' && (
        <div class="row small">
          <span class="spinner" /> Asking {ai.provider === 'anthropic' ? 'Claude' : ai.model} …
        </div>
      )}

      {mode === 'copy-prompt' && (
        <div class="stack">
          {props.bridgeUnavailable && (
            <div class="small muted">
              The file bridge needs an open pack folder. Until then, use copy-prompt.
            </div>
          )}
          <div class="row small">
            <span>1. Copy the prompt and paste it into an AI chat:</span>
            <button class="small primary" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
          </div>
          <textarea class="mono" readOnly value={req.prompt} style="min-height:100px" aria-label="Prompt" />
          <span class="small">2. Paste the AI's answer (the JSON) here:</span>
          <textarea class="mono" value={pasted} onInput={(e) => setPasted(e.currentTarget.value)} aria-label="AI answer" />
          <div class="row">
            <button
              class="primary"
              disabled={!pasted.trim()}
              onClick={() => {
                try {
                  accept(parsePasted(pasted));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Use answer
            </button>
          </div>
        </div>
      )}

      {error && (
        <div class="stack">
          <div class="error">{error}</div>
          <div class="row">
            {mode !== 'copy-prompt' && (
              <button class="small" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
            )}
            {mode !== 'copy-prompt' && (
              <button class="small" onClick={() => props.switchMode('copy-prompt')}>
                Use copy-prompt instead
              </button>
            )}
            {mode === 'api' && (
              <a class="btn small" href={href({ name: 'settings' })}>
                Settings
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
