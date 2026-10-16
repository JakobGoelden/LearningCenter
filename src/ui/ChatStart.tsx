import { useEffect, useState } from 'preact/hooks';

/** Copies text, with a fallback for browsers that block the clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/**
 * "Start in chat": copies a prompt that runs the same thing in the person's AI
 * chat (handy for voice input). If copying fails, the prompt is shown to copy by hand.
 */
export function ChatStart({
  prompt,
  label = 'Start in chat',
  class: cls = '',
  disabled,
  separate,
}: {
  prompt: () => string;
  label?: string;
  class?: string;
  disabled?: boolean;
  /** Set apart from the start button: an "or" divider and its own dashed box. */
  separate?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [text, setText] = useState('');
  useEffect(() => {
    if (state !== 'copied') return;
    const t = window.setTimeout(() => setState('idle'), 6000);
    return () => window.clearTimeout(t);
  }, [state]);

  const go = async () => {
    const p = prompt();
    setText(p);
    setState((await copyText(p)) ? 'copied' : 'manual');
  };

  const body = (
    <span class={`chat-start ${cls}`}>
      <button type="button" class={`chat-start-btn${state === 'copied' ? ' done' : ''}`} onClick={go} disabled={disabled} title="Copies a prompt: paste it into your AI chat (e.g. Claude) and do it there, voice included">
        <span aria-hidden="true">{state === 'copied' ? '✓' : '💬'}</span> {state === 'copied' ? 'Prompt copied' : label}
      </button>
      {state === 'copied' && (
        <span class="chat-start-hint small muted" role="status">
          Paste it into your AI chat.
        </span>
      )}
      {state === 'manual' && (
        <span class="chat-start-manual stack">
          <span class="small muted">Copy this prompt into your AI chat:</span>
          <textarea readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
        </span>
      )}
    </span>
  );
  if (!separate) return body;
  return (
    <span class="chat-alt">
      <span class="chat-alt-or" aria-hidden="true">
        or
      </span>
      <span class="chat-alt-box">
        {body}
        {state === 'idle' && <span class="chat-alt-note small muted">in your AI chat, voice included</span>}
      </span>
    </span>
  );
}
