import { describe, expect, it } from 'vitest';
import { comboFor, drillPoints, roundPoints, type PointsInput } from '../src/dojo/points';

const right = { correct: true, score: 5 as const, feedback: '' };
const partly = { correct: false, score: 3 as const, feedback: '' };
const wrong = { correct: false, score: 1 as const, feedback: '' };
const at = (result: PointsInput['result'], over: Partial<PointsInput> = {}): PointsInput => ({ level: 'medium', result, limit: 100, seconds: 100, timed: true, ...over });

describe('drill points', () => {
  it('gives the level base for right, half for partly, nothing for wrong', () => {
    expect(drillPoints(at(right, { level: 'easy' }), 0).points).toBe(10);
    expect(drillPoints(at(right), 0).points).toBe(20);
    expect(drillPoints(at(right, { level: 'exam' }), 0).points).toBe(40);
    expect(drillPoints(at(partly), 0).points).toBe(10);
    expect(drillPoints(at(wrong), 0).points).toBe(0);
  });

  it('adds up to half the base for time left, only with a timer and a right answer', () => {
    expect(drillPoints(at(right, { seconds: 0 }), 0)).toMatchObject({ base: 20, speed: 10, points: 30 });
    expect(drillPoints(at(right, { seconds: 50 }), 0).speed).toBe(5);
    expect(drillPoints(at(right, { seconds: 0, timed: false }), 0).speed).toBe(0);
    expect(drillPoints(at(partly, { seconds: 0 }), 0).speed).toBe(0);
    expect(drillPoints(at(right, { seconds: 500 }), 0).speed).toBe(0);
  });

  it('multiplies streaks: ×1.5 from 3 right in a row, ×2 from 5', () => {
    expect([1, 2, 3, 4, 5, 9].map(comboFor)).toEqual([1, 1, 1.5, 1.5, 2, 2]);
    expect(drillPoints(at(right), 2)).toMatchObject({ streak: 3, combo: 1.5, points: 30 });
    expect(drillPoints(at(partly), 4)).toMatchObject({ streak: 0, combo: 1, points: 10 });
  });

  it('sums a round and tracks the longest streak', () => {
    const r = roundPoints([at(right), at(right), at(right), at(wrong), at(right)]);
    expect(r.each.map((p) => p.points)).toEqual([20, 20, 30, 0, 20]);
    expect(r.total).toBe(90);
    expect(r.bestStreak).toBe(3);
  });
});
