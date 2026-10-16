import { diffDays } from '../lib/dates';
import { isDue, isOverdue } from '../scheduling/scheduler';
import type { Check, ISODate, LoadedPack, Sheet, Subject, Topic, TopicStatus } from './types';

/** Exams within this many days show up in the "Today" line. */
export const EXAM_SOON_DAYS = 14;
/** Sheets due within this many days show up in the "Today" line. */
export const SHEET_SOON_DAYS = 2;

export interface SubjectOverview {
  subject: Subject;
  examInDays: number | null;
  statusCounts: Record<TopicStatus, number>;
  due: Topic[];
  overdue: Topic[];
  upcoming: Topic[];
  sheetsSoon: Sheet[];
  openItems: number;
  openSheets: Sheet[];
  /** Share of non-skipped topics that are solid, 0–1. */
  progress: number;
  staleChecks: Check[];
}

export function isCheckStale(c: Check, on: ISODate): boolean {
  if (!c.everyDays) return false;
  return !c.lastChecked || diffDays(c.lastChecked, on) > c.everyDays;
}

export function progressOf(c: Record<TopicStatus, number>): number {
  const total = c.new + c.shaky + c.solid;
  return total ? c.solid / total : 0;
}

export function overview(subject: Subject, on: ISODate): SubjectOverview {
  const statusCounts: Record<TopicStatus, number> = { new: 0, shaky: 0, solid: 0, skip: 0 };
  for (const t of subject.topics) statusCounts[t.status]++;
  const byDue = (a: Topic, b: Topic) => (a.due ?? '').localeCompare(b.due ?? '');
  const due = subject.topics.filter((t) => isDue(t, on)).sort(byDue);
  return {
    subject,
    examInDays: subject.exam.date ? diffDays(on, subject.exam.date) : null,
    statusCounts,
    due,
    overdue: due.filter((t) => isOverdue(t, on)),
    upcoming: subject.topics
      .filter((t) => t.status !== 'skip' && t.due && t.due > on)
      .sort(byDue)
      .slice(0, 3),
    sheetsSoon: (subject.sheets ?? []).filter(
      (s) => s.status === 'open' && s.due && diffDays(on, s.due) <= SHEET_SOON_DAYS,
    ),
    openItems: (subject.openItems ?? []).filter((i) => !i.doneAt).length,
    openSheets: (subject.sheets ?? []).filter((s) => s.status === 'open'),
    progress: progressOf(statusCounts),
    staleChecks: (subject.checks ?? []).filter((c) => isCheckStale(c, on)),
  };
}

export type TodayKind = 'reviews' | 'exam' | 'sheet' | 'check';

export interface TodayItem {
  subject: Subject;
  kind: TodayKind;
  text: string;
  urgent: boolean;
}

/** The "Today" line across all subjects. */
export function todayItems(loaded: LoadedPack, on: ISODate): TodayItem[] {
  const items: TodayItem[] = [];
  for (const s of loaded.subjects) {
    const o = overview(s, on);
    if (o.due.length) {
      const over = o.overdue.length ? `, ${o.overdue.length} overdue` : '';
      items.push({
        subject: s,
        kind: 'reviews',
        text: `${o.due.length} ${o.due.length === 1 ? 'review' : 'reviews'} due${over}`,
        urgent: o.overdue.length > 0,
      });
    }
    if (o.examInDays !== null && o.examInDays >= 0 && o.examInDays <= EXAM_SOON_DAYS) {
      items.push({
        subject: s,
        kind: 'exam',
        text: o.examInDays === 0 ? 'exam today' : `exam in ${o.examInDays} ${o.examInDays === 1 ? 'day' : 'days'}`,
        urgent: o.examInDays <= 3,
      });
    }
    for (const sh of o.sheetsSoon) {
      const d = diffDays(on, sh.due!);
      items.push({
        subject: s,
        kind: 'sheet',
        text: `${sh.label} ${d < 0 ? 'overdue' : d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : `due in ${d} days`}`,
        urgent: d <= 0,
      });
    }
    if (o.staleChecks.length) {
      items.push({
        subject: s,
        kind: 'check',
        text: `check: ${o.staleChecks.map((c) => c.label).join(', ')}`,
        urgent: false,
      });
    }
  }
  const order: Record<TodayKind, number> = { exam: 0, reviews: 1, sheet: 2, check: 3 };
  return items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || order[a.kind] - order[b.kind]);
}
