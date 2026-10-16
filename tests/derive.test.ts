import { describe, expect, it } from 'vitest';
import { classesOn, overview, progressOf, todayItems } from '../src/model/derive';
import { demoBundle, DEMO_ANCHOR } from '../src/storage/builtin';
import { importBundle, loadPack } from '../src/storage/repo';
import { MemFs } from './memfs';

describe('derive', async () => {
  const fs = new MemFs();
  await importBundle(fs, demoBundle(DEMO_ANCHOR));
  const loaded = await loadPack(fs);

  it('summarises a subject', () => {
    const o = overview(loaded.subjects[0], DEMO_ANCHOR);
    expect(o.due.map((t) => t.id)).toEqual(['powerset', 'regex']);
    expect(o.overdue.map((t) => t.id)).toEqual(['powerset']);
    expect(o.statusCounts).toEqual({ new: 2, shaky: 2, solid: 1, skip: 1 });
    expect(o.staleChecks.map((c) => c.id)).toEqual(['notes']);
  });

  it('builds the today line with overdue items first', () => {
    const items = todayItems(loaded, DEMO_ANCHOR);
    expect(items[0].urgent).toBe(true);
    expect(items.some((i) => i.kind === 'reviews' && i.subject.id === 'db')).toBe(true);
  });

  it('lists the classes of the day from the timetable', () => {
    const [theo, db] = loaded.subjects;
    // DEMO_ANCHOR is a Friday; 2026-10-19 is a Monday.
    expect(classesOn(db, DEMO_ANCHOR).map((c) => c.kind)).toEqual(['lab']);
    expect(classesOn(theo, DEMO_ANCHOR)).toEqual([]);
    expect(classesOn(theo, '2026-10-19').map((c) => c.start)).toEqual(['10:00']);
    expect(classesOn({ ...theo, schedule: [{ ...theo.schedule![0], until: '2026-10-18' }] }, '2026-10-19')).toEqual([]);
    const cls = todayItems(loaded, DEMO_ANCHOR).find((i) => i.kind === 'class');
    expect(cls?.text).toBe('Lab 12:00–13:30 · PC pool');
  });

  it('measures progress as the solid share of non-skipped topics', () => {
    expect(progressOf({ new: 2, shaky: 1, solid: 1, skip: 5 })).toBe(0.25);
    expect(progressOf({ new: 0, shaky: 0, solid: 0, skip: 0 })).toBe(0);
    expect(overview(loaded.subjects[0], DEMO_ANCHOR).openSheets.map((s) => s.id)).toEqual(['b3']);
  });
});
