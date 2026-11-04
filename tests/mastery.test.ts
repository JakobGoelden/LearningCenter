import { describe, expect, it } from 'vitest';
import { dojoMastery, drillHistory, drillMastery, practiceNeed } from '../src/dojo/mastery';
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

describe('drill mastery', () => {
  it('is 0 untried, weighs recent scores more, and fades after a week without practice', () => {
    expect(drillMastery(undefined, ON)).toBe(0);
    expect(drillMastery([{ date: ON, score: 5 }], ON)).toBe(1);
    const up = drillMastery([{ date: ON, score: 1 }, { date: ON, score: 5 }], ON);
    const down = drillMastery([{ date: ON, score: 5 }, { date: ON, score: 1 }], ON);
    expect(up).toBeGreaterThan(down);
    expect(drillMastery([{ date: '2026-10-28', score: 5 }], ON)).toBe(1);
    expect(drillMastery([{ date: '2026-09-28', score: 5 }], ON)).toBeCloseTo(0.5, 5);
  });
});

describe('dojo mastery', () => {
  const d = dojo('a', [drill('e', 'easy'), drill('x', 'exam')]);

  it('counts untried drills as 0 and exam drills three times as much as easy ones', () => {
    const easyOnly = dojoMastery(d, drillHistory([round('a', ON, { e: 5 })], [d]), ON);
    expect(easyOnly).toMatchObject({ tried: 1, total: 2 });
    expect(easyOnly.score).toBeCloseTo(1 / 4, 5);
    const examOnly = dojoMastery(d, drillHistory([round('a', ON, { x: 5 })], [d]), ON);
    expect(examOnly.score).toBeCloseTo(3 / 4, 5);
    expect(examOnly.levels).toEqual({ easy: 0, exam: 1 });
    expect(examOnly.last).toBe(ON);
  });

  it('finds drills of practice exams and of dojos that were split up', () => {
    const b = dojo('b', [drill('moved', 'exam')]);
    const h = drillHistory([round(PRACTICE_EXAM, ON, { 'a.x': 4 }), round('old-dojo', ON, { moved: 5 })], [d, b]);
    expect(h.get('a')?.get('x')).toEqual([{ date: ON, score: 4 }]);
    expect(h.get('b')?.get('moved')).toEqual([{ date: ON, score: 5 }]);
  });

  it('ranks what to practice by the gap to full mastery and the share of the exam', () => {
    const big = dojo('big', [drill('1')], 60);
    const small = dojo('small', [drill('2')], 20);
    const free = dojo('free', [drill('3')]);
    const all = [big, small, free];
    const none = drillHistory([], all);
    const need = (x: Dojo) => practiceNeed(x, dojoMastery(x, none, ON), all);
    expect(need(big)).toBeGreaterThan(need(small));
    expect(need(free)).toBeCloseTo(need(small) / 2, 5);
    const solved = drillHistory([round('big', ON, { '1': 5 })], all);
    expect(practiceNeed(big, dojoMastery(big, solved, ON), all)).toBe(0);
  });
});
