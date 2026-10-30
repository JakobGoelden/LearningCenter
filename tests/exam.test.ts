import { describe, expect, it } from 'vitest';
import { examScore, ownerDojo, practiceExam } from '../src/dojo/exam';
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
    expect(e.missing.map((d) => d.id)).toEqual([]);
  });

  it('reports a dojo with a weight but no exam task, and without a blueprint every dojo without exam level', () => {
    const e = practiceExam([dojo('a', many('a'), 60), dojo('b', [drill('x', 'easy')], 30), dojo('c', [drill('y', 'easy')])], 60, fixed);
    expect(e.missing.map((d) => d.id)).toEqual(['b']);
    const none = practiceExam([dojo('a', many('a')), dojo('c', [drill('y', 'easy')])], 60, fixed);
    expect(none.missing.map((d) => d.id)).toEqual(['c']);
  });

  it('takes exactly one whole task per dojo when each task fills its share, like the real exam', () => {
    const task = (p: string, i: number, pts: number) => ({ ...drill(`${p}${i}`, 'exam', pts * 54), points: pts });
    const whole = (p: string, pts: number) => dojo(p, [0, 1, 2, 3].map((i) => task(p, i, pts)), pts);
    const e = practiceExam([whole('a', 8), whole('b', 12), whole('c', 30), whole('d', 50)], 90);
    expect(e.parts.map((p) => p.drills.length)).toEqual([1, 1, 1, 1]);
    expect(e.minutes).toBe(90);
    expect(e.drills.reduce((s, d) => s + d.points!, 0)).toBe(100);
  });
});

describe('examScore', () => {
  const task = (id: string, points?: number) => ({ ...drill(id, 'exam'), ...(points ? { points } : {}) });
  const owner = (id: string) => id.split('.')[0];

  it('adds real exam points per part: share if graded in parts, right 1, partly a half', () => {
    const e = examScore(
      [
        { drill: task('a.1', 10), result: { correct: false, score: 4, feedback: '', share: 0.7 } },
        { drill: task('a.2', 8), result: { correct: true, score: 5, feedback: '' } },
        { drill: task('b.1', 20), result: { correct: false, score: 3, feedback: '' } },
        { drill: task('b.2', 2), result: { correct: false, score: 1, feedback: '' } },
      ],
      owner,
    );
    expect(e).toEqual({
      earned: 25,
      max: 40,
      parts: [
        { id: 'a', earned: 15, max: 18 },
        { id: 'b', earned: 10, max: 22 },
      ],
    });
  });

  it('gives no total while a task has no points', () => {
    expect(examScore([{ drill: task('a.1'), result: { correct: true, score: 5, feedback: '' } }], owner)).toBeNull();
  });

  it('finds the dojo of a drill even if the drill id has dots', () => {
    expect(ownerDojo([dojo('net', []), dojo('net-2', [])], 'net-2.a.b')?.id).toBe('net-2');
  });
});
