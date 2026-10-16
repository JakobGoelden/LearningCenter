// Decorative SVG marks. Purely visual: every one is aria-hidden.

/** Torii gate, the dojo symbol. Uses currentColor. */
export function Torii({ class: cls, size }: { class?: string; size?: number }) {
  return (
    <svg class={cls} width={size} height={size} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      {/* kasagi: the curved top beam */}
      <path d="M4 10c9 3 19 4.5 28 4.5S51 13 60 10l-1.6 6.5c-8 2.3-17.3 3.5-26.4 3.5S13.6 18.8 5.6 16.5z" />
      {/* nuki: the lower beam */}
      <rect x="9" y="25" width="46" height="5" rx="1" />
      {/* gakuzuka: the centre post between the beams */}
      <rect x="29.5" y="19" width="5" height="7" />
      {/* hashira: the two pillars, widening towards the ground */}
      <path d="M15 19h6l1.5 41h-9z" />
      <path d="M43 19h6l1.5 41h-9z" />
    </svg>
  );
}

/** Ensō: a brush circle, drawn open at the top right. Uses currentColor. */
export function Enso({ class: cls }: { class?: string }) {
  return (
    <svg class={cls} viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <path
        d="M150 38c-17-14-41-20-64-15C47 31 22 66 28 106c6 38 43 66 82 62 40-4 68-40 63-80-2-13-7-24-15-33"
        stroke="currentColor"
        stroke-width="15"
        stroke-linecap="round"
      />
      <path d="M155 44c-6-7-13-12-20-16" stroke="currentColor" stroke-width="7" stroke-linecap="round" opacity="0.6" />
    </svg>
  );
}

/** App logo: an open book with a rising arc. */
export function Logo() {
  return (
    <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="lc-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#5b7bff" />
          <stop offset="1" stop-color="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lc-logo)" />
      <path d="M7 11.5c3-1.3 6-1.1 9 .9v11c-3-2-6-2.2-9-.9zM25 11.5c-3-1.3-6-1.1-9 .9v11c3-2 6-2.2 9-.9z" fill="#fff" opacity="0.95" />
      <path d="M10 8.5c3.7-2.5 8.3-2.5 12 0" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.8" />
    </svg>
  );
}

const BELTS = [
  { name: 'White belt', color: '#f1f0ea', ink: '#1c1b22' },
  { name: 'White belt', color: '#f1f0ea', ink: '#1c1b22' },
  { name: 'Yellow belt', color: '#f5c518', ink: '#1c1b22' },
  { name: 'Green belt', color: '#2f9e44', ink: '#fff' },
  { name: 'Brown belt', color: '#8a5a2b', ink: '#fff' },
  { name: 'Black belt', color: '#16151b', ink: '#fff' },
];

/** Belt rank for a round score 0–5. */
export function beltFor(score: number) {
  return BELTS[Math.max(0, Math.min(5, Math.round(score)))];
}

/** A tied belt in the rank's colour. */
export function Belt({ score }: { score: number }) {
  const b = beltFor(score);
  return (
    <svg class="belt" viewBox="0 0 120 60" aria-hidden="true">
      <rect x="4" y="16" width="112" height="16" rx="3" fill={b.color} stroke="rgb(0 0 0 / 0.25)" />
      <path d="M52 30l-14 26 9 1 13-22z" fill={b.color} stroke="rgb(0 0 0 / 0.25)" />
      <path d="M68 30l14 26-9 1-13-22z" fill={b.color} stroke="rgb(0 0 0 / 0.25)" />
      <rect x="50" y="12" width="20" height="24" rx="4" fill={b.color} stroke="rgb(0 0 0 / 0.3)" />
      {score >= 5 && <rect x="88" y="16" width="16" height="16" fill="#c92a2a" />}
    </svg>
  );
}

/** Circular countdown. `fraction` is the share of time left (0–1). */
export function TimerRing({ fraction, label, urgent }: { fraction: number; label: string; urgent?: boolean }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <span class={`timer-ring${urgent ? ' urgent' : ''}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={r} class="track" />
        <circle cx="24" cy="24" r={r} class="arc" stroke-dasharray={c} stroke-dashoffset={c * (1 - Math.max(0, Math.min(1, fraction)))} />
      </svg>
      <span class="mono">{label}</span>
    </span>
  );
}
