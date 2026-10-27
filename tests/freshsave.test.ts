import { describe, expect, it } from 'vitest';
import { MemFs } from './memfs';
import { demoBundle } from '../src/storage/builtin';
import {
  fileTimes,
  importBundle,
  loadPack,
  saveSubject,
  subjectPath,
  updatePackFile,
  updateSubjectFile,
} from '../src/storage/repo';
import type { Subject } from '../src/model/types';

/** Loads the demo pack and remembers the file times, as the app does. */
async function open() {
  const fs = new MemFs();
  await importBundle(fs, demoBundle());
  const loaded = await loadPack(fs);
  const times = await fileTimes(fs, loaded);
  const theo = loaded.subjects.find((s) => s.id === 'theo')!;
  return { fs, loaded, times, theo };
}

/** What the sync job does: adds a card to the first topic on disk. */
async function pullCard(fs: MemFs, subject: Subject) {
  const [first, ...rest] = subject.topics;
  const pulled = { id: 'pulled-card', prompt: 'A card from the shared repo', kind: 'explain' as const };
  await saveSubject(fs, { ...subject, topics: [{ ...first, questions: [...(first.questions ?? []), pulled] }, ...rest] });
}

const readTheo = async (fs: MemFs) => JSON.parse((await fs.read(subjectPath('theo')))!) as Subject;
const rename = (s: Subject): Subject => ({ ...s, notes: 'changed in the app' });

describe('saving does not overwrite outside edits', () => {
  it('keeps cards pulled while the app was open', async () => {
    const { fs, times, theo } = await open();
    await pullCard(fs, theo); // the app still holds the old `theo`

    const { value, reloaded } = await updateSubjectFile(fs, theo, times[subjectPath('theo')], rename);

    expect(reloaded).toBe(true);
    const saved = await readTheo(fs);
    expect(saved.notes).toBe('changed in the app');
    expect(saved.topics[0].questions?.map((q) => q.id)).toContain('pulled-card');
    expect(value.topics[0].questions?.map((q) => q.id)).toContain('pulled-card');
  });

  it('uses the version in memory when the file did not change', async () => {
    const { fs, times, theo } = await open();
    const { reloaded } = await updateSubjectFile(fs, theo, times[subjectPath('theo')], rename);
    expect(reloaded).toBe(false);
    expect((await readTheo(fs)).notes).toBe('changed in the app');
  });

  it('notices changes after its own save once the new time is stored', async () => {
    const { fs, times, theo } = await open();
    const path = subjectPath('theo');
    const first = await updateSubjectFile(fs, theo, times[path], rename);
    const known = await fs.mtime(path); // what the app stores after saving
    await pullCard(fs, first.value);

    const second = await updateSubjectFile(fs, first.value, known, (s) => ({ ...s, short: 'TI' }));
    expect(second.reloaded).toBe(true);
    const saved = await readTheo(fs);
    expect(saved.short).toBe('TI');
    expect(saved.notes).toBe('changed in the app');
    expect(saved.topics[0].questions?.map((q) => q.id)).toContain('pulled-card');
  });

  it('applies the change to the fresh pack.json too', async () => {
    const { fs, times, loaded } = await open();
    const onDisk = { ...loaded.pack, title: 'Renamed by the sync job' };
    await fs.write('pack.json', JSON.stringify(onDisk));

    const { value, reloaded } = await updatePackFile(fs, loaded.pack, times['pack.json'], (p) => ({
      ...p,
      settings: { ...p.settings, newCardsPerDay: 7 },
    }));
    expect(reloaded).toBe(true);
    expect(value.title).toBe('Renamed by the sync job');
    expect(JSON.parse((await fs.read('pack.json'))!).settings.newCardsPerDay).toBe(7);
  });

  it('falls back to the version in memory when the time is unknown', async () => {
    const { fs, theo } = await open();
    await pullCard(fs, theo);
    const { reloaded } = await updateSubjectFile(fs, theo, undefined, rename);
    expect(reloaded).toBe(false);
  });
});
