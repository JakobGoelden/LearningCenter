// Progress as events. Every answer (and every other change of progress) is one
// small event in log/events.jsonl; a subject's progress is its content plus the
// replay of these events with the app's own scheduling code. Subject files keep
// the content; their progress fields are ignored once a pack is migrated
// (pack.json "progress": "events", see migrate.ts).
//
// Rule changes are not retroactive: every event names the version of the rules
// it was made with (`rules`), and the replay applies it with that version. When
// the scheduling code changes in a way that changes results, keep the old code
// reachable from `applyOp` for the old version and raise RULES.

import { withCardBlocked, withQuizAnswer, withQuizResults, withCardAnswer } from '../scheduling/cards';
import { applyCardReviews, applyReview, withTopicDue } from '../scheduling/scheduler';
import type { CardStats, ISODate, LogEvent, PackSettings, Review, Score, Session, Subject, Topic, TopicQuestion, TopicStatus } from '../model/types';

/** Version of the scheduling rules this app writes. */
export const RULES = 1;

/** Fields of a topic and of its cards that are progress, not content. */
export const TOPIC_PROGRESS = ['status', 'due', 'intervalDays', 'history'] as const;
export const CARD_PROGRESS = ['due', 'intervalDays', 'since', 'stats'] as const;

export interface CardProgress {
  /** Blocked at that moment (blocking changes how later answers count, so the replay needs to know when). */
  blocked?: boolean;
  due?: ISODate;
  intervalDays?: number;
  since?: ISODate;
  stats?: CardStats;
}

export interface TopicProgress {
  status: TopicStatus;
  due?: ISODate;
  intervalDays?: number;
  history?: Review[];
  /** Progress of the topic's prepared cards, by card id; cards without progress are left out. */
  cards?: Record<string, CardProgress>;
}

/** What happened. Each op mirrors one place in the app that used to change a subject file. */
export type ProgressOp =
  /** One rating in a quiz (saved right away). `replaces`: the first event of an earlier rating of the same answer. */
  | { op: 'quiz'; topic: string; card?: string; score: Score; session: string; n: number; replaces?: string }
  /** A whole graded quiz at once (AI grades, "Check myself" without per-card saving). */
  | { op: 'quiz-apply'; session: string; items: { topic: string; card?: string; score: Score }[] }
  /** One answer in endless mode. */
  | { op: 'endless'; topic: string; card: string; score: Score }
  /** One review per topic with the same source (dojo, manual rating, AI without a card). */
  | { op: 'review'; scores: Record<string, Score>; source: Review['source']; session?: string; note?: string }
  /** One card graded on its own outside a quiz (AI in the chat, npm run review --card). */
  | { op: 'card-review'; topic: string; card: string; score: Score; source: Review['source']; note?: string }
  /** Status set by hand on the Topics page. */
  | { op: 'status'; topic: string; status: TopicStatus }
  /** Date set by hand for a topic and all its cards; null clears it. */
  | { op: 'due'; topic: string; due: ISODate | null }
  /** A card was blocked or unblocked (the file says so too; the event says when). */
  | { op: 'block'; topic: string; card: string; blocked: boolean }
  /** The topic starts from scratch (it was deleted; a new topic with the same id must not inherit its past). */
  | { op: 'reset'; topic: string }
  /** The topic's whole progress as it was when the pack was migrated. */
  | { op: 'baseline'; topic: string; progress: TopicProgress };

/** Scheduling settings that change results; stored in the event so a later settings change is not retroactive. */
export type RuleSettings = Pick<PackSettings, 'reviewLadder' | 'skipWeekends'>;

export type ProgressData = ProgressOp & { rules: number; on: ISODate; cfg?: RuleSettings };

export interface ProgressEvent extends LogEvent {
  id: string;
  type: 'progress';
  subject: string;
  data: ProgressData & Record<string, unknown>;
}

const SCORES = new Set([0, 1, 2, 3, 4, 5]);
const isScore = (x: unknown): x is Score => typeof x === 'number' && SCORES.has(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isDate = (x: unknown): x is ISODate => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const STATUSES = new Set(['new', 'shaky', 'solid', 'skip']);
const SOURCES = new Set(['quiz', 'dojo', 'manual']);

/** True for a well-formed progress event of a known op (any rules version). */
export function isProgressEvent(e: unknown): e is ProgressEvent {
  const ev = e as ProgressEvent;
  if (!ev || ev.type !== 'progress' || !isStr(ev.id) || !isStr(ev.ts) || !isStr(ev.subject) || !ev.data) return false;
  const d = ev.data as ProgressData;
  if (typeof d.rules !== 'number' || !isDate(d.on)) return false;
  switch (d.op) {
    case 'quiz':
      return isStr(d.topic) && isScore(d.score) && isStr(d.session) && typeof d.n === 'number' && (d.card === undefined || isStr(d.card));
    case 'quiz-apply':
      return isStr(d.session) && Array.isArray(d.items) && d.items.every((i) => i && isStr(i.topic) && isScore(i.score) && (i.card === undefined || isStr(i.card)));
    case 'endless':
      return isStr(d.topic) && isStr(d.card) && isScore(d.score);
    case 'review':
      return !!d.scores && typeof d.scores === 'object' && Object.values(d.scores).every(isScore) && SOURCES.has(d.source);
    case 'card-review':
      return isStr(d.topic) && isStr(d.card) && isScore(d.score) && SOURCES.has(d.source);
    case 'status':
      return isStr(d.topic) && STATUSES.has(d.status);
    case 'due':
      return isStr(d.topic) && (d.due === null || isDate(d.due));
    case 'reset':
      return isStr(d.topic);
    case 'block':
      return isStr(d.topic) && isStr(d.card) && typeof d.blocked === 'boolean';
    case 'baseline':
      return isStr(d.topic) && !!d.progress && STATUSES.has(d.progress.status);
    default:
      return false;
  }
}

/** A random id for an event (UUID where the platform has one). */
export function newEventId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ruleSettings = (settings?: PackSettings): RuleSettings | undefined => {
  if (!settings) return undefined;
  const cfg: RuleSettings = {};
  if (settings.reviewLadder) cfg.reviewLadder = settings.reviewLadder;
  if (settings.skipWeekends !== undefined) cfg.skipWeekends = settings.skipWeekends;
  return Object.keys(cfg).length ? cfg : undefined;
};

const refOf = (op: ProgressOp): string | undefined => {
  if ('topic' in op) return 'card' in op && op.card ? `${op.topic}/${op.card}` : op.topic;
  return 'session' in op ? op.session : undefined;
};

/** A new progress event for `op`, made now on this device. */
export function progressEvent(
  subject: string,
  op: ProgressOp,
  on: ISODate,
  settings?: PackSettings,
  extra: { actor?: LogEvent['actor']; ts?: string; id?: string } = {},
): ProgressEvent {
  const cfg = ruleSettings(settings);
  const ref = refOf(op);
  return {
    id: extra.id ?? newEventId(),
    ts: extra.ts ?? new Date().toISOString(),
    type: 'progress',
    actor: extra.actor ?? 'user',
    subject,
    ...(ref ? { ref } : {}),
    data: { ...op, rules: RULES, on, ...(cfg ? { cfg } : {}) } as ProgressEvent['data'],
  };
}

/** A graded quiz as one op: every item with a topic and a score, in order. */
export const quizApplyOp = (session: Session): ProgressOp => ({
  op: 'quiz-apply',
  session: session.id,
  items: session.items
    .filter((it) => it.topicId && it.score !== undefined)
    .map((it) => ({ topic: it.topicId!, ...(it.question ? { card: it.question } : {}), score: it.score! })),
});

// ---------------------------------------------------------------------------
// Applying events

const mapTopic = (subject: Subject, id: string, change: (t: Topic) => Topic): Subject =>
  subject.topics.some((t) => t.id === id) ? { ...subject, topics: subject.topics.map((t) => (t.id === id ? change(t) : t)) } : subject;

const findCard = (subject: Subject, topic: string, card?: string): TopicQuestion | undefined =>
  card === undefined ? undefined : subject.topics.find((t) => t.id === topic)?.questions?.find((q) => q.id === card);

/** The topic without any progress: new, no dates, no history, cards never answered. */
export function stripTopic(t: Topic): Topic {
  const out: Topic = { ...t, status: 'new' };
  delete out.due;
  delete out.intervalDays;
  delete out.history;
  if (t.questions) {
    out.questions = t.questions.map((q) => {
      const c = { ...q };
      for (const k of CARD_PROGRESS) delete c[k];
      return c;
    });
  }
  return out;
}

/** The topic as the replay starts it: no progress, and no card blocked yet (blocks come from baseline and block events). */
function replayStart(t: Topic): Topic {
  const out = stripTopic(t);
  if (out.questions) out.questions = out.questions.map(({ blocked: _b, ...q }) => q);
  return out;
}

/** The progress of a topic, for a baseline event. */
export function progressOf(t: Topic): TopicProgress {
  const p: TopicProgress = { status: t.status };
  if (t.due !== undefined) p.due = t.due;
  if (t.intervalDays !== undefined) p.intervalDays = t.intervalDays;
  if (t.history !== undefined) p.history = t.history;
  const cards: Record<string, CardProgress> = {};
  for (const q of t.questions ?? []) {
    const c: CardProgress = {};
    for (const k of CARD_PROGRESS) if (q[k] !== undefined) (c as Record<string, unknown>)[k] = q[k];
    if (q.blocked) c.blocked = true;
    if (Object.keys(c).length) cards[q.id] = c;
  }
  if (Object.keys(cards).length) p.cards = cards;
  return p;
}

function withProgress(t: Topic, p: TopicProgress): Topic {
  const out = replayStart(t);
  out.status = p.status;
  if (p.due !== undefined) out.due = p.due;
  if (p.intervalDays !== undefined) out.intervalDays = p.intervalDays;
  if (p.history !== undefined) out.history = p.history;
  if (out.questions && p.cards) out.questions = out.questions.map((q) => (p.cards![q.id] ? { ...q, ...p.cards![q.id] } : q));
  return out;
}

/** State the replay keeps between events: each quiz answer's card before its first rating. */
export interface ReplayState {
  before: Map<string, TopicQuestion | undefined>;
}

const quizSession = (id: string, items: Session['items']): Session => ({ id, type: 'quiz', subject: '', startedAt: '', items });

/** Applies one event to a subject with rules version 1. */
function applyV1(s: Subject, e: ProgressEvent, state: ReplayState): Subject {
  const d = e.data;
  const settings: PackSettings | undefined = d.cfg;
  const on = d.on;
  switch (d.op) {
    case 'quiz': {
      const item = { n: d.n, topicId: d.topic, ...(d.card !== undefined ? { question: d.card } : {}) } as Session['items'][number];
      const root = d.replaces && state.before.has(d.replaces) ? d.replaces : undefined;
      if (!root) state.before.set(e.id, findCard(s, d.topic, d.card));
      return withQuizAnswer(s, quizSession(d.session, [item]), item, d.score, on, settings, root ? state.before.get(root) : undefined);
    }
    case 'quiz-apply':
      return withQuizResults(
        s,
        quizSession(
          d.session,
          d.items.map((it, i) => ({ n: i + 1, topicId: it.topic, ...(it.card !== undefined ? { question: it.card } : {}), score: it.score }) as Session['items'][number]),
        ),
        on,
        settings,
      );
    case 'endless': {
      const q = findCard(s, d.topic, d.card);
      const reviewed =
        !q || q.stats?.last === on
          ? s
          : mapTopic(s, d.topic, (t) => applyCardReviews(t, [{ question: d.card, score: d.score }], { date: on, source: 'quiz' }, settings));
      const topic = reviewed.topics.find((t) => t.id === d.topic);
      return topic ? withCardAnswer(reviewed, { topic, question: { id: d.card } as TopicQuestion }, d.score, on) : reviewed;
    }
    case 'review': {
      const review = (score: Score): Review => ({
        date: on,
        score,
        source: d.source,
        ...(d.session ? { sessionId: d.session } : {}),
        ...(d.note ? { note: d.note } : {}),
      });
      return { ...s, topics: s.topics.map((t) => (Object.prototype.hasOwnProperty.call(d.scores, t.id) ? applyReview(t, review(d.scores[t.id]), settings) : t)) };
    }
    case 'card-review':
      return mapTopic(s, d.topic, (t) =>
        applyCardReviews(t, [{ question: d.card, score: d.score }], { date: on, source: d.source, ...(d.note ? { note: d.note } : {}) }, settings),
      );
    case 'status':
      return mapTopic(s, d.topic, (t) => {
        const next: Topic = { ...t, status: d.status };
        if (d.status === 'skip') {
          delete next.due;
          delete next.intervalDays;
        }
        return next;
      });
    case 'due':
      return mapTopic(s, d.topic, (t) => withTopicDue(t, d.due ?? undefined));
    case 'reset':
      return mapTopic(s, d.topic, stripTopic);
    case 'block':
      return withCardBlocked(s, { topic: { id: d.topic } as Topic, question: { id: d.card } as TopicQuestion }, d.blocked);
    case 'baseline':
      return mapTopic(s, d.topic, (t) => withProgress(t, d.progress));
  }
}

export const newReplayState = (): ReplayState => ({ before: new Map() });

/** Applies one event; events of unknown rules versions change nothing (a newer app wrote them). */
export function applyEvent(s: Subject, e: ProgressEvent, state: ReplayState = newReplayState()): Subject {
  if (e.subject !== s.id) return s;
  if (e.data.rules === 1) return applyV1(s, e, state);
  return s;
}

/**
 * Replay order: baselines first (a device clock that runs behind must not put
 * an answer before the migration), then by time, then by id so every device
 * gets the same order.
 */
export function compareEvents(a: ProgressEvent, b: ProgressEvent): number {
  const ba = a.data.op === 'baseline' ? 0 : 1;
  const bb = b.data.op === 'baseline' ? 0 : 1;
  return ba - bb || (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The subject's progress from scratch: its content, stripped, plus every event
 * of this subject, in replay order. Blocked cards: the replay follows when each
 * card was blocked (baseline and block events), so earlier answers keep
 * counting; at the end every card is blocked exactly as its file says.
 */
export function replaySubject(subject: Subject, events: ProgressEvent[]): Subject {
  const mine = events.filter((e) => e.subject === subject.id).sort(compareEvents);
  const state = newReplayState();
  let s: Subject = { ...subject, topics: subject.topics.map(replayStart) };
  for (const e of mine) s = applyEvent(s, e, state);
  const blocked = new Set(subject.topics.flatMap((t) => (t.questions ?? []).filter((q) => q.blocked).map((q) => `${t.id}/${q.id}`)));
  return {
    ...s,
    topics: s.topics.map((t) =>
      t.questions
        ? {
            ...t,
            questions: t.questions.map(({ blocked: _b, ...q }) => (blocked.has(`${t.id}/${q.id}`) ? { ...q, blocked: true } : q)),
          }
        : t,
    ),
  };
}

/** Events of rules versions this app does not know (written by a newer app). */
export const unknownRules = (events: ProgressEvent[]) => events.filter((e) => e.data.rules !== RULES);

/** Progress events of a log, without duplicates (first occurrence of an id wins); counts lines that are not usable. */
export function parseProgress(text: string): { events: ProgressEvent[]; skipped: number } {
  const seen = new Set<string>();
  const events: ProgressEvent[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.includes('"progress"')) continue;
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if ((e as LogEvent).type !== 'progress') continue;
    if (!isProgressEvent(e)) {
      skipped++;
      continue;
    }
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    events.push(e);
  }
  return { events, skipped };
}
