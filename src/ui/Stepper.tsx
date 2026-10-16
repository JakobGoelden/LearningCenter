import { useRef } from 'preact/hooks';

/**
 * Number picker with big − and + buttons instead of the browser's tiny arrows.
 * The value is a focusable spinbutton: arrow keys, Page Up/Down, Home and End work.
 * Holding a button keeps counting.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 30,
  step = 1,
  label,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  unit?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const current = useRef(value);
  current.current = value;
  const timer = useRef<number | undefined>();

  const bump = (d: number) => {
    const next = clamp(current.current + d);
    if (next !== current.current) {
      current.current = next;
      onChange(next);
    }
  };
  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  // Hold to repeat: first step at once, then faster and faster.
  const hold = (d: number) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stop();
    bump(d);
    // A button that hits the limit gets disabled and sees no pointerup.
    window.addEventListener('pointerup', stop, { once: true });
    let delay = 380;
    const tick = () => {
      bump(d);
      delay = Math.max(60, delay * 0.8);
      timer.current = window.setTimeout(tick, delay);
    };
    timer.current = window.setTimeout(tick, delay);
  };
  const key = (e: KeyboardEvent) => {
    const map: Record<string, () => number> = {
      ArrowUp: () => value + step,
      ArrowRight: () => value + step,
      ArrowDown: () => value - step,
      ArrowLeft: () => value - step,
      PageUp: () => value + step * 5,
      PageDown: () => value - step * 5,
      Home: () => min,
      End: () => max,
    };
    if (!map[e.key]) return;
    e.preventDefault();
    const next = clamp(map[e.key]());
    if (next !== value) onChange(next);
  };

  return (
    <div class="stepper">
      <button
        type="button"
        class="stepper-btn"
        tabIndex={-1}
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onPointerDown={hold(-step)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={(e) => e.detail === 0 && bump(-step)}
      >
        −
      </button>
      <span
        class="stepper-value"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onKeyDown={key}
      >
        <b key={value}>{value}</b>
        {unit && <small>{unit}</small>}
      </span>
      <button
        type="button"
        class="stepper-btn"
        tabIndex={-1}
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onPointerDown={hold(step)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={(e) => e.detail === 0 && bump(step)}
      >
        +
      </button>
    </div>
  );
}
