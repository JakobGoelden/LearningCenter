import { useEffect, useRef } from 'preact/hooks';

type Field = HTMLInputElement | HTMLTextAreaElement;
const isField = (el: Element | null): el is Field =>
  !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', ''].includes(el.type)));

/**
 * A row of formula symbol buttons. A click types the symbol at the cursor of
 * the text field that was focused last inside the closest `[data-symbols]`
 * element (or its first field), and keeps the focus there.
 */
export function SymbolBar({ symbols }: { symbols: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<Field | null>(null);

  useEffect(() => {
    const scope = ref.current?.closest('[data-symbols]');
    if (!scope) return;
    const onFocus = (e: Event) => {
      if (isField(e.target as Element)) last.current = e.target as Field;
    };
    scope.addEventListener('focusin', onFocus);
    return () => scope.removeEventListener('focusin', onFocus);
  }, []);

  if (!symbols.length) return null;

  const type = (sym: string) => {
    const scope = ref.current?.closest('[data-symbols]');
    const active = document.activeElement;
    const el =
      (isField(active) && scope?.contains(active) ? active : null) ??
      (last.current?.isConnected ? last.current : null) ??
      (scope?.querySelector<Field>('textarea, input:not([type]), input[type=text]') ?? null);
    if (!el || el.disabled || el.readOnly) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.focus();
    el.setRangeText(sym, start, end, 'end');
    // Let the controlled component pick up the new value.
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  return (
    <div class="symbol-bar" ref={ref} role="toolbar" aria-label="Formula symbols">
      {symbols.map((s) => (
        <button
          type="button"
          class="symbol-key"
          title={`Type ${s}`}
          // Keep the cursor in the text field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => type(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
