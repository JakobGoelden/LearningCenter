import { addDays, diffDays, weekday } from '../lib/dates';
import { CLASS_LABEL, classesOn } from './derive';
import type { ISODate, LoadedPack, Subject } from './types';

export type CalendarKind = 'exam' | 'class' | 'reviews' | 'sheet';

export interface CalendarEntry {
  date: ISODate;
  subject: Subject;
  kind: CalendarKind;
  /** Short text without the subject name. */
  text: string;
  /** HH:MM for classes and exams with a time. */
  time?: string;
  end?: string;
  /** Overdue or happening very soon. */
  urgent: boolean;
  /** Topic ids for 'reviews'. */
  topics?: string[];
  /** Sheet id for 'sheet'. */
  sheet?: string;
}

const ORDER: Record<CalendarKind, number> = { exam: 0, class: 1, reviews: 2, sheet: 3 };

/** Monday of the week that contains `date`. */
export function weekStart(date: ISODate): ISODate {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** ISO 8601 week number. */
export function isoWeek(date: ISODate): number {
  const thursday = addDays(weekStart(date), 3);
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(jan1, thursday) / 7) + 1;
}

/**
 * Everything on one day: classes from the timetable, exams, reviews whose due
 * date falls on that day and sheet deadlines. On `today`, overdue reviews and
 * open sheets that are past their deadline are included as well.
 */
export function entriesOn(loaded: LoadedPack, date: ISODate, today: ISODate): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  const isToday = date === today;
  const past = date < today;
  for (const s of loaded.subjects) {
    if (s.exam.date === date) {
      out.push({ date, subject: s, kind: 'exam', text: 'Exam', time: s.exam.time, urgent: diffDays(today, date) <= 3 });
    }
    for (const c of classesOn(s, date)) {
      out.push({
        date,
        subject: s,
        kind: 'class',
        text: `${CLASS_LABEL[c.kind]}${c.location ? ` · ${c.location}` : ''}`,
        time: c.start,
        end: c.end,
        urgent: false,
      });
    }
    if (past) continue;
    const due = s.topics.filter((t) => t.status !== 'skip' && t.due && (isToday ? t.due <= date : t.due === date));
    if (due.length) {
      const overdue = isToday ? due.filter((t) => t.due! < date).length : 0;
      out.push({
        date,
        subject: s,
        kind: 'reviews',
        text: `${due.length} ${due.length === 1 ? 'review' : 'reviews'}${overdue ? ` (${overdue} overdue)` : ''}`,
        urgent: overdue > 0,
        topics: due.map((t) => t.id),
      });
    }
    for (const sh of s.sheets ?? []) {
      if (sh.status !== 'open' || !sh.due) continue;
      if (sh.due === date || (isToday && sh.due < date)) {
        out.push({
          date,
          subject: s,
          kind: 'sheet',
          text: `${sh.label}${sh.due < date ? ' (overdue)' : ''}`,
          urgent: isToday,
          sheet: sh.id,
        });
      }
    }
  }
  return out.sort(
    (a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.time ?? '').localeCompare(b.time ?? '') || a.subject.name.localeCompare(b.subject.name),
  );
}

export interface CalendarWeek {
  start: ISODate;
  week: number;
  reviews: number;
  sheets: CalendarEntry[];
  exams: CalendarEntry[];
  /** Lecture-free: the week is outside the semester. */
  outside: boolean;
}

/**
 * Weeks from the current one up to the end of the semester or the last exam
 * or deadline, whichever is later (at least `minWeeks`, at most `maxWeeks`).
 */
export function longTermWeeks(loaded: LoadedPack, today: ISODate, minWeeks = 8, maxWeeks = 30): CalendarWeek[] {
  const first = weekStart(today);
  let last = loaded.pack.semester?.end ?? today;
  for (const s of loaded.subjects) {
    if (s.exam.date && s.exam.date > last) last = s.exam.date;
    for (const sh of s.sheets ?? []) if (sh.status === 'open' && sh.due && sh.due > last) last = sh.due;
  }
  const count = Math.min(maxWeeks, Math.max(minWeeks, Math.floor(diffDays(first, last) / 7) + 1));
  const sem = loaded.pack.semester;
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(first, i * 7);
    const days = Array.from({ length: 7 }, (_, d) => addDays(start, d)).filter((d) => d >= today);
    const entries = days.flatMap((d) => entriesOn(loaded, d, today));
    const end = addDays(start, 6);
    return {
      start,
      week: isoWeek(start),
      reviews: entries.filter((e) => e.kind === 'reviews').reduce((n, e) => n + (e.topics?.length ?? 0), 0),
      sheets: entries.filter((e) => e.kind === 'sheet'),
      exams: entries.filter((e) => e.kind === 'exam'),
      outside: !!sem && ((!!sem.end && start > sem.end) || (!!sem.start && end < sem.start)),
    };
  });
}
