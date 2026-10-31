// What the learner did in the app that their AI has not processed yet. The AI
// marks a sync by appending an `ai.sync` event (see CLAUDE.md → "Processing
// new results"); everything after it counts as new.

import type { LogEvent } from './types';

export interface PendingResults {
  /** Quizzes graded by the learner and saved to progress. */
  quizzes: number;
  /** Quizzes sent to the chat ("Check in chat") and not graded yet (whenever saved). */
  toGrade: number;
  /** Dojo practice rounds and dojo results saved to progress. */
  dojo: number;
  /** Sheets marked done or worked on. */
  sheets: number;
  total: number;
  /** Time of the last ai.sync, if any. */
  lastSync?: string;
  /** What the counts stand for: session ids, sheets as `subject/sheet`. */
  refs: { quizzes: string[]; toGrade: string[]; dojo: string[]; sheets: string[] };
}

export function pendingResults(events: LogEvent[]): PendingResults {
  let lastSyncAt = -1;
  events.forEach((e, i) => {
    if (e.type === 'ai.sync') lastSyncAt = i;
  });
  const gradeLater = new Set<string>();
  const quizzes = new Set<string>();
  const dojo = new Set<string>();
  const sheets = new Set<string>();
  events.forEach((e, i) => {
    const key = e.ref ?? e.ts;
    if (e.type === 'quiz.gradeLater') gradeLater.add(key);
    if (e.type === 'quiz.applied') gradeLater.delete(key);
    if (i <= lastSyncAt || e.actor === 'ai') return;
    if (e.type === 'quiz.applied') quizzes.add(key);
    if (e.type === 'dojo.drill.round' || e.type === 'dojo.applied') dojo.add(key);
    if (e.type === 'sheet.work' || (e.type === 'sheet.status' && e.data?.to === 'done')) sheets.add(`${e.subject ?? ''}/${key}`);
  });
  const r = { quizzes: quizzes.size, toGrade: gradeLater.size, dojo: dojo.size, sheets: sheets.size };
  return {
    ...r,
    total: r.quizzes + r.toGrade + r.dojo + r.sheets,
    ...(lastSyncAt >= 0 ? { lastSync: events[lastSyncAt].ts } : {}),
    refs: { quizzes: [...quizzes], toGrade: [...gradeLater], dojo: [...dojo], sheets: [...sheets] },
  };
}

/** Event types that mean new learning content arrived (see CLAUDE.md → When editing). */
export const CONTENT_EVENTS = new Set(['topic.add', 'question.add', 'sheet.add', 'material.add', 'dojo.add', 'dojo.drills.add']);

/** Time of the latest content event per subject id. */
export function lastContentBySubject(events: LogEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if (!e.subject || !CONTENT_EVENTS.has(e.type)) continue;
    const prev = out.get(e.subject);
    if (!prev || e.ts > prev) out.set(e.subject, e.ts);
  }
  return out;
}
