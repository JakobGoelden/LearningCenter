import { describe, expect, it } from 'vitest';
import { applyReview, dueCount, pickQuizTopics, schedule, shiftOffWeekend, studyCandidates, studyCount, studyPlan, studyPriority } from '../src/scheduling/scheduler';
import type { Score, Subject, Topic } from '../src/model/types';

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

describe('study plan', () => {
  const subj = (id: string, topics: Topic[], examDate?: string) =>
    ({ id, name: id, exam: { format: 'written', ...(examDate ? { date: examDate } : {}) }, topics }) as unknown as Subject;
  const weak: Topic = { id: 'weak', title: 'W', status: 'shaky', due: '2026-10-14', history: [{ date: '2026-10-13', score: 1, source: 'quiz' }] };
  const strong: Topic = { id: 'strong', title: 'S', status: 'solid', due: '2026-10-14', history: [{ date: '2026-10-11', score: 5, source: 'quiz' }] };
  const fresh: Topic = { id: 'new', title: 'N', status: 'new' };
  const later: Topic = { id: 'later', title: 'L', status: 'solid', due: '2026-10-30' };
  const skipped: Topic = { id: 'skip', title: 'K', status: 'skip', due: '2026-10-01' };

  it('ranks weak due topics above strong ones and leaves out what is not needed', () => {
    expect(studyPriority(weak, FRI)).toBeGreaterThan(studyPriority(strong, FRI));
    expect(studyPriority(strong, FRI)).toBeGreaterThan(studyPriority(fresh, FRI));
    expect(studyPriority(later, FRI)).toBe(0);
    expect(studyPriority(skipped, FRI)).toBe(0);
  });

  it('raises topics of a subject with an exam soon', () => {
    expect(studyPriority(fresh, FRI, '2026-10-20')).toBeGreaterThan(studyPriority(fresh, FRI, '2026-12-20'));
  });

  it('groups the most pressing topics per subject', () => {
    const plan = studyPlan([subj('a', [fresh, later]), subj('b', [strong, weak, skipped])], FRI, 2);
    expect(plan.map((b) => [b.subject.id, b.topics.map((t) => t.id)])).toEqual([['b', ['weak', 'strong']]]);
    expect(studyPlan([subj('a', [later])], FRI, 5)).toEqual([]);
  });

  it('puts a due topic before a weak one that is not due', () => {
    const known: Topic = { id: 'known', title: 'K', status: 'solid', due: FRI, history: [5, 5, 5].map((score) => ({ date: '2026-10-10', score: score as Score, source: 'quiz' as const })) };
    const weakLater: Topic = { id: 'weak-later', title: 'W', status: 'shaky', due: '2026-10-20', history: [{ date: '2026-10-12', score: 1, source: 'quiz' }] };
    expect(studyPriority(weakLater, FRI)).toBeGreaterThan(studyPriority(known, FRI));
    const plan = studyPlan([subj('a', [weakLater]), subj('b', [known])], FRI, 1);
    expect(plan.map((b) => b.topics.map((t) => t.id))).toEqual([['known']]);
  });

  it('does not bring back a topic answered today unless it is due', () => {
    const answered: Topic = { id: 'answered', title: 'A', status: 'shaky', due: '2026-10-19', history: [{ date: FRI, score: 1, source: 'quiz' }] };
    expect(studyPriority(answered, FRI)).toBe(0);
    expect(studyPlan([subj('a', [answered, fresh])], FRI, 5).map((b) => b.topics.map((t) => t.id))).toEqual([['new']]);
  });

  it('sizes a round to everything due, else the usual quiz size', () => {
    const all = [subj('a', [fresh, later]), subj('b', [strong, weak, skipped])];
    expect(dueCount(all, FRI)).toBe(2);
    expect(studyCount(all, FRI, 5)).toBe(2);
    expect(studyCount([subj('a', [fresh, later])], FRI, 5)).toBe(5);
    expect(studyCandidates(all, FRI)).toBe(3);
  });
});
