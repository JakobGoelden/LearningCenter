import { addDays, diffDays, weekday } from '../lib/dates';
import { activeTopics } from '../model/chapters';
import { allBlocked } from '../model/quiz';
import type { ISODate, PackSettings, Review, Score, Subject, Topic, TopicStatus } from '../model/types';

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
    .filter((t) => t.status !== 'skip' && !allBlocked(t))
    .sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    .slice(0, count);
}

/** How well a topic is known, 0–1: average of the last three scores (0 without history). */
export function mastery(topic: Topic): number {
  const recent = (topic.history ?? []).slice(-3);
  return recent.length ? recent.reduce((a, r) => a + r.score, 0) / recent.length / 5 : 0;
}

/**
 * Study priority of a topic (0 = not needed today). Due topics come first and
 * rise the longer they are overdue; shaky and new topics fill up after them.
 * Weak topics (low recent scores) and an exam within three weeks raise it.
 */
export function studyPriority(topic: Topic, on: ISODate, examDate?: ISODate): number {
  let base: number;
  if (isDue(topic, on)) base = 2 + Math.min(diffDays(topic.due!, on), 14) / 7;
  else if (topic.status === 'shaky') base = 1;
  else if (topic.status === 'new') base = 0.8;
  else return 0;
  const days = examDate && examDate >= on ? diffDays(on, examDate) : undefined;
  const examBoost = days !== undefined && days <= 21 ? 1 + (21 - days) / 21 : 1;
  return base * (0.6 + 1 - mastery(topic)) * examBoost;
}

export interface StudyBlock {
  subject: Subject;
  topics: Topic[];
}

/**
 * The `count` most pressing topics across all subjects, grouped into one block
 * per subject. Blocks are ordered by their most pressing topic.
 */
export function studyPlan(subjects: Subject[], on: ISODate, count: number): StudyBlock[] {
  const ranked = subjects
    .flatMap((s) => activeTopics(s).map((t) => ({ s, t, p: studyPriority(t, on, s.exam.date) })))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || (a.t.due ?? '9999').localeCompare(b.t.due ?? '9999'))
    .slice(0, count);
  const blocks = new Map<string, StudyBlock>();
  for (const { s, t } of ranked) {
    if (!blocks.has(s.id)) blocks.set(s.id, { subject: s, topics: [] });
    blocks.get(s.id)!.topics.push(t);
  }
  return [...blocks.values()];
}

/** Topics that are due today or overdue (skip never counts). */
export function dueCount(subjects: Subject[], on: ISODate): number {
  return subjects.reduce((n, s) => n + activeTopics(s).filter((t) => t.status !== 'skip' && !!t.due && t.due <= on).length, 0);
}

/** Default size of a study round: everything that is due, else the usual quiz size. */
export function studyCount(subjects: Subject[], on: ISODate, fallback: number): number {
  return dueCount(subjects, on) || fallback;
}

/** Topics a study round can draw from at all. */
export function studyCandidates(subjects: Subject[], on: ISODate): number {
  return subjects.reduce((n, s) => n + activeTopics(s).filter((t) => studyPriority(t, on, s.exam.date) > 0).length, 0);
}
