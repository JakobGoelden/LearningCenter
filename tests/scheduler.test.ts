import { describe, expect, it } from 'vitest';
import { applyReview, pickQuizTopics, schedule, shiftOffWeekend } from '../src/scheduling/scheduler';
import type { Topic } from '../src/model/types';

const FRI = '2026-10-16';
const MON = '2026-10-19';

describe('scheduler', () => {
  it('moves weekend dates to Monday', () => {
    expect(shiftOffWeekend('2026-10-17')).toBe(MON);
    expect(shiftOffWeekend('2026-10-18')).toBe(MON);
    expect(shiftOffWeekend(MON)).toBe(MON);
  });

  it('grows the interval 3 → 7 → 14 → 21 for good answers', () => {
    let t: Topic = { id: 'a', title: 'A', status: 'new' };
    const intervals: number[] = [];
    let date = '2026-10-14'; // Wednesday
    for (let i = 0; i < 4; i++) {
      t = applyReview(t, { date, score: 5, source: 'quiz' }, { skipWeekends: false });
      intervals.push(t.intervalDays!);
      date = t.due!;
    }
    expect(intervals).toEqual([3, 7, 14, 21]);
    expect(t.status).toBe('solid');
  });

  it('keeps shaky topics short', () => {
    const r = schedule({ status: 'solid', intervalDays: 21 }, 3, FRI, { skipWeekends: false });
    expect(r.intervalDays).toBe(3);
    expect(r.status).toBe('shaky');
    const bad = schedule({ status: 'solid', intervalDays: 21 }, 1, FRI);
    expect(bad.intervalDays).toBe(1);
  });

  it('confirms a shaky topic once more before long gaps', () => {
    const r = schedule({ status: 'shaky', intervalDays: 14 }, 5, FRI, { skipWeekends: false });
    expect(r.intervalDays).toBe(7);
  });

  it('never schedules on weekends by default', () => {
    const r = schedule({ status: 'new' }, 1, FRI); // Fri + 1 = Sat
    expect(r.due).toBe(MON);
  });

  it('never schedules skipped topics', () => {
    expect(schedule({ status: 'skip' }, 5, FRI).due).toBeUndefined();
  });

  it('picks due topics first and leaves out skipped ones', () => {
    const topics: Topic[] = [
      { id: 'new', title: '', status: 'new' },
      { id: 'skip', title: '', status: 'skip', due: '2026-01-01' },
      { id: 'due', title: '', status: 'solid', due: '2026-10-10' },
      { id: 'shaky', title: '', status: 'shaky', due: '2026-10-30' },
    ];
    expect(pickQuizTopics(topics, FRI, 3).map((t) => t.id)).toEqual(['due', 'shaky', 'new']);
  });
});
