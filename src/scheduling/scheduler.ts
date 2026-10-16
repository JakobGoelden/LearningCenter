import { addDays, weekday } from '../lib/dates';
import type { ISODate, PackSettings, Review, Score, Topic, TopicStatus } from '../model/types';

export const DEFAULT_LADDER = [1, 3, 7, 14, 21, 35, 60];

export interface ScheduleResult {
  status: TopicStatus;
  due?: ISODate;
  intervalDays?: number;
}

export function ladderOf(settings?: PackSettings): number[] {
  const l = settings?.reviewLadder;
  return l && l.length >= 2 ? [...l].sort((a, b) => a - b) : DEFAULT_LADDER;
}

/** Index of the largest ladder step not above `interval`; -1 for none. */
export function ladderIndex(ladder: number[], interval?: number): number {
  if (interval === undefined || interval <= 0) return -1;
  let idx = -1;
  for (let i = 0; i < ladder.length; i++) if (ladder[i] <= interval) idx = i;
  return idx;
}

/** Saturday and Sunday move to the following Monday. */
export function shiftOffWeekend(date: ISODate): ISODate {
  const wd = weekday(date);
  if (wd === 6) return addDays(date, 2);
  if (wd === 0) return addDays(date, 1);
  return date;
}

/**
 * Next review after answering with `score` (0–5).
 *
 * - score ≥ 4: one step up the ladder (at least step 2, e.g. 3 days); a topic
 *   that was shaky climbs at most to step 3 (e.g. 7 days) so it is confirmed
 *   once more before getting long gaps. Status becomes solid.
 * - score 3: stays short (step 1 or 2, e.g. 1 or 3 days), status shaky.
 * - score ≤ 2: back to the first step (e.g. 1 day), status shaky.
 * - skip topics are never scheduled.
 */
export function schedule(
  topic: Pick<Topic, 'status' | 'intervalDays'>,
  score: Score,
  from: ISODate,
  settings?: PackSettings,
): ScheduleResult {
  if (topic.status === 'skip') return { status: 'skip' };
  const ladder = ladderOf(settings);
  const idx = ladderIndex(ladder, topic.intervalDays);
  let next: number;
  let status: TopicStatus;
  if (score >= 4) {
    next = Math.max(idx + 1, 1);
    if (topic.status === 'shaky') next = Math.min(next, 2);
    status = 'solid';
  } else if (score === 3) {
    next = Math.min(Math.max(idx, 0), 1);
    status = 'shaky';
  } else {
    next = 0;
    status = 'shaky';
  }
  next = Math.min(next, ladder.length - 1);
  const intervalDays = ladder[next];
  let due = addDays(from, intervalDays);
  if (settings?.skipWeekends ?? true) due = shiftOffWeekend(due);
  return { status, due, intervalDays };
}

/** Records a review in the topic history and reschedules it. Returns a new topic. */
export function applyReview(topic: Topic, review: Review, settings?: PackSettings): Topic {
  const next = schedule(topic, review.score, review.date, settings);
  return {
    ...topic,
    ...next,
    history: [...(topic.history ?? []), review],
  };
}

export function isDue(topic: Topic, on: ISODate): boolean {
  return topic.status !== 'skip' && !!topic.due && topic.due <= on;
}

export function isOverdue(topic: Topic, on: ISODate): boolean {
  return topic.status !== 'skip' && !!topic.due && topic.due < on;
}

/** Average score, rounded to the nearest integer. */
export function averageScore(scores: Score[]): Score {
  const avg = scores.reduce<number>((a, b) => a + b, 0) / scores.length;
  return Math.round(avg) as Score;
}

/**
 * Order topics for a quiz: overdue/due first (oldest due first), then shaky,
 * then new, then the rest by due date. skip topics are excluded.
 */
export function pickQuizTopics(topics: Topic[], on: ISODate, count: number): Topic[] {
  const rank = (t: Topic) =>
    isDue(t, on) ? 0 : t.status === 'shaky' ? 1 : t.status === 'new' ? 2 : 3;
  return topics
    .filter((t) => t.status !== 'skip')
    .sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    .slice(0, count);
}
