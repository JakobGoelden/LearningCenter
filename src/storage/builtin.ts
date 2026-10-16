import { addDays, diffDays, isISODate, today } from '../lib/dates';
import type { Bundle } from '../model/types';
import { bundleOf } from './repo';

// Packs shipped with the app, bundled at build time.
const demoRaw = import.meta.glob('../../packs/demo/**/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const emptyRaw = import.meta.glob('../../packs/empty/**/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The demo pack's dates are written relative to this day. */
export const DEMO_ANCHOR = '2026-10-16';

function strip(raw: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k.slice(k.indexOf(prefix) + prefix.length)] = v;
  return out;
}

/** Recursively shifts every YYYY-MM-DD string by `days`. */
export function shiftDates<T>(value: T, days: number): T {
  if (days === 0) return value;
  if (isISODate(value)) return addDays(value, days) as T;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)])) as T;
  }
  return value;
}

/** Demo pack with all dates moved so that "today" in the data is today. */
export function demoBundle(on = today()): Bundle {
  const days = diffDays(DEMO_ANCHOR, on);
  const files = strip(demoRaw, 'packs/demo/');
  for (const k of Object.keys(files)) {
    files[k] = JSON.stringify(shiftDates(JSON.parse(files[k]), days), null, 2) + '\n';
  }
  return bundleOf(files);
}

export function emptyBundle(): Bundle {
  return bundleOf(strip(emptyRaw, 'packs/empty/'));
}
