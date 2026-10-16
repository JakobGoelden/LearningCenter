import { describe, expect, it } from 'vitest';
import { MemFs } from './memfs';
import { appendEvent, exportBundle, importBundle, loadPack, loadWork, readEvents, saveWork } from '../src/storage/repo';
import { demoBundle, emptyBundle, shiftDates } from '../src/storage/builtin';

describe('storage', () => {
  it('loads the demo pack', async () => {
    const fs = new MemFs();
    await importBundle(fs, demoBundle());
    const loaded = await loadPack(fs);
    expect(loaded.subjects.map((s) => s.id)).toEqual(['theo', 'db']);
    expect(loaded.dojos.length).toBe(6);
  });

  it('loads the empty pack', async () => {
    const fs = new MemFs();
    await importBundle(fs, emptyBundle());
    expect((await loadPack(fs)).subjects.length).toBe(1);
  });

  it('shifts demo dates relative to today', () => {
    const b = demoBundle('2026-10-23');
    const theo = JSON.parse(b.files['subjects/theo.json']);
    expect(theo.exam.date).toBe('2027-02-15');
    expect(shiftDates({ a: ['2026-01-01', 'x'] }, 1)).toEqual({ a: ['2026-01-02', 'x'] });
  });

  it('round-trips a bundle with events', async () => {
    const fs = new MemFs();
    await importBundle(fs, demoBundle());
    await appendEvent(fs, { type: 'sheet.status', subject: 'db', ref: 'b2', data: { to: 'done' } });
    const bundle = await exportBundle(fs);
    const copy = new MemFs();
    await importBundle(copy, bundle);
    expect((await readEvents(copy))[0].type).toBe('sheet.status');
    expect(Object.keys(bundle.files)).toContain('dojos/db-sql.json');
  });

  it('saves sheet answers and exports them', async () => {
    const fs = new MemFs();
    await importBundle(fs, demoBundle());
    expect(await loadWork(fs, 'theo', 'b3')).toEqual({ subject: 'theo', sheet: 'b3', answers: {} });
    await saveWork(fs, { subject: 'theo', sheet: 'b3', answers: { '1': 'DFA: {q0} -a-> {q0,q1}' } });
    const work = await loadWork(fs, 'theo', 'b3');
    expect(work.answers['1']).toContain('{q0,q1}');
    expect(work.updatedAt).toBeTruthy();
    expect(Object.keys((await exportBundle(fs)).files)).toContain('work/theo/b3.json');
  });
});
