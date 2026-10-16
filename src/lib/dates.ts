import type { ISODate } from '../model/types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Parses YYYY-MM-DD as a UTC date so day arithmetic ignores DST. */
function utc(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: ISODate): number {
  return utc(date).getUTCDay();
}

export function isISODate(s: unknown): s is ISODate {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** "Mo 19.10." */
export function formatShort(date: ISODate): string {
  const [, m, d] = date.split('-');
  return `${WEEKDAYS[weekday(date)]} ${d}.${m}.`;
}

/** "heute", "morgen", "in 5 Tagen", "vor 2 Tagen" */
export function relative(date: ISODate, ref: ISODate = today()): string {
  const n = diffDays(ref, date);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  if (n > 0) return `in ${n} Tagen`;
  return `vor ${-n} Tagen`;
}
