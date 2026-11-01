// What an AI wants to know about a learner, computed from a pack: progress,
// weak spots and the details behind them. Pure functions, no file access.

import { activeDojos, activeTopics, chapterEnabled } from '../model/chapters';
import { overview, todayItems } from '../model/derive';
import { addDays, diffDays, weekday } from '../lib/dates';
import { activeQuestions } from '../model/quiz';
import { cardDue, dueCards, studyPlan } from '../scheduling/scheduler';
import type { Dojo, ISODate, LoadedPack, Review, Score, Session, Subject, Topic, TopicQuestion } from '../model/types';

export interface Snapshot {
  loaded: LoadedPack;
  sessions: Session[];
  on: ISODate;
}

/** A card or topic counts as weak below this average (scale 0–5). */
const WEAK_BELOW = 3.5;
/** Exams closer than this raise a weak spot's priority. */
const EXAM_WINDOW_DAYS = 28;
/** How much of the recent past the drill statistics look at. */
const DRILL_WINDOW_DAYS = 60;
const WEEKS_SHOWN = 8;

const round = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Average with later scores counting more, like `cardPriority`. */
function weighted(scores: number[]): number | null {
  if (!scores.length) return null;
  let sum = 0;
  let weights = 0;
  scores.forEach((s, i) => {
    sum += s * (i + 1);
    weights += i + 1;
  });
  return sum / weights;
}

const cardState = (q: TopicQuestion): 'new' | 'shaky' | 'solid' => {
  const last = q.stats?.recent.at(-1);
  return last === undefined ? 'new' : last < 4 ? 'shaky' : 'solid';
};

/** Went from right to wrong again: knew it once, did not keep it. */
const relapsed = (recent: Score[]) => recent.length >= 2 && recent.slice(0, -1).some((s) => s >= 4) && recent.at(-1)! < 3;

const chapterTitle = (s: Subject, id?: string) => s.chapters?.find((c) => c.id === id)?.title;

// ---- progress ------------------------------------------------------------

function subjectProgress(s: Subject, dojos: Dojo[], on: ISODate) {
  const o = overview(s, on);
  const cards = activeTopics(s)
    .filter((t) => t.status !== 'skip')
    .flatMap((t) => activeQuestions(t));
  const states = { new: 0, shaky: 0, solid: 0 };
  for (const q of cards) states[cardState(q)]++;
  const seen = states.shaky + states.solid;
  const daysLeft = o.examInDays !== null && o.examInDays > 0 ? o.examInDays : null;
  const off = (s.chapters ?? []).filter((c) => c.enabled === false);
  const ownDojos = activeDojos(s, dojos);
  const drills = ownDojos.flatMap((d) => d.drills ?? []);
  return {
    id: s.id,
    name: s.name,
    exam: { format: s.exam.format, date: s.exam.date ?? null, inDays: o.examInDays },
    topics: o.statusCounts,
    /** Share of non-skipped topics that are solid, as on the dashboard. */
    progress: round(o.progress),
    cards: {
      total: cards.length,
      ...states,
      /** Share of the switched-on cards answered at least once. */
      covered: cards.length ? round(seen / cards.length) : 0,
      due: o.dueCards,
      overdue: o.overdueCards,
      avgRecentScore: round(mean(cards.flatMap((q) => q.stats?.recent ?? [])) ?? 0),
    },
    /** New cards a day it takes to have seen everything by the exam. */
    newCardsPerDayToExam: daysLeft ? round(states.new / daysLeft) : null,
    chapters: s.chapters?.length
      ? { on: s.chapters.length - off.length, off: off.map((c) => ({ id: c.id, title: c.title, topics: s.topics.filter((t) => t.chapter === c.id).length })) }
      : null,
    topicsSwitchedOff: s.topics.filter((t) => t.enabled === false).length,
    dojos: { count: ownDojos.length, drills: drills.length, examDrills: drills.filter((d) => d.level === 'exam').length },
    openSheets: o.openSheets.map((x) => ({ id: x.id, label: x.label, due: x.due ?? null })),
    openItems: (s.openItems ?? []).filter((i) => !i.doneAt).map((i) => i.text),
    staleChecks: o.staleChecks.map((c) => c.label),
  };
}

const monday = (d: ISODate) => addDays(d, -((weekday(d) + 6) % 7));

/** Reviews per week, newest last, and how regularly the person studies. */
function activity(snap: Snapshot, only?: string) {
  const reviews = snap.loaded.subjects
    .filter((s) => !only || s.id === only)
    .flatMap((s) => s.topics.flatMap((t) => t.history ?? []));
  const answered = snap.loaded.subjects
    .filter((s) => !only || s.id === only)
    .flatMap((s) => s.topics.flatMap((t) => (t.questions ?? []).flatMap((q) => (q.stats?.last ? [q.stats.last] : []))));
  const days = new Set([...reviews.map((r) => r.date), ...answered]);
  const thisWeek = monday(snap.on);
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(thisWeek, -7 * (WEEKS_SHOWN - 1 - i))).map((week) => {
    const inWeek: Review[] = reviews.filter((r) => monday(r.date) === week);
    const avg = mean(inWeek.map((r) => r.score));
    return { week, reviews: inWeek.length, avgScore: avg === null ? null : round(avg) };
  });
  let streak = 0;
  // Today does not break a streak: the person may simply not have studied yet.
  for (let d = days.has(snap.on) ? snap.on : addDays(snap.on, -1); days.has(d); d = addDays(d, -1)) streak++;
  const last = [...days].sort().at(-1) ?? null;
  return { lastActive: last, daysSinceActive: last ? diffDays(last, snap.on) : null, streakDays: streak, weeks };
}

export function progressReport(snap: Snapshot, subjectId?: string) {
  const { loaded, on } = snap;
  const subjects = loaded.subjects.filter((s) => !subjectId || s.id === subjectId);
  return {
    date: on,
    pack: loaded.pack.title,
    subjects: subjects.map((s) => subjectProgress(s, loaded.dojos, on)),
    activity: activity(snap, subjectId),
    today: subjectId ? undefined : todayItems(loaded, on).map((i) => ({ subject: i.subject.id, kind: i.kind, text: i.text, urgent: i.urgent })),
    /** What a study round would ask next: subject → number of cards and topics. */
    studyNext: studyPlan(subjects, on, 20, loaded.pack.settings).map((b) => ({
      subject: b.subject.id,
      cards: b.cards.length,
      topics: b.topics.slice(0, 5).map((t) => t.id),
    })),
  };
}

// ---- weak spots ----------------------------------------------------------

interface DrillMiss {
  drill: string;
  dojo?: string;
  tries: number;
  avgScore: number;
  topic?: string;
}

/** Answers of the sessions per topic, newest session last. */
function sessionItems(sessions: Session[], subject: string) {
  return [...sessions]
    .filter((s) => s.subject === subject)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .flatMap((s) => s.items.map((item) => ({ session: s, item })));
}

function drillMisses(snap: Snapshot, subject: string): DrillMiss[] {
  const since = addDays(snap.on, -DRILL_WINDOW_DAYS);
  const byDrill = new Map<string, { dojo?: string; topic?: string; scores: number[] }>();
  for (const { session, item } of sessionItems(snap.sessions, subject)) {
    if (item.kind !== 'drill' || !item.drill || item.score === undefined || session.startedAt.slice(0, 10) < since) continue;
    const key = `${session.dojo ?? ''}/${item.drill}`;
    const entry = byDrill.get(key) ?? { ...(session.dojo ? { dojo: session.dojo } : {}), ...(item.topicId ? { topic: item.topicId } : {}), scores: [] };
    entry.scores.push(item.score);
    byDrill.set(key, entry);
  }
  return [...byDrill.entries()]
    .map(([key, e]) => ({ drill: key.slice(key.indexOf('/') + 1), ...(e.dojo ? { dojo: e.dojo } : {}), ...(e.topic ? { topic: e.topic } : {}), tries: e.scores.length, avgScore: round(mean(e.scores)!) }))
    .filter((d) => d.avgScore < WEAK_BELOW)
    .sort((a, b) => a.avgScore - b.avgScore);
}

const examFactor = (s: Subject, on: ISODate) => {
  const days = s.exam.date && s.exam.date >= on ? diffDays(on, s.exam.date) : null;
  return days !== null && days <= EXAM_WINDOW_DAYS ? 1 + (EXAM_WINDOW_DAYS - days) / EXAM_WINDOW_DAYS : 1;
};

/** Average review of a topic is only used while it has no card answers: old packs, dojo-only topics. */
function topicWeakness(t: Topic, s: Subject, snap: Snapshot, drills: DrillMiss[], gaps: Map<string, string[]>) {
  const asked = activeQuestions(t).filter((q) => q.stats?.recent.length);
  const weakCards = asked
    .map((q) => ({ q, avg: weighted(q.stats!.recent)! }))
    .filter(({ q, avg }) => avg < WEAK_BELOW || relapsed(q.stats!.recent))
    .sort((a, b) => a.avg - b.avg);
  const history = (t.history ?? []).slice(-3).map((r) => r.score);
  const ownDrills = drills.filter((d) => d.topic === t.id);
  const cardAvg = weighted(asked.flatMap((q) => q.stats!.recent));
  const level = cardAvg ?? weighted(history);
  if (level === null && !ownDrills.length) return null;
  if (!weakCards.length && !ownDrills.length && (level === null || level >= WEAK_BELOW)) return null;

  const reasons: string[] = [];
  if (weakCards.length) reasons.push(`${weakCards.length} of ${asked.length} answered cards weak`);
  const relapses = weakCards.filter(({ q }) => relapsed(q.stats!.recent)).length;
  if (relapses) reasons.push(`${relapses} ${relapses === 1 ? 'card' : 'cards'} relapsed after being right`);
  if (!weakCards.length && level !== null && level < WEAK_BELOW) reasons.push(`recent reviews average ${round(level)}`);
  if (ownDrills.length) reasons.push(`${ownDrills.length} ${ownDrills.length === 1 ? 'drill' : 'drills'} keep going wrong`);
  const repeated = gaps.get(t.id) ?? [];
  if (repeated.length) reasons.push('gaps named in graded answers');

  const severity = (5 - (level ?? 2.5)) + weakCards.length * 0.25 + ownDrills.length * 0.25 + relapses * 0.5;
  return {
    subject: s.id,
    topic: t.id,
    title: t.title,
    chapter: chapterTitle(s, t.chapter) ?? null,
    priority: round(severity * examFactor(s, snap.on)),
    avgScore: level === null ? null : round(level),
    status: t.status,
    due: t.due ?? null,
    reasons,
    cards: weakCards.slice(0, 5).map(({ q, avg }) => ({
      id: q.id,
      prompt: q.prompt,
      seen: q.stats!.seen,
      recent: q.stats!.recent,
      avgScore: round(avg),
      due: cardDue(t, q) ?? null,
    })),
    drills: ownDrills.slice(0, 5),
    gaps: repeated.slice(-5),
  };
}

export interface WeakOptions {
  subject?: string;
  limit?: number;
  /** Also look at switched-off chapters (their lecture may not have happened yet). */
  includeOffChapters?: boolean;
}

/**
 * Topics that keep going wrong, worst first. Evidence: the cards' recent scores
 * (the app updates them in quizzes and endless mode alike), topic reviews,
 * drill rounds and the gaps an AI named when grading. Topics nobody has
 * answered yet are not weak, they are new; `get_progress` counts those.
 */
export function weakSpots(snap: Snapshot, opts: WeakOptions = {}) {
  const subjects = snap.loaded.subjects.filter((s) => !opts.subject || s.id === opts.subject);
  const spots = subjects.flatMap((s) => {
    const drills = drillMisses(snap, s.id);
    const gaps = new Map<string, string[]>();
    for (const { item } of sessionItems(snap.sessions, s.id)) {
      if (item.topicId && item.gaps?.length) gaps.set(item.topicId, [...(gaps.get(item.topicId) ?? []), ...item.gaps]);
    }
    const topics = (opts.includeOffChapters ? s.topics : activeTopics(s)).filter((t) => t.status !== 'skip');
    return topics.flatMap((t) => topicWeakness(t, s, snap, drills, gaps) ?? []);
  });
  const known = new Set(subjects.flatMap((s) => s.topics.map((t) => t.id)));
  return {
    date: snap.on,
    spots: spots.sort((a, b) => b.priority - a.priority).slice(0, opts.limit ?? 15),
    total: spots.length,
    /** Drills that go wrong without pointing to a topic. */
    drillsWithoutTopic: subjects.flatMap((s) => drillMisses(snap, s.id).filter((d) => !d.topic || !known.has(d.topic)).map((d) => ({ subject: s.id, ...d }))).slice(0, 10),
  };
}

// ---- cards and topics ----------------------------------------------------

export type CardFilter = 'all' | 'due' | 'new' | 'weak' | 'blocked';

export interface CardOptions {
  subject: string;
  topic?: string;
  filter?: CardFilter;
  limit?: number;
  offset?: number;
  includeOffChapters?: boolean;
}

export const findSubject = (loaded: LoadedPack, id: string): Subject => {
  const s = loaded.subjects.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown subject "${id}". Known: ${loaded.subjects.map((x) => x.id).join(', ')}`);
  return s;
};

export const findTopic = (s: Subject, id: string): Topic => {
  const t = s.topics.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown topic "${id}" in ${s.id}. List the topics with get_subject_topics.`);
  return t;
};

const cardView = (t: Topic, q: TopicQuestion) => ({
  id: q.id,
  topic: t.id,
  prompt: q.prompt,
  kind: q.kind ?? null,
  answer: q.answer ?? null,
  state: cardState(q),
  blocked: !!q.blocked,
  due: cardDue(t, q) ?? null,
  intervalDays: q.intervalDays ?? null,
  stats: q.stats ?? null,
});

export function listCards(snap: Snapshot, opts: CardOptions) {
  const s = findSubject(snap.loaded, opts.subject);
  const topics = opts.topic ? [findTopic(s, opts.topic)] : opts.includeOffChapters ? s.topics : activeTopics(s);
  const due = new Set(dueCards(s, snap.on).map((c) => `${c.topic.id}/${c.question.id}`));
  const wanted = (t: Topic, q: TopicQuestion) => {
    switch (opts.filter ?? 'all') {
      case 'due':
        return due.has(`${t.id}/${q.id}`);
      case 'new':
        return !q.blocked && cardState(q) === 'new';
      case 'weak':
        return !q.blocked && !!q.stats?.recent.length && (weighted(q.stats.recent)! < WEAK_BELOW || relapsed(q.stats.recent));
      case 'blocked':
        return !!q.blocked;
      default:
        return true;
    }
  };
  const cards = topics.flatMap((t) => (t.questions ?? []).filter((q) => wanted(t, q)).map((q) => cardView(t, q)));
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;
  return { subject: s.id, total: cards.length, offset, cards: cards.slice(offset, offset + limit) };
}

export function subjectTopics(snap: Snapshot, subjectId: string) {
  const s = findSubject(snap.loaded, subjectId);
  return {
    subject: s.id,
    chapters: (s.chapters ?? []).map((c) => ({ id: c.id, title: c.title, enabled: c.enabled !== false })),
    topics: s.topics.map((t) => ({
      id: t.id,
      title: t.title,
      chapter: t.chapter ?? null,
      active: t.enabled !== false && chapterEnabled(s, t.chapter),
      status: t.status,
      due: t.due ?? null,
      cards: t.questions?.length ?? 0,
    })),
  };
}

export function topicDetail(snap: Snapshot, subjectId: string, topicId: string) {
  const s = findSubject(snap.loaded, subjectId);
  const t = findTopic(s, topicId);
  const dojos = snap.loaded.dojos.filter((d) => d.subject === s.id && ((d.topics ?? []).includes(t.id) || (d.drills ?? []).some((x) => x.topic === t.id)));
  return {
    subject: s.id,
    id: t.id,
    title: t.title,
    notes: t.notes ?? null,
    chapter: chapterTitle(s, t.chapter) ?? null,
    active: t.enabled !== false && chapterEnabled(s, t.chapter),
    status: t.status,
    due: t.due ?? null,
    intervalDays: t.intervalDays ?? null,
    history: (t.history ?? []).slice(-10),
    cards: (t.questions ?? []).map((q) => cardView(t, q)),
    dojos: dojos.map((d) => ({ id: d.id, title: d.title, drills: (d.drills ?? []).filter((x) => x.topic === t.id).length })),
    /** The person's last answers on this topic, newest last. */
    recentAnswers: sessionItems(snap.sessions, s.id)
      .filter(({ item }) => item.topicId === t.id && item.answer)
      .slice(-5)
      .map(({ session, item }) => ({
        session: session.id,
        date: session.startedAt.slice(0, 10),
        prompt: item.prompt,
        answer: item.answer,
        score: item.score ?? null,
        feedback: item.feedback ?? null,
        gaps: item.gaps ?? [],
      })),
  };
}
