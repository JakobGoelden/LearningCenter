import { describe, expect, it } from 'vitest';
import { entriesOn, isoWeek, longTermWeeks, weekStart } from '../src/model/calendar';
import { parseRoute, href } from '../src/ui/router';
import { demoBundle, DEMO_ANCHOR } from '../src/storage/builtin';
import { importBundle, loadPack } from '../src/storage/repo';
import { MemFs } from './memfs';

describe('calendar', async () => {
  const fs = new MemFs();
  await importBundle(fs, demoBundle(DEMO_ANCHOR));
  const loaded = await loadPack(fs);
  const today = DEMO_ANCHOR; // a Friday

  it('finds the week and its number', () => {
    expect(weekStart(today)).toBe('2026-10-12');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(isoWeek('2026-10-16')).toBe(42);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2027-01-04')).toBe(1);
  });

  it('puts overdue reviews and late sheets on today', () => {
    const e = entriesOn(loaded, today, today);
    const theo = e.find((x) => x.kind === 'reviews' && x.subject.id === 'theo');
    expect(theo?.topics).toEqual(['powerset', 'regex']);
    expect(theo?.urgent).toBe(true);
    expect(e.some((x) => x.kind === 'class' && x.time === '12:00')).toBe(true);
  });

  it('shows future reviews, deadlines and classes on their day', () => {
    const mon = entriesOn(loaded, '2026-10-19', today);
    expect(mon.map((x) => x.kind)).toEqual(['class']);
    const fri = entriesOn(loaded, '2026-10-23', today);
    expect(fri.find((x) => x.kind === 'reviews')?.topics).toEqual(['dfa-nfa']);
    const wed = entriesOn(loaded, '2026-10-28', today);
    expect(wed.find((x) => x.kind === 'sheet')?.sheet).toBe('b2');
    expect(entriesOn(loaded, '2027-02-08', today)[0].kind).toBe('exam');
  });

  it('keeps only classes on past days', () => {
    const past = entriesOn(loaded, '2026-10-14', today);
    expect(past.every((x) => x.kind === 'class')).toBe(true);
  });

  it('spans the long term past the end of the semester', () => {
    const weeks = longTermWeeks(loaded, today);
    expect(weeks[0].start).toBe('2026-10-12');
    expect(weeks[0].reviews).toBe(3); // powerset, regex, relational-algebra
    expect(weeks[0].reviewsBy).toEqual({ theo: 2, db: 1 });
    expect(weeks.at(-1)!.start).toBe('2027-03-01'); // two weeks after the semester ends
    expect(weeks.find((w) => w.exams.length)?.start).toBe('2027-02-08');
    expect(weeks.find((w) => w.sheets.some((s) => s.sheet === 'b3'))?.start).toBe('2026-11-02');
  });

  it('routes a review-ahead quiz', () => {
    expect(parseRoute('#/quiz/theo/2026-10-23')).toEqual({ name: 'quiz', subject: 'theo', ahead: '2026-10-23' });
    expect(parseRoute('#/quiz/theo')).toEqual({ name: 'quiz', subject: 'theo', ahead: undefined });
    expect(href({ name: 'quiz', subject: 'theo', ahead: '2026-10-23' })).toBe('#/quiz/theo/2026-10-23');
  });
});
