import { describe, expect, it } from 'vitest';
import { practiceExam } from '../src/dojo/exam';
import type { Dojo, Drill } from '../src/model/types';

const drill = (id: string, level: Drill['level'], seconds = 600): Drill => ({ id, kind: 'self', level, prompt: id, solution: '-', seconds });
const dojo = (id: string, drills: Drill[], points?: number): Dojo => ({
  id,
  subject: 's',
  title: id,
  procedure: id,
  promptTemplate: '',
  drills,
  ...(points ? { exam: { points } } : {}),
});
const fixed = () => 0;

describe('practiceExam', () => {
  const many = (p: string) => Array.from({ length: 10 }, (_, i) => drill(`${p}${i}`, 'exam'));

  it('splits the time by the points from old exams', () => {
    const e = practiceExam([dojo('a', many('a'), 60), dojo('b', many('b'), 30)], 90, fixed);
    expect(e.fromBlueprint).toBe(true);
    expect(e.parts.map((p) => [p.dojo.id, p.drills.length])).toEqual([
      ['a', 6],
      ['b', 3],
    ]);
    expect(e.drills[0].id).toMatch(/^a\./);
  });

  it('uses equal shares when a dojo has no weight yet, and only exam-level drills', () => {
    const e = practiceExam([dojo('a', [...many('a'), drill('easy', 'easy')], 60), dojo('b', many('b'))], 60, fixed);
    expect(e.fromBlueprint).toBe(false);
    expect(e.parts.map((p) => p.drills.length)).toEqual([3, 3]);
    expect(e.drills.some((d) => d.id.endsWith('easy'))).toBe(false);
  });

  it('takes at least one drill per dojo and reports dojos without exam level', () => {
    const e = practiceExam([dojo('a', [drill('long', 'exam', 3600)], 1), dojo('b', many('b'), 99), dojo('c', [drill('x', 'easy')])], 30, fixed);
    expect(e.parts.find((p) => p.dojo.id === 'a')!.drills).toHaveLength(1);
    expect(e.missing.map((d) => d.id)).toEqual(['c']);
  });
});
