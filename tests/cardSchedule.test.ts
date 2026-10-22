import { describe, expect, it } from 'vitest';
import {
  applyCardReviews,
  cardDue,
  dueCards,
  dueCount,
  newCards,
  quizCards,
  studyPlan,
  withOwnCardDates,
  withTopicDue,
} from '../src/scheduling/scheduler';
import type { Subject, Topic, TopicQuestion } from '../src/model/types';

const MON = '2026-10-19';
const THU = '2026-10-22';
const q = (id: string, extra: Partial<TopicQuestion> = {}): TopicQuestion => ({ id, prompt: id, ...extra });
const subj = (id: string, topics: Topic[], exam?: string) =>
  ({ id, name: id, exam: { format: 'written', ...(exam ? { date: exam } : {}) }, topics }) as unknown as Subject;

describe('card dates', () => {
  it('lets answered cards of an old pack take over the topic date, the others are new', () => {
    const t: Topic = { id: 't', title: 'T', status: 'shaky', due: MON, questions: [q('a', { stats: { seen: 1, recent: [1] } }), q('b')] };
    expect(cardDue(t, t.questions![0])).toBe(MON);
    expect(cardDue(t, t.questions![1])).toBeUndefined();
  });

  it('passes the date of a never answered topic to the card it would ask next', () => {
    const t: Topic = { id: 't', title: 'T', status: 'shaky', due: MON, history: [{ date: '2026-10-10', score: 2, source: 'quiz' }], questions: [q('a'), q('b')] };
    expect([cardDue(t, t.questions![0]), cardDue(t, t.questions![1])]).toEqual([undefined, MON]);
    expect(withOwnCardDates(t).questions!.map((x) => x.due)).toEqual([undefined, MON]);
  });

  it('uses the topic date for a topic without prepared questions', () => {
    const t: Topic = { id: 't', title: 'T', status: 'shaky', due: MON };
    expect(dueCards(subj('s', [t]), THU).map((c) => c.question.id)).toEqual(['_']);
  });
});

describe('applyCardReviews', () => {
  const topic = (): Topic => ({
    id: 't',
    title: 'T',
    status: 'shaky',
    due: MON,
    intervalDays: 1,
    questions: [q('a', { due: MON, intervalDays: 3, stats: { seen: 2, recent: [5, 5] } }), q('b', { due: MON, intervalDays: 1 }), q('c')],
  });

  it('schedules every card on its own and the topic with its earliest card', () => {
    const t = applyCardReviews(topic(), [{ question: 'a', score: 5 }, { question: 'b', score: 1 }], { date: THU, source: 'quiz' });
    const [a, b, c] = t.questions!;
    expect([a.due, a.intervalDays]).toEqual(['2026-10-29', 7]); // 3 → 7 days
    expect([b.due, b.intervalDays]).toEqual(['2026-10-23', 1]); // wrong → tomorrow
    expect(c.due).toBeUndefined(); // not asked: still new
    expect(t.due).toBe('2026-10-23');
    expect(t.history!.at(-1)!.score).toBe(3);
  });

  it('starts a new card on the ladder and remembers the day for the budget', () => {
    const t = applyCardReviews(topic(), [{ question: 'c', score: 5 }], { date: THU, source: 'quiz' });
    const c = t.questions![2];
    expect([c.due, c.intervalDays, c.since]).toEqual(['2026-10-26', 3, THU]); // Sun → Mon
  });

  it('does not lose the inherited dates of the other cards', () => {
    const old: Topic = { id: 't', title: 'T', status: 'shaky', due: MON, questions: [q('a', { stats: { seen: 1, recent: [2] } }), q('b', { stats: { seen: 1, recent: [2] } })] };
    const t = applyCardReviews(old, [{ question: 'a', score: 5 }], { date: THU, source: 'quiz' });
    expect(t.questions![1].due).toBe(MON);
    expect(t.due).toBe(MON);
  });

  it('sets a date by hand for the topic and every card', () => {
    const t = withTopicDue(topic(), '2026-11-02');
    expect(t.questions!.map((x) => x.due)).toEqual(['2026-11-02', '2026-11-02', '2026-11-02']);
  });
});

describe('new cards', () => {
  const fresh = (id: string, n: number): Topic => ({ id, title: id, status: 'new', questions: Array.from({ length: n }, (_, i) => q(`${id}${i}`)) });

  it('brings in at most the daily budget, subjects taking turns from the nearest exam', () => {
    const math = subj('math', [fresh('m', 5)], '2026-12-14');
    const db = subj('db', [fresh('d', 5)], '2026-12-16');
    const cards = newCards([db, math], THU, { newCardsPerDay: 4 });
    expect(cards.map((c) => c.question.id)).toEqual(['m0', 'd0', 'm1', 'd1']);
    expect(newCards([db, math], THU, { newCardsPerDay: 4 }, 'db').map((c) => c.question.id)).toEqual(['d0', 'd1']);
  });

  it('counts cards started today against the budget', () => {
    const started = subj('s', [{ ...fresh('a', 3), questions: [q('x', { since: THU, due: '2026-10-23' }), q('y'), q('z')] }]);
    expect(newCards([started], THU, { newCardsPerDay: 2 }).map((c) => c.question.id)).toEqual(['y']);
  });

  it('puts due cards before new ones, and both before cards ahead of their date', () => {
    const t: Topic = { id: 't', title: 'T', status: 'shaky', due: MON, questions: [q('later', { due: '2026-11-01' }), q('now', { due: MON }), q('fresh')] };
    const s = subj('s', [t]);
    expect(quizCards(s, [s], THU).map((c) => c.question.id)).toEqual(['now', 'fresh', 'later']);
    expect(dueCount([s], THU)).toBe(1);
    expect(studyPlan([s], THU, 2)[0].cards.map((c) => c.question.id)).toEqual(['now', 'fresh']);
  });
});
