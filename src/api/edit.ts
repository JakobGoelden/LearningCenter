// The changes an AI may make through the API. Fields the app owns (stats,
// schedule, `blocked`) stay as they are; every change lands in the event log.

import { today } from '../lib/dates';
import { activeTopics, withTopicsEnabled } from '../model/chapters';
import { applyCardReviews, applyReview } from '../scheduling/scheduler';
import { appendEvent, appendEventsTo, loadPack, readEvents, saveSubject } from '../storage/repo';
import { progressEvent, replaySubject, type ProgressOp } from '../progress/ops';
import type { PackFs } from '../storage/fs';
import type { LogEvent, QuestionKind, Review, Score, Subject, Topic, TopicQuestion } from '../model/types';
import { pendingResults } from '../model/sync';
import { findSubject, findTopic } from './insights';

type Fresh = { subject: Subject; topic: Topic };

/** Re-reads the file right before changing it, so edits never run on a stale copy. */
async function changeTopic(
  fs: PackFs,
  subjectId: string,
  topicId: string,
  change: (f: Fresh) => Topic,
  event: Pick<LogEvent, 'type' | 'data'>,
): Promise<Topic> {
  const subject = findSubject(await loadPack(fs), subjectId);
  const topic = change({ subject, topic: findTopic(subject, topicId) });
  await saveSubject(fs, { ...subject, topics: subject.topics.map((t) => (t.id === topicId ? topic : t)) });
  await appendEvent(fs, { actor: 'ai', subject: subjectId, ref: topicId, ...event });
  return topic;
}

const SLUG = /^[a-z0-9][a-z0-9._-]*$/;

export interface NewCard {
  subject: string;
  topic: string;
  id: string;
  prompt: string;
  answer: string;
  kind?: QuestionKind;
}

export async function addCard(fs: PackFs, c: NewCard) {
  if (!SLUG.test(c.id)) throw new Error(`Card id "${c.id}" must be a lowercase slug (a-z 0-9 . _ -).`);
  await changeTopic(
    fs,
    c.subject,
    c.topic,
    ({ topic }) => {
      if (topic.questions?.some((q) => q.id === c.id)) throw new Error(`Card "${c.id}" already exists in ${c.topic}. Change it with edit_card.`);
      const card: TopicQuestion = { id: c.id, prompt: c.prompt, ...(c.kind ? { kind: c.kind } : {}), answer: c.answer };
      return { ...topic, questions: [...(topic.questions ?? []), card] };
    },
    { type: 'question.add', data: { card: c.id } },
  );
  return { added: `${c.subject}/${c.topic}/${c.id}`, state: 'new' };
}

export interface CardEdit {
  subject: string;
  topic: string;
  id: string;
  prompt?: string;
  answer?: string;
  kind?: QuestionKind;
}

/** Changes what a card says. Its schedule and statistics stay. */
export async function editCard(fs: PackFs, e: CardEdit) {
  const fields = (['prompt', 'answer', 'kind'] as const).filter((k) => e[k] !== undefined);
  if (!fields.length) throw new Error('Nothing to change: give prompt, answer or kind.');
  await changeTopic(
    fs,
    e.subject,
    e.topic,
    ({ topic }) => {
      const q = topic.questions?.find((x) => x.id === e.id);
      if (!q) throw new Error(`Unknown card "${e.id}" in ${e.topic}. Known: ${(topic.questions ?? []).map((x) => x.id).join(', ')}`);
      if (q.blocked) throw new Error(`Card "${e.id}" is blocked by the learner and stays as it is.`);
      const edited = { ...q, ...Object.fromEntries(fields.map((k) => [k, e[k]])) };
      return { ...topic, questions: topic.questions!.map((x) => (x.id === e.id ? edited : x)) };
    },
    { type: 'question.edit', data: { card: e.id, fields } },
  );
  return { edited: `${e.subject}/${e.topic}/${e.id}`, fields, keptSchedule: true };
}

export async function setTopicNotes(fs: PackFs, subject: string, topic: string, notes: string) {
  await changeTopic(fs, subject, topic, ({ topic: t }) => ({ ...t, notes }), { type: 'topic.notes' });
  return { updated: `${subject}/${topic}` };
}

export interface ReviewInput {
  subject: string;
  topic: string;
  score: Score;
  source?: Review['source'];
  note?: string;
  card?: string;
}

/** Records a grade with the app's own rules. With `card` only that card is rescheduled. */
export async function recordReview(fs: PackFs, r: ReviewInput) {
  const loaded = await loadPack(fs);
  const source = r.source ?? 'quiz';
  const date = today();
  if (loaded.pack.progress === 'events') {
    // Migrated pack: the grade is one progress event; the subject file stays as it is.
    const subject = findSubject(loaded, r.subject);
    const topic = findTopic(subject, r.topic);
    if (r.card && !topic.questions?.some((q) => q.id === r.card)) {
      throw new Error(`Unknown card "${r.card}". Known: ${(topic.questions ?? []).map((q) => q.id).join(', ')}`);
    }
    const note = r.note ? { note: r.note } : {};
    const op: ProgressOp = r.card
      ? { op: 'card-review', topic: r.topic, card: r.card, score: r.score, source, ...note }
      : { op: 'review', scores: { [r.topic]: r.score }, source, ...note };
    const event = progressEvent(r.subject, op, date, loaded.pack.settings, { actor: 'ai' });
    await appendEventsTo(fs, [event]);
    await appendEvent(fs, { actor: 'ai', subject: r.subject, ref: r.topic, type: 'topic.review', data: { score: r.score, source, ...(r.card ? { card: r.card } : {}) } });
    const after = findTopic(replaySubject(subject, [...(loaded.progress?.events ?? []), event]), r.topic);
    return reviewResult(after, r.card);
  }
  const updated = await changeTopic(
    fs,
    r.subject,
    r.topic,
    ({ topic }) => {
      if (r.card && !topic.questions?.some((q) => q.id === r.card)) {
        throw new Error(`Unknown card "${r.card}". Known: ${(topic.questions ?? []).map((q) => q.id).join(', ')}`);
      }
      return r.card
        ? applyCardReviews(topic, [{ question: r.card, score: r.score }], { date, source, ...(r.note ? { note: r.note } : {}) }, loaded.pack.settings)
        : applyReview(topic, { date, score: r.score, source, ...(r.note ? { note: r.note } : {}) }, loaded.pack.settings);
    },
    { type: 'topic.review', data: { score: r.score, source, ...(r.card ? { card: r.card } : {}) } },
  );
  return reviewResult(updated, r.card);
}

function reviewResult(updated: Topic, cardId?: string) {
  const card = cardId ? updated.questions?.find((q) => q.id === cardId) : undefined;
  return {
    status: updated.status,
    topicDue: updated.due ?? null,
    intervalDays: updated.intervalDays ?? null,
    ...(card ? { card: { id: card.id, due: card.due ?? null, intervalDays: card.intervalDays ?? null } } : {}),
  };
}

export interface TopicSwitch {
  subject: string;
  enabled: boolean;
  /** Topic ids; with `match` the topics must fit both. Neither: every topic of the subject. */
  topics?: string[];
  /** Part of the topic title, ignoring case. */
  match?: string;
}

/** Switches topics on or off. Progress stays, see `withTopicsEnabled`. */
export async function setTopicsEnabled(fs: PackFs, r: TopicSwitch) {
  const subject = findSubject(await loadPack(fs), r.subject);
  for (const id of r.topics ?? []) findTopic(subject, id);
  const match = r.match?.toLowerCase();
  const picked = (t: Topic) => (!r.topics || r.topics.includes(t.id)) && (!match || t.title.toLowerCase().includes(match));
  const changed = subject.topics.filter((t) => picked(t) && (t.enabled !== false) !== r.enabled);
  if (changed.length) {
    await saveSubject(fs, withTopicsEnabled(subject, picked, r.enabled));
    await appendEvent(fs, { type: 'topic.enabled', actor: 'ai', subject: r.subject, data: { enabled: r.enabled, topics: changed.map((t) => t.id) } });
  }
  return { changed: changed.length, enabled: r.enabled, activeTopics: activeTopics(withTopicsEnabled(subject, picked, r.enabled)).length };
}

/** Marks everything up to now as seen, which clears the "New results" banner. */
export async function markProcessed(fs: PackFs) {
  const p = pendingResults(await readEvents(fs, Number.MAX_SAFE_INTEGER));
  const data = { quizzes: p.quizzes, dojo: p.dojo, sheets: p.sheets };
  await appendEvent(fs, { type: 'ai.sync', actor: 'ai', data });
  return { processed: data, stillToGrade: p.toGrade };
}
