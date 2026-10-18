import { describe, expect, it } from 'vitest';
import { cardPriority, deckOf, drawCard, recordCard } from '../src/scheduling/cards';
import { allBlocked, questionFor } from '../src/model/quiz';
import type { Subject, Topic } from '../src/model/types';

const topic = (id: string, qs: Topic['questions'], status: Topic['status'] = 'new'): Topic => ({ id, title: id, status, questions: qs });
const subject = (topics: Topic[]) => ({ id: 's', name: 's', exam: { format: 'unknown' }, topics }) as Subject;

describe('card priority', () => {
  it('ranks weak cards above strong ones, unseen in between', () => {
    const on = '2026-10-18';
    const weak = recordCard(recordCard(undefined, 1, on), 0, on);
    const strong = recordCard(recordCard(undefined, 5, on), 5, on);
    expect(cardPriority(weak, on)).toBeGreaterThan(cardPriority(undefined, on));
    expect(cardPriority(undefined, on)).toBeGreaterThan(cardPriority(strong, on));
  });

  it('weighs recent answers more and keeps five', () => {
    let st = undefined as ReturnType<typeof recordCard> | undefined;
    for (const sc of [0, 0, 0, 0, 0, 5, 5] as const) st = recordCard(st, sc, '2026-10-18');
    expect(st!.recent).toEqual([0, 0, 0, 5, 5]);
    expect(st!.seen).toBe(7);
  });

  it('raises a strong card the longer it was not seen', () => {
    const st = recordCard(undefined, 5, '2026-09-01');
    expect(cardPriority(st, '2026-10-18')).toBeGreaterThan(cardPriority(st, '2026-09-02'));
  });
});

describe('deck and drawing', () => {
  const q = (id: string, blocked = false) => ({ id, prompt: id, ...(blocked ? { blocked } : {}) });

  it('leaves out blocked cards and skipped topics', () => {
    const s = subject([topic('a', [q('1'), q('2', true)]), topic('b', [q('1')], 'skip'), topic('c', undefined)]);
    expect(deckOf(s).map((c) => c.question.id)).toEqual(['1']);
  });

  it('never draws a blocked card and holds back the last ones', () => {
    const s = subject([topic('a', [q('1'), q('2'), q('3', true), q('4'), q('5')])]);
    const deck = deckOf(s);
    const shown: string[] = [];
    for (let i = 0; i < 50; i++) {
      const c = drawCard(deck, '2026-10-18', shown)!;
      expect(c.question.id).not.toBe('3');
      expect(shown.slice(-3)).not.toContain(`a/${c.question.id}`);
      shown.push(`a/${c.question.id}`);
    }
  });

  it('draws mostly weak cards', () => {
    const on = '2026-10-18';
    const weak = { ...q('w'), stats: recordCard(undefined, 0, on) };
    const strong = { ...q('s'), stats: recordCard(undefined, 5, on) };
    const deck = deckOf(subject([topic('a', [weak, strong])]));
    let w = 0;
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 400; i++) if (drawCard(deck, on, [], rnd)!.question.id === 'w') w++;
    expect(w).toBeGreaterThan(300);
  });

  it('quizzes skip blocked questions and report a fully blocked topic', () => {
    const t = topic('a', [q('1', true), q('2')]);
    expect(questionFor(t).id).toBe('2');
    expect(allBlocked(topic('a', [q('1', true)]))).toBe(true);
    expect(allBlocked(topic('a', undefined))).toBe(false);
  });
});
