import { describe, expect, it } from 'vitest';
import { overview, todayItems } from '../src/model/derive';
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
});
