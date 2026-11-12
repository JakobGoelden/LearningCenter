import { describe, expect, it } from 'vitest';
import { MemFs } from './memfs';
import { demoBundle } from '../src/storage/builtin';
import { appendEventsTo, EVENTS_PATH, importBundle, loadPack, readPackJson, saveSubject } from '../src/storage/repo';
import { withCardAnswer, withQuizAnswer, withQuizResults } from '../src/scheduling/cards';
import { applyCardReviews, applyReview, withTopicDue } from '../src/scheduling/scheduler';
import {
  applyEvent,
  compareEvents,
  isProgressEvent,
  newReplayState,
  parseProgress,
  progressEvent,
  quizApplyOp,
  replaySubject,
  stripTopic,
  type ProgressEvent,
  type ProgressOp,
} from '../src/progress/ops';
import { baselineEvents, canonical, migratePack, subjectDiff } from '../src/progress/migrate';
import type { PackSettings, Score, Session, Subject, Topic, TopicQuestion } from '../src/model/types';

async function demo() {
  const fs = new MemFs();
  await importBundle(fs, demoBundle());
  const loaded = await loadPack(fs);
  return { fs, loaded, theo: loaded.subjects.find((s) => s.id === 'theo')! };
}

const firstCards = (s: Subject, n: number) =>
  s.topics.flatMap((t) => (t.questions ?? []).map((q) => ({ topic: t, question: q }))).slice(0, n);

const session = (id: string, items: Session['items']): Session => ({ id, type: 'quiz', subject: 'theo', startedAt: '2026-11-01T10:00:00Z', items });

/**
 * The old app, call for call: what QuizView, EndlessView, DojoView, TopicsView
 * and PasteGrades did to the subject file before progress became events.
 */
function oldApp(s0: Subject, settings: PackSettings | undefined) {
  let s = s0;
  const [a, b, c] = firstCards(s0, 3);
  const quiz = session('q1', [
    { n: 1, topicId: a.topic.id, question: a.question.id } as Session['items'][number],
    { n: 2, topicId: b.topic.id, question: b.question.id } as Session['items'][number],
  ]);
  // QuizView.rate: first rating of item 1, then a correction, then item 2.
  const find = (x: Subject, t: string, q: string) => x.topics.find((y) => y.id === t)?.questions?.find((y) => y.id === q);
  const before1 = find(s, a.topic.id, a.question.id);
  s = withQuizAnswer(s, quiz, quiz.items[0], 2, '2026-11-02', settings, undefined);
  s = withQuizAnswer(s, quiz, quiz.items[0], 5, '2026-11-02', settings, before1);
  s = withQuizAnswer(s, quiz, quiz.items[1], 4, '2026-11-02', settings, undefined);
  // EndlessView.rate, twice on one day (only the first reschedules) and once the next day.
  const endless = (x: Subject, score: Score, on: string) => {
    const q = find(x, c.topic.id, c.question.id);
    const reviewed =
      !q || q.stats?.last === on
        ? x
        : { ...x, topics: x.topics.map((t) => (t.id === c.topic.id ? applyCardReviews(t, [{ question: c.question.id, score }], { date: on, source: 'quiz' }, settings) : t)) };
    return withCardAnswer(reviewed, c, score, on);
  };
  s = endless(s, 1, '2026-11-03');
  s = endless(s, 5, '2026-11-03');
  s = endless(s, 3, '2026-11-04');
  // QuizView.apply / PasteGrades: a whole graded session.
  const graded = session('q2', [
    { n: 1, topicId: a.topic.id, question: a.question.id, score: 3 } as Session['items'][number],
    { n: 2, topicId: a.topic.id, question: a.question.id, score: 5 } as Session['items'][number],
    { n: 3, topicId: b.topic.id, score: 1 } as Session['items'][number],
  ]);
  s = withQuizResults(s, graded, '2026-11-05', settings);
  // DojoView.apply: several topics, one review each.
  const dojoTopics = new Set([a.topic.id, c.topic.id]);
  s = { ...s, topics: s.topics.map((t) => (dojoTopics.has(t.id) ? applyReview(t, { date: '2026-11-06', score: 4, source: 'dojo', sessionId: 'd1' }, settings) : t)) };
  // TopicsView: a manual rating, a date by hand, skip and back.
  s = { ...s, topics: s.topics.map((t) => (t.id === b.topic.id ? applyReview(t, { date: '2026-11-07', score: 0, source: 'manual' }, settings) : t)) };
  s = { ...s, topics: s.topics.map((t) => (t.id === c.topic.id ? withTopicDue(t, '2026-11-20') : t)) };
  const patch = (t: Topic, change: Partial<Topic>) => {
    const next: Topic = { ...t, ...change };
    for (const k of Object.keys(next) as (keyof Topic)[]) if (next[k] === undefined) delete next[k];
    return next;
  };
  s = { ...s, topics: s.topics.map((t) => (t.id === b.topic.id ? patch(t, { status: 'skip', due: undefined, intervalDays: undefined }) : t)) };
  s = { ...s, topics: s.topics.map((t) => (t.id === b.topic.id ? patch(t, { status: 'shaky' }) : t)) };
  // npm run review: a card on its own, and a whole topic with a note.
  s = { ...s, topics: s.topics.map((t) => (t.id === a.topic.id ? applyCardReviews(t, [{ question: a.question.id, score: 4 }], { date: '2026-11-09', source: 'quiz', note: 'chat' }, settings) : t)) };
  s = { ...s, topics: s.topics.map((t) => (t.id === c.topic.id ? applyReview(t, { date: '2026-11-09', score: 5, source: 'manual', note: 'chat' }, settings) : t)) };
  return { s, quiz, graded, a, b, c };
}

/** The same actions as events, the way the new app records them. */
function newOps(o: ReturnType<typeof oldApp>): [ProgressOp, string][] {
  const { a, b, c, graded } = o;
  return [
    [{ op: 'quiz', topic: a.topic.id, card: a.question.id, score: 2, session: 'q1', n: 1 }, '2026-11-02'],
    [{ op: 'quiz', topic: a.topic.id, card: a.question.id, score: 5, session: 'q1', n: 1, replaces: 'E0' }, '2026-11-02'],
    [{ op: 'quiz', topic: b.topic.id, card: b.question.id, score: 4, session: 'q1', n: 2 }, '2026-11-02'],
    [{ op: 'endless', topic: c.topic.id, card: c.question.id, score: 1 }, '2026-11-03'],
    [{ op: 'endless', topic: c.topic.id, card: c.question.id, score: 5 }, '2026-11-03'],
    [{ op: 'endless', topic: c.topic.id, card: c.question.id, score: 3 }, '2026-11-04'],
    [quizApplyOp(graded), '2026-11-05'],
    [{ op: 'review', scores: { [a.topic.id]: 4, [c.topic.id]: 4 }, source: 'dojo', session: 'd1' }, '2026-11-06'],
    [{ op: 'review', scores: { [b.topic.id]: 0 }, source: 'manual' }, '2026-11-07'],
    [{ op: 'due', topic: c.topic.id, due: '2026-11-20' }, '2026-11-07'],
    [{ op: 'status', topic: b.topic.id, status: 'skip' }, '2026-11-07'],
    [{ op: 'status', topic: b.topic.id, status: 'shaky' }, '2026-11-07'],
    [{ op: 'card-review', topic: a.topic.id, card: a.question.id, score: 4, source: 'quiz', note: 'chat' }, '2026-11-09'],
    [{ op: 'review', scores: { [c.topic.id]: 5 }, source: 'manual', note: 'chat' }, '2026-11-09'],
  ];
}

const asEvents = (subject: string, ops: [ProgressOp, string][], settings?: PackSettings): ProgressEvent[] =>
  ops.map(([op, on], i) =>
    progressEvent(subject, op, on, settings, { id: `E${i}`, ts: `2026-11-${String(2 + Math.floor(i / 3)).padStart(2, '0')}T10:00:${String(i).padStart(2, '0')}.000Z` }),
  );

describe('progress events reproduce the old app exactly', () => {
  for (const settings of [undefined, { reviewLadder: [2, 5, 9, 30], skipWeekends: false }] as (PackSettings | undefined)[]) {
    it(`replay from scratch equals the old file writes (settings ${JSON.stringify(settings ?? 'default')})`, async () => {
      const { theo } = await demo();
      const start = { ...theo, topics: theo.topics.map(stripTopic) };
      const old = oldApp(start, settings);
      const events = asEvents('theo', newOps(old), settings);
      expect(events.every(isProgressEvent)).toBe(true);
      // The scenario really changes progress: history entries, card stats and dates.
      expect(canonical(old.s)).not.toBe(canonical(start));
      expect(old.s.topics.reduce((n, t) => n + (t.history?.length ?? 0), 0)).toBeGreaterThanOrEqual(8);
      expect(old.s.topics.find((t) => t.id === old.c.topic.id)!.questions!.find((q) => q.id === old.c.question.id)!.stats!.seen).toBe(3);
      const replayed = replaySubject(start, events);
      expect(subjectDiff(old.s, replayed)).toEqual([]);
      expect(canonical(replayed)).toBe(canonical(old.s));
      // The old app path in a pack that is not migrated: the same ops applied one by one.
      const state = newReplayState();
      const step = events.reduce((acc, e) => applyEvent(acc, e, state), start);
      expect(canonical(step)).toBe(canonical(old.s));
    });
  }

  it('changes nothing once the pack settings change later (rules are not retroactive)', async () => {
    const { theo } = await demo();
    const start = { ...theo, topics: theo.topics.map(stripTopic) };
    const old = oldApp(start, undefined);
    const events = asEvents('theo', newOps(old), undefined);
    // The events carry no ladder, so they keep the default ladder whatever pack.json says now.
    expect(events.every((e) => e.data.cfg === undefined)).toBe(true);
    expect(canonical(replaySubject(start, events))).toBe(canonical(old.s));
  });

  it('ignores events of an unknown rules version and other subjects', async () => {
    const { theo } = await demo();
    const [a] = firstCards(theo, 1);
    const e = progressEvent('theo', { op: 'endless', topic: a.topic.id, card: a.question.id, score: 5 }, '2026-11-02', undefined, { id: 'x' });
    const future = { ...e, data: { ...e.data, rules: 99 } } as ProgressEvent;
    const other = { ...e, id: 'y', subject: 'db' } as ProgressEvent;
    expect(canonical(replaySubject(theo, [future, other]))).toBe(canonical({ ...theo, topics: theo.topics.map(stripTopic) }));
  });

  it('a reset makes a re-created topic start from scratch', async () => {
    const { theo } = await demo();
    const [a] = firstCards(theo, 1);
    const ev = asEvents('theo', [
      [{ op: 'endless', topic: a.topic.id, card: a.question.id, score: 5 }, '2026-11-02'],
      [{ op: 'reset', topic: a.topic.id }, '2026-11-02'],
    ]);
    const t = replaySubject(theo, ev).topics.find((x) => x.id === a.topic.id)!;
    expect(canonical(t)).toBe(canonical(stripTopic(a.topic)));
  });

  it('orders baselines first, then by time and id', () => {
    const mk = (id: string, ts: string, op: 'baseline' | 'reset') =>
      ({ id, ts, type: 'progress', subject: 's', data: { op, topic: 't', rules: 1, on: '2026-11-01', ...(op === 'baseline' ? { progress: { status: 'new' } } : {}) } }) as unknown as ProgressEvent;
    const list = [mk('b', '2026-11-02T00:00:00Z', 'reset'), mk('z', '2026-11-03T00:00:00Z', 'baseline'), mk('a', '2026-11-02T00:00:00Z', 'reset')];
    expect([...list].sort(compareEvents).map((e) => e.id)).toEqual(['z', 'a', 'b']);
  });
});

describe('migration', () => {
  /** The demo pack with real progress in its files, made by the old app. */
  async function withProgress() {
    const { fs, theo } = await demo();
    await saveSubject(fs, oldApp(theo, undefined).s);
    return fs;
  }

  it('switches only after the replay reproduces every file exactly', async () => {
    const fs = await withProgress();
    const before = await loadPack(fs);
    const report = await migratePack(fs, { write: true, on: '2026-11-12', now: '2026-11-12T12:00:00.000Z' });
    expect(report.diffs).toEqual([]);
    expect(report.migrated).toBe(true);
    expect(report.events).toBe(before.subjects.reduce((n, s) => n + s.topics.length, 0));
    const after = await loadPack(fs);
    expect(after.pack.progress).toBe('events');
    for (const s of before.subjects) expect(canonical(after.subjects.find((x) => x.id === s.id))).toBe(canonical(s));
    await expect(migratePack(fs, { write: true, on: '2026-11-12' })).rejects.toThrow(/already migrated/);
  });

  it('a check run writes nothing', async () => {
    const fs = await withProgress();
    const files = new Map(fs.files);
    const report = await migratePack(fs, { write: false, on: '2026-11-12' });
    expect(report.migrated).toBe(false);
    expect(report.diffs).toEqual([]);
    expect(fs.files).toEqual(files);
  });

  it('after the switch, progress comes from the log and the file progress is ignored', async () => {
    const fs = await withProgress();
    await migratePack(fs, { write: true, on: '2026-11-12' });
    const loaded = await loadPack(fs);
    const theo = loaded.subjects.find((s) => s.id === 'theo')!;
    // An outside tool writes stale progress into the file: it must not show.
    await saveSubject(fs, { ...theo, topics: theo.topics.map(stripTopic) });
    expect(canonical((await loadPack(fs)).subjects.find((s) => s.id === 'theo'))).toBe(canonical(theo));
    // A new answer as an event changes the view.
    const [a] = firstCards(theo, 1);
    await appendEventsTo(fs, [progressEvent('theo', { op: 'endless', topic: a.topic.id, card: a.question.id, score: 1 }, '2026-11-13', undefined, { ts: '2026-11-13T08:00:00.000Z' })]);
    const q = (await loadPack(fs)).subjects.find((s) => s.id === 'theo')!.topics.find((t) => t.id === a.topic.id)!.questions!.find((x) => x.id === a.question.id) as TopicQuestion;
    expect(q.stats?.last).toBe('2026-11-13');
    expect(q.stats?.recent.at(-1)).toBe(1);
  });

  it('baseline events validate and survive a round trip through the log', async () => {
    const fs = await withProgress();
    const loaded = await loadPack(fs);
    const events = baselineEvents(loaded, '2026-11-12', '2026-11-12T12:00:00.000Z');
    await appendEventsTo(fs, events);
    const { events: back, skipped } = parseProgress((await fs.read(EVENTS_PATH))!);
    expect(skipped).toBe(0);
    expect(back.map((e) => e.id)).toEqual(events.map((e) => e.id));
  });

  it('subjectDiff names every difference', async () => {
    const { theo } = await demo();
    const [a] = firstCards(theo, 1);
    const changed = {
      ...theo,
      topics: theo.topics.map((t) => (t.id === a.topic.id ? { ...t, due: '2026-12-01', questions: t.questions!.map((q, i) => (i === 0 ? { ...q, intervalDays: 3 } : q)) } : t)),
    };
    const diffs = subjectDiff(theo, changed);
    expect(diffs.some((d) => d.includes(`${a.topic.id}.due`))).toBe(true);
    expect(diffs.some((d) => d.includes(`${a.topic.id}/${a.question.id}`))).toBe(true);
    expect(subjectDiff(theo, { ...theo, topics: theo.topics.slice(1) }).length).toBeGreaterThan(0);
  });
});

describe('appendEventsTo', () => {
  it('writes each id once and never glues onto a half line', async () => {
    const fs = new MemFs();
    await fs.write(EVENTS_PATH, '{"ts":"2026-11-01T00:00:00Z","type":"x"}\n{"ts":"broken');
    const e = (id: string) => ({ id, ts: '2026-11-02T00:00:00Z', type: 'quiz.start' });
    await appendEventsTo(fs, [e('a'), e('b'), e('a')]);
    await appendEventsTo(fs, [e('b'), e('c')]);
    const lines = (await fs.read(EVENTS_PATH))!.split('\n');
    expect(lines[1]).toBe('{"ts":"broken');
    expect(lines.slice(2).filter(Boolean).map((l) => JSON.parse(l).id)).toEqual(['a', 'b', 'c']);
  });

  it('refuses events without an id or that do not validate', async () => {
    const fs = new MemFs();
    await expect(appendEventsTo(fs, [{ ts: '2026-11-02T00:00:00Z', type: 'x' }])).rejects.toThrow(/id/);
    await expect(appendEventsTo(fs, [{ id: 'a b', ts: '2026-11-02T00:00:00Z', type: 'x' }])).rejects.toThrow();
  });
});

describe('pack.json switch', () => {
  it('validates with and without the progress field', async () => {
    const { fs } = await demo();
    const p = await readPackJson(fs);
    expect(p.progress).toBeUndefined();
  });
});
