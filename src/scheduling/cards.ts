import { diffDays } from '../lib/dates';
import { activeQuestions } from '../model/quiz';
import type { CardStats, ISODate, Score, Subject, Topic, TopicQuestion } from '../model/types';

/**
 * Card priority for endless mode. It depends only on how the learner does with
 * the card and is separate from the topic schedule: due dates play no role.
 */

const KEEP = 5;

/** A card in the deck: the question with its topic. */
export interface Card {
  topic: Topic;
  question: TopicQuestion;
}

/** Appends an answer to the card's stats. */
export function recordCard(stats: CardStats | undefined, score: Score, on: ISODate): CardStats {
  return { seen: (stats?.seen ?? 0) + 1, recent: [...(stats?.recent ?? []), score].slice(-KEEP), last: on };
}

const mapQuestion = (subject: Subject, card: Pick<Card, 'topic' | 'question'>, change: (q: TopicQuestion) => TopicQuestion): Subject => ({
  ...subject,
  topics: subject.topics.map((t) =>
    t.id !== card.topic.id ? t : { ...t, questions: t.questions?.map((q) => (q.id === card.question.id ? change(q) : q)) },
  ),
});

/** The subject with one answer added to the card's stats. */
export const withCardAnswer = (subject: Subject, card: Card, score: Score, on: ISODate): Subject =>
  mapQuestion(subject, card, (q) => ({ ...q, stats: recordCard(q.stats, score, on) }));

/** The subject with the card blocked (or unblocked). The card stays in the file. */
export const withCardBlocked = (subject: Subject, card: Pick<Card, 'topic' | 'question'>, blocked = true): Subject =>
  mapQuestion(subject, card, ({ blocked: _old, ...q }) => (blocked ? { ...q, blocked } : q));

/**
 * Weight of a card, higher = comes up more often. Cards never seen count as
 * fairly weak (they have to be tried), recent answers weigh more than older
 * ones, and a card not seen for a while creeps up so strong cards still return.
 */
export function cardPriority(stats: CardStats | undefined, on: ISODate): number {
  if (!stats?.recent.length) return 3;
  let sum = 0;
  let weights = 0;
  stats.recent.forEach((score, i) => {
    const w = i + 1;
    sum += score * w;
    weights += w;
  });
  const weakness = 1 - sum / weights / 5; // 0 = always right … 1 = always wrong
  const idle = stats.last ? Math.min(diffDays(stats.last, on), 30) / 30 : 0;
  return 0.3 + weakness * 4 + idle;
}

/** All cards of a subject that may be asked: not blocked, topic not skipped. */
export function deckOf(subject: Subject): Card[] {
  return subject.topics
    .filter((t) => t.status !== 'skip')
    .flatMap((topic) => activeQuestions(topic).map((question) => ({ topic, question })));
}

export const cardKey = (c: Card) => `${c.topic.id}/${c.question.id}`;

/**
 * Draws the next card by priority. The last few cards shown are held back so
 * a weak card does not come twice in a row. `random` is injectable for tests.
 */
export function drawCard(deck: Card[], on: ISODate, recent: string[] = [], random: () => number = Math.random): Card | null {
  if (!deck.length) return null;
  const holdBack = Math.min(3, deck.length - 1);
  const skip = new Set(recent.slice(-holdBack));
  const pool = deck.filter((c) => !skip.has(cardKey(c)));
  const weights = pool.map((c) => cardPriority(c.question.stats, on));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
