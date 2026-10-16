import { describe, expect, it } from 'vitest';
import type { PackFs } from '../src/storage/fs';
import { appendEvent, exportBundle, importBundle, loadPack, readEvents } from '../src/storage/repo';
import { demoBundle, emptyBundle, shiftDates } from '../src/storage/builtin';

class MemFs implements PackFs {
  readonly kind = 'browser';
  readonly label = 'mem';
  readonly sharedWithAi = false;
  files = new Map<string, string>();
  async read(p: string) {
    return this.files.get(p) ?? null;
  }
  async write(p: string, t: string) {
    this.files.set(p, t);
  }
  async append(p: string, t: string) {
    this.files.set(p, (this.files.get(p) ?? '') + t);
  }
  async remove(p: string) {
    this.files.delete(p);
  }
  async list(dir: string) {
    return [...this.files.keys()]
      .filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'))
      .map((k) => k.slice(dir.length + 1));
  }
  async mtime(p: string) {
    return this.files.has(p) ? 1 : null;
  }
}

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
});
