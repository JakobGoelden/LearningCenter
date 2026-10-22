import { addDays, diffDays, weekday } from '../lib/dates';
import { activeTopics } from '../model/chapters';
import { activeQuestions, allBlocked, questionFor } from '../model/quiz';
import type { Card } from './cards';
import type { ISODate, PackSettings, Review, Score, Subject, Topic, TopicQuestion, TopicStatus } from '../model/types';

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

/**
 * Records a review in the topic history and reschedules it. Returns a new topic.
 * Once its cards have their own dates, the topic is due with its earliest card.
 */
export function applyReview(topic: Topic, review: Review, settings?: PackSettings): Topic {
  const next = schedule(topic, review.score, review.date, settings);
  const reviewed: Topic = { ...topic, ...next, history: [...(topic.history ?? []), review] };
  const first = earliestCardDue(reviewed);
  return first && reviewed.status !== 'skip' ? { ...reviewed, due: first } : reviewed;
}

// ---------------------------------------------------------------------------
// Cards. Every prepared question has its own due date and interval, scheduled
// with the same ladder as topics. A topic is due as soon as one of its cards
// is; its status and history summarise the cards. Cards never answered are
// new: they come in through a daily budget (settings.newCardsPerDay) so a
// fresh script does not flood the day.

export const DEFAULT_NEW_CARDS_PER_DAY = 20;

/** Id of the one generic card of a topic without prepared questions. */
export const GENERIC_CARD = '_';

export const newCardsPerDay = (settings?: PackSettings) => Math.max(0, settings?.newCardsPerDay ?? DEFAULT_NEW_CARDS_PER_DAY);

/**
 * The cards of a topic: prepared questions that are not blocked. A topic
 * without `questions` gets one generic card; `questions: []` means the topic
 * is a procedure trained only in dojos and has no cards.
 */
export function cardsOf(topic: Topic): TopicQuestion[] {
  if (topic.questions) return activeQuestions(topic);
  const q = questionFor(topic);
  return [{ id: GENERIC_CARD, prompt: q.prompt, ...(q.kind ? { kind: q.kind } : {}) }];
}

const ownSchedule = (topic: Topic) => (topic.questions ?? []).some((q) => q.due !== undefined);

/**
 * When the card is next due; undefined for a new card. Packs from before
 * cards had dates: answered cards take over the topic's date, and a topic
 * that was never answered card by card passes its date to the card it would
 * have asked next.
 */
export function cardDue(topic: Topic, q: TopicQuestion): ISODate | undefined {
  if (q.id === GENERIC_CARD) return topic.due;
  if (q.due !== undefined || ownSchedule(topic) || !topic.due || q.blocked) return q.due;
  const qs = activeQuestions(topic);
  if (qs.some((x) => x.stats)) return q.stats ? topic.due : undefined;
  return qs[(topic.history?.length ?? 0) % qs.length]?.id === q.id ? topic.due : undefined;
}

/** The topic with every inherited card date written into the cards. */
export function withOwnCardDates(topic: Topic): Topic {
  if (!topic.questions?.length || ownSchedule(topic)) return topic;
  return {
    ...topic,
    questions: topic.questions.map((q) => {
      const due = cardDue(topic, q);
      return due ? { ...q, due, ...(topic.intervalDays ? { intervalDays: topic.intervalDays } : {}) } : q;
    }),
  };
}

function earliestCardDue(topic: Topic): ISODate | undefined {
  const dates = activeQuestions(topic)
    .map((q) => q.due)
    .filter((d): d is ISODate => !!d)
    .sort();
  return dates[0];
}

export interface CardResult {
  /** Question id; missing for a question that is not a prepared card (e.g. written by the AI). */
  question?: string;
  score: Score;
}

/**
 * Applies a quiz to one topic: every answered card is rescheduled on its own
 * (several answers to one card count as their average), the topic gets one
 * history entry with the average score and is due with its earliest card.
 */
export function applyCardReviews(topic: Topic, results: CardResult[], review: Omit<Review, 'score'>, settings?: PackSettings): Topic {
  if (!results.length) return topic;
  const t = withOwnCardDates(topic);
  const questions = t.questions?.map((q) => {
    const mine = results.filter((r) => r.question === q.id).map((r) => r.score);
    if (!mine.length || q.blocked) return q;
    const last = q.stats?.recent.at(-1);
    const due = cardDue(t, q);
    const state: Pick<Topic, 'status' | 'intervalDays'> = due
      ? { status: last !== undefined && last < 4 ? 'shaky' : 'solid', intervalDays: q.intervalDays ?? t.intervalDays }
      : { status: 'new' };
    const next = schedule(state, averageScore(mine), review.date, settings);
    return { ...q, due: next.due, intervalDays: next.intervalDays, since: q.since ?? review.date };
  });
  const withCards: Topic = questions ? { ...t, questions } : t;
  return applyReview(withCards, { ...review, score: averageScore(results.map((r) => r.score)) }, settings);
}

/** Sets the date of the topic and all its cards by hand (e.g. "not before Thursday"). */
export function withTopicDue(topic: Topic, due: ISODate | undefined): Topic {
  const questions = topic.questions?.map((q) => (q.blocked ? q : { ...q, due }));
  const t: Topic = { ...topic, due, ...(questions ? { questions } : {}) };
  if (!due) {
    delete t.due;
    t.questions = t.questions?.map(({ due: _d, ...q }) => q);
  }
  return t;
}

const quizzable = (t: Topic) => t.status !== 'skip' && !allBlocked(t);

/** Cards due on `on` or earlier (or exactly on `on`), oldest first. */
export function dueCards(subject: Subject, on: ISODate, exactDay = false): Card[] {
  return activeTopics(subject)
    .filter(quizzable)
    .flatMap((topic) => cardsOf(topic).map((question) => ({ topic, question, due: cardDue(topic, question) })))
    .filter((c) => !!c.due && (exactDay ? c.due === on : c.due <= on))
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .map(({ topic, question }) => ({ topic, question }));
}

/** New cards already started on `on` (they count against the daily budget). */
export function newCardsStarted(subjects: Subject[], on: ISODate): number {
  return subjects.reduce((n, s) => n + s.topics.reduce((k, t) => k + (t.questions ?? []).filter((q) => q.since === on).length, 0), 0);
}

/**
 * New cards for today within the budget: subjects take turns (the nearest
 * exam first), each in the order of its topics and cards, so a script is
 * learned front to back.
 */
export function newCards(subjects: Subject[], on: ISODate, settings?: PackSettings, only?: string): Card[] {
  const budget = Math.max(0, newCardsPerDay(settings) - newCardsStarted(subjects, on));
  const queues = [...subjects]
    .sort((a, b) => (a.exam.date ?? '9999').localeCompare(b.exam.date ?? '9999'))
    .map((s) =>
      activeTopics(s)
        .filter(quizzable)
        .flatMap((topic) => cardsOf(topic).filter((q) => !cardDue(topic, q)).map((question) => ({ subject: s.id, card: { topic, question } }))),
    );
  const out: { subject: string; card: Card }[] = [];
  for (let i = 0; out.length < budget && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length && out.length < budget) out.push(q[i]);
  }
  return out.filter((x) => !only || x.subject === only).map((x) => x.card);
}

const answeredOn = (topic: Topic, q: TopicQuestion) => (q.id === GENERIC_CARD ? topic.history?.at(-1)?.date : q.stats?.last);

/** Cards answered before and not due, and not answered today: for reviewing ahead, nearest date first. */
export function laterCards(subject: Subject, on: ISODate): Card[] {
  return activeTopics(subject)
    .filter(quizzable)
    .flatMap((topic) => cardsOf(topic).map((question) => ({ topic, question, due: cardDue(topic, question) })))
    .filter((c) => !!c.due && c.due > on && answeredOn(c.topic, c.question) !== on)
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .map(({ topic, question }) => ({ topic, question }));
}

/** Cards a quiz of one subject offers, in order: due, new (within the budget), then the rest ahead of time. */
export function quizCards(subject: Subject, subjects: Subject[], on: ISODate, settings?: PackSettings): Card[] {
  return [...dueCards(subject, on), ...newCards(subjects, on, settings, subject.id), ...laterCards(subject, on)];
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

/** How well a card is known, 0–1: its recent scores, else its topic's. */
export function cardMastery(card: Card): number {
  const recent = card.question.stats?.recent ?? [];
  return recent.length ? recent.reduce<number>((a, r) => a + r, 0) / recent.length / 5 : mastery(card.topic);
}

const examBoost = (on: ISODate, examDate?: ISODate) => {
  const days = examDate && examDate >= on ? diffDays(on, examDate) : undefined;
  return days !== undefined && days <= 21 ? 1 + (21 - days) / 21 : 1;
};

/**
 * Study priority of a topic (0 = not needed today). Due topics come first and
 * rise the longer they are overdue; shaky and new topics fill up after them,
 * unless they were already answered today. Weak topics (low recent scores)
 * and an exam within three weeks raise it.
 */
export function studyPriority(topic: Topic, on: ISODate, examDate?: ISODate): number {
  let base: number;
  if (isDue(topic, on)) base = 2 + Math.min(diffDays(topic.due!, on), 14) / 7;
  else if (topic.history?.at(-1)?.date === on) return 0;
  else if (topic.status === 'shaky') base = 1;
  else if (topic.status === 'new') base = 0.8;
  else return 0;
  return base * (0.6 + 1 - mastery(topic)) * examBoost(on, examDate);
}

export interface StudyBlock {
  subject: Subject;
  /** The cards of this block, in the order they are asked. */
  cards: Card[];
  /** The topics of these cards, without repeats. */
  topics: Topic[];
}

/**
 * The cards of a study round across all subjects, grouped into one block per
 * subject: every due card first (overdue, weak and near an exam ahead), then
 * new cards within today's budget, then, only if `count` asks for more,
 * cards ahead of their date, weakest first. Blocks follow their first card.
 */
export function studyPlan(subjects: Subject[], on: ISODate, count: number, settings?: PackSettings): StudyBlock[] {
  const exam = new Map(subjects.map((s) => [s.id, s.exam.date]));
  const subjectOf = new Map<Topic, Subject>();
  for (const s of subjects) for (const t of s.topics) subjectOf.set(t, s);
  const due = subjects
    .flatMap((s) => dueCards(s, on).map((c) => {
      const d = cardDue(c.topic, c.question)!;
      return { s, c, p: (2 + Math.min(diffDays(d, on), 14) / 7) * (0.6 + 1 - cardMastery(c)) * examBoost(on, exam.get(s.id)) };
    }))
    .sort((a, b) => b.p - a.p)
    .map((x) => ({ s: x.s, c: x.c }));
  const fresh = newCards(subjects, on, settings).map((c) => ({ s: subjectOf.get(c.topic)!, c }));
  const ahead = subjects
    .flatMap((s) => laterCards(s, on).map((c) => ({ s, c, p: (0.6 + 1 - cardMastery(c)) * examBoost(on, exam.get(s.id)) })))
    .sort((a, b) => b.p - a.p)
    .map((x) => ({ s: x.s, c: x.c }));
  const picked = [...due, ...fresh, ...ahead].slice(0, count);
  const blocks = new Map<string, StudyBlock>();
  for (const { s, c } of picked) {
    if (!blocks.has(s.id)) blocks.set(s.id, { subject: s, cards: [], topics: [] });
    const b = blocks.get(s.id)!;
    b.cards.push(c);
    if (!b.topics.includes(c.topic)) b.topics.push(c.topic);
  }
  return [...blocks.values()];
}

/** Cards due today or overdue (skip never counts). */
export function dueCount(subjects: Subject[], on: ISODate): number {
  return subjects.reduce((n, s) => n + dueCards(s, on).length, 0);
}

/** Default size of a study round: everything due plus today's new cards, else the usual quiz size. */
export function studyCount(subjects: Subject[], on: ISODate, fallback: number, settings?: PackSettings): number {
  return dueCount(subjects, on) + newCards(subjects, on, settings).length || fallback;
}

/** Cards a study round can draw from at all. */
export function studyCandidates(subjects: Subject[], on: ISODate, settings?: PackSettings): number {
  return studyCount(subjects, on, 0, settings) + subjects.reduce((n, s) => n + laterCards(s, on).length, 0);
}
