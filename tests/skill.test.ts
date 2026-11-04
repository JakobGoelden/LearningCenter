import { describe, expect, it } from 'vitest';
import { dojoSkill, drillHistory, evidenceWeight, practiceNeed, PRIOR_WEIGHT } from '../src/dojo/skill';
import { PRACTICE_EXAM } from '../src/dojo/exam';
import type { Dojo, Drill, Level, Session } from '../src/model/types';

const drill = (id: string, level: Level = 'medium'): Drill => ({ id, kind: 'self', prompt: id, solution: 's', level }) as Drill;
const dojo = (id: string, drills: Drill[], points?: number): Dojo =>
  ({ id, subject: 's', title: id, procedure: 'p', promptTemplate: 't', drills, ...(points ? { exam: { points, basis: 'x' } } : {}) }) as Dojo;
const round = (dojoId: string, day: string, scores: Record<string, number>): Session => ({
  id: `${day}-drill-s`,
  type: 'dojo',
  subject: 's',
  dojo: dojoId,
  startedAt: `${day}T10:00:00Z`,
  items: Object.entries(scores).map(([d, score], i) => ({ n: i + 1, kind: 'drill', drill: d, prompt: d, score: score as 0 | 1 | 2 | 3 | 4 | 5 })),
});

const ON = '2026-11-04';
const many = (n: number, level: Level = 'medium') => Array.from({ length: n }, (_, i) => drill(`d${i}`, level));

describe('dojo skill', () => {
  it('counts only the first attempt: repeating a drill does not raise the skill', () => {
    const d = dojo('a', many(4));
    const once = dojoSkill(d, drillHistory([round('a', ON, { d0: 1 })], [d]), ON);
    const drilled = dojoSkill(d, drillHistory([round('a', ON, { d0: 1 }), round('a', ON, { d0: 5 }), round('a', ON, { d0: 5 })], [d]), ON);
    expect(drilled.score).toBe(once.score);
    expect(drilled).toMatchObject({ tried: 1, unseen: 3, total: 4 });
  });

  it('stays low with little evidence and approaches the real rate with many fresh drills', () => {
    const d = dojo('a', many(30));
    const one = dojoSkill(d, drillHistory([round('a', ON, { d0: 5 })], [d]), ON);
    const all = Object.fromEntries(many(30).map((x) => [x.id, 5]));
    const thirty = dojoSkill(d, drillHistory([round('a', ON, all)], [d]), ON);
    expect(one.score).toBeCloseTo(2 / (2 + PRIOR_WEIGHT), 5);
    expect(thirty.score).toBeGreaterThan(0.9);
    expect(thirty.unseen).toBe(0);
  });

  it('weighs exam drills and newer first attempts more', () => {
    const d = dojo('a', [drill('e', 'easy'), drill('x', 'exam')]);
    const examGood = dojoSkill(d, drillHistory([round('a', ON, { e: 0, x: 5 })], [d]), ON);
    const easyGood = dojoSkill(d, drillHistory([round('a', ON, { e: 5, x: 0 })], [d]), ON);
    expect(examGood.score).toBeGreaterThan(easyGood.score);
    expect(examGood.levels).toEqual({ easy: 0, exam: 1 });
    expect(evidenceWeight('2026-10-05', ON)).toBeCloseTo(0.5, 5);
    const oldBad = dojoSkill(dojo('b', many(2)), drillHistory([round('b', '2026-08-01', { d0: 0 }), round('b', ON, { d1: 5 })], [dojo('b', many(2))]), ON);
    const newBad = dojoSkill(dojo('b', many(2)), drillHistory([round('b', '2026-08-01', { d1: 5 }), round('b', ON, { d0: 0 })], [dojo('b', many(2))]), ON);
    expect(oldBad.score).toBeGreaterThan(newBad.score);
  });

  it('finds drills of practice exams and of dojos that were split up', () => {
    const a = dojo('a', [drill('x', 'exam')]);
    const b = dojo('b', [drill('moved', 'exam')]);
    const h = drillHistory([round(PRACTICE_EXAM, ON, { 'a.x': 4 }), round('old-dojo', ON, { moved: 5 })], [a, b]);
    expect(h.get('a')?.get('x')).toEqual([{ date: ON, score: 4 }]);
    expect(h.get('b')?.get('moved')).toEqual([{ date: ON, score: 5 }]);
  });

  it('ranks what to practice by the gap to full skill and the share of the exam', () => {
    const big = dojo('big', [drill('1')], 60);
    const small = dojo('small', [drill('2')], 20);
    const free = dojo('free', [drill('3')]);
    const all = [big, small, free];
    const none = drillHistory([], all);
    const need = (x: Dojo) => practiceNeed(x, dojoSkill(x, none, ON), all);
    expect(need(big)).toBeGreaterThan(need(small));
    expect(need(free)).toBeCloseTo(need(small) / 2, 5);
  });
});
