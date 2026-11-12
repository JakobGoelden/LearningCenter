// Moving a pack's progress from the subject files into the event log, once.
// Every topic gets one baseline event with its progress as it is in the file.
// The pack only switches over ("progress": "events" in pack.json) when the
// replay of those events reproduces every subject exactly, field by field, and
// it is checked once more after writing by loading the pack the way the app does.

import type { LoadedPack, Pack, Subject } from '../model/types';
import type { PackFs } from '../storage/fs';
import { appendEventsTo, loadPack, readPackJson, savePack } from '../storage/repo';
import { progressEvent, progressOf, replaySubject, type ProgressEvent } from './ops';

/** JSON with sorted keys, so two objects compare equal whatever their key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

/** Where two versions of a subject differ (topics and cards by id, every field); [] when equal. */
export function subjectDiff(want: Subject, got: Subject): string[] {
  const out: string[] = [];
  const { topics: wt, ...wHead } = want;
  const { topics: gt, ...gHead } = got;
  if (canonical(wHead) !== canonical(gHead)) out.push(`${want.id}: subject fields differ`);
  if (wt.length !== gt.length) out.push(`${want.id}: ${wt.length} topics, replay has ${gt.length}`);
  wt.forEach((t, i) => {
    const g = gt[i];
    if (!g || g.id !== t.id) {
      out.push(`${want.id}/${t.id}: missing or out of order in the replay`);
      return;
    }
    const { questions: wq, ...wRest } = t;
    const { questions: gq, ...gRest } = g;
    for (const k of new Set([...Object.keys(wRest), ...Object.keys(gRest)])) {
      const a = canonical((wRest as Record<string, unknown>)[k]);
      const b = canonical((gRest as Record<string, unknown>)[k]);
      if (a !== b) out.push(`${want.id}/${t.id}.${k}: file ${a ?? '-'}, replay ${b ?? '-'}`);
    }
    if ((wq === undefined) !== (gq === undefined) || (wq?.length ?? 0) !== (gq?.length ?? 0)) {
      out.push(`${want.id}/${t.id}: cards differ in number`);
      return;
    }
    (wq ?? []).forEach((q, j) => {
      if (canonical(q) !== canonical(gq![j])) out.push(`${want.id}/${t.id}/${q.id}: file ${canonical(q)}, replay ${canonical(gq![j])}`);
    });
  });
  return out;
}

/** One baseline event per topic of every subject. */
export function baselineEvents(loaded: LoadedPack, on: string, ts: string): ProgressEvent[] {
  return loaded.subjects.flatMap((s) =>
    s.topics.map((t) => progressEvent(s.id, { op: 'baseline', topic: t.id, progress: progressOf(t) }, on, undefined, { ts, actor: 'app' })),
  );
}

export interface MigrationReport {
  pack: string;
  subjects: number;
  topics: number;
  cards: number;
  events: number;
  /** Differences found; the pack was not switched when there are any. */
  diffs: string[];
  migrated: boolean;
}

const countCards = (subjects: Subject[]) => subjects.reduce((n, s) => n + s.topics.reduce((k, t) => k + (t.questions?.length ?? 0), 0), 0);

/**
 * Migrates a pack. `write: false` only checks. Throws when the pack is already
 * migrated. Never switches a pack whose replay differs from its files.
 */
export async function migratePack(fs: PackFs, opts: { write: boolean; on: string; now?: string }): Promise<MigrationReport> {
  const loaded = await loadPack(fs);
  if (loaded.pack.progress === 'events') throw new Error(`${loaded.pack.id} is already migrated.`);
  const events = baselineEvents(loaded, opts.on, opts.now ?? new Date().toISOString());
  const report: MigrationReport = {
    pack: loaded.pack.id,
    subjects: loaded.subjects.length,
    topics: loaded.subjects.reduce((n, s) => n + s.topics.length, 0),
    cards: countCards(loaded.subjects),
    events: events.length,
    diffs: loaded.subjects.flatMap((s) => subjectDiff(s, replaySubject(s, events))),
    migrated: false,
  };
  if (report.diffs.length || !opts.write) return report;

  const packJson = await readPackJson(fs);
  await appendEventsTo(fs, events);
  await savePack(fs, { ...packJson, progress: 'events' });
  // Load it like the app does and compare once more; undo the switch on any difference.
  const after = await loadPack(fs);
  const diffs = loaded.subjects.flatMap((s) => {
    const got = after.subjects.find((x) => x.id === s.id);
    return got ? subjectDiff(s, got) : [`${s.id}: missing after the switch`];
  });
  if (diffs.length || after.pack.progress !== 'events') {
    await savePack(fs, packJson);
    report.diffs = diffs.length ? diffs : ['pack.json did not take the switch'];
    return report;
  }
  report.migrated = true;
  return report;
}

/** Checks a migrated pack: the progress fields in its files against the replay (they drift apart as answers come in). */
export async function compareWithFiles(fs: PackFs, filesOf: (id: string) => Promise<Subject>): Promise<string[]> {
  const loaded = await loadPack(fs);
  const out: string[] = [];
  for (const s of loaded.subjects) out.push(...subjectDiff(await filesOf(s.id), s));
  return out;
}

export type { Pack };
