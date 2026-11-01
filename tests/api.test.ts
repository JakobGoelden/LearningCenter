import { describe, expect, it } from 'vitest';
import { handleMessage } from '../src/api/mcp';
import { activeTopics, withTopicsEnabled } from '../src/model/chapters';
import { overview } from '../src/model/derive';
import { deckOf } from '../src/scheduling/cards';
import { dueCards } from '../src/scheduling/scheduler';
import { emptyState, pull, push } from '../src/sharing/shared';
import { callTool, TOOLS } from '../src/api/tools';
import { progressReport, weakSpots, type Snapshot } from '../src/api/insights';
import { today } from '../src/lib/dates';
import type { LoadedPack, Score, Session, Subject, Topic } from '../src/model/types';
import { MemFs } from './memfs';

const ON = '2026-11-02';
const stats = (recent: Score[]) => ({ seen: recent.length, recent, last: '2026-10-30' });
const topic = (id: string, recent: Score[], over: Partial<Topic> = {}): Topic => ({
  id,
  title: id.toUpperCase(),
  status: 'shaky',
  questions: [{ id: 'q', prompt: 'Warum?', answer: '- Weil', stats: stats(recent), due: '2026-10-31', intervalDays: 3, since: '2026-10-01' }],
  ...over,
});
const subject = (topics: Topic[], over: Partial<Subject> = {}): Subject => ({ id: 'db', name: 'DB', exam: { format: 'written' }, topics, ...over });
const loaded = (subjects: Subject[]): LoadedPack => ({ pack: { schemaVersion: 1, id: 'p', title: 'P', subjects: subjects.map((s) => s.id), dojos: [] }, subjects, dojos: [] });
const snap = (subjects: Subject[], sessions: Session[] = []): Snapshot => ({ loaded: loaded(subjects), sessions, on: ON });

async function memPack(subjects: Subject[]) {
  const fs = new MemFs();
  await fs.write('pack.json', JSON.stringify(loaded(subjects).pack));
  for (const s of subjects) await fs.write(`subjects/${s.id}.json`, JSON.stringify(s));
  return fs;
}

describe('weak spots', () => {
  it('ranks by recent scores and leaves good and unanswered topics out', () => {
    const s = subject([topic('good', [5, 5]), topic('bad', [1, 1]), topic('meh', [3, 3]), { id: 'fresh', title: 'F', status: 'new', questions: [{ id: 'q', prompt: 'x' }] }]);
    expect(weakSpots(snap([s])).spots.map((x) => x.topic)).toEqual(['bad', 'meh']);
  });

  it('notices a card that was right and fell back', () => {
    const [spot] = weakSpots(snap([subject([topic('a', [5, 5, 5, 5, 1])])])).spots;
    expect(spot.reasons.join()).toContain('relapsed');
  });

  it('leaves out blocked cards, skipped topics and switched-off chapters unless asked', () => {
    const blocked = topic('b', [0]);
    blocked.questions![0].blocked = true;
    const s = subject([blocked, topic('s', [0], { status: 'skip' }), topic('off', [0], { chapter: 'c' })], { chapters: [{ id: 'c', title: 'C', enabled: false }] });
    expect(weakSpots(snap([s])).spots).toEqual([]);
    expect(weakSpots(snap([s]), { includeOffChapters: true }).spots.map((x) => x.topic)).toEqual(['off']);
  });

  it('finds drills that keep going wrong and gaps from graded answers', () => {
    const session: Session = {
      id: 's1',
      type: 'dojo',
      subject: 'db',
      dojo: 'sql',
      startedAt: '2026-10-30T10:00:00Z',
      items: [
        { n: 1, kind: 'drill', drill: 'join', topicId: 'a', prompt: 'x', score: 1 },
        { n: 2, kind: 'drill', drill: 'join', topicId: 'a', prompt: 'x', score: 0 },
        { n: 3, kind: 'explain', topicId: 'a', prompt: 'y', score: 2, gaps: ['ON vergessen'] },
      ],
    };
    const [spot] = weakSpots(snap([subject([topic('a', [5])])], [session])).spots;
    expect(spot.drills[0]).toMatchObject({ drill: 'join', dojo: 'sql', tries: 2, avgScore: 0.5 });
    expect(spot.gaps).toEqual(['ON vergessen']);
  });

  it('puts the subject with the nearer exam first', () => {
    const near = subject([topic('a', [2])], { id: 'near', exam: { format: 'written', date: '2026-11-09' } });
    const far = subject([topic('b', [2])], { id: 'far', exam: { format: 'written', date: '2027-03-01' } });
    expect(weakSpots(snap([far, near])).spots[0].subject).toBe('near');
  });
});

describe('progress', () => {
  it('counts cards of switched-on chapters and lists the others', () => {
    const s = subject([topic('a', [5]), topic('b', [2]), topic('off', [5], { chapter: 'c' })], {
      chapters: [{ id: 'c', title: 'C', enabled: false }],
      exam: { format: 'written', date: '2026-11-12' },
    });
    const [r] = progressReport(snap([s])).subjects;
    expect(r.cards).toMatchObject({ total: 2, solid: 1, shaky: 1, new: 0, covered: 1, due: 2 });
    expect(r.exam.inDays).toBe(10);
    expect(r.chapters?.off).toEqual([{ id: 'c', title: 'C', topics: 1 }]);
  });

  it('shows the streak and weekly reviews', () => {
    const history = [{ date: '2026-10-31', score: 4, source: 'quiz' }, { date: '2026-11-01', score: 2, source: 'quiz' }, { date: ON, score: 3, source: 'quiz' }] as Topic['history'];
    const { activity } = progressReport(snap([subject([{ id: 't', title: 'T', status: 'shaky', history }])]));
    expect(activity.streakDays).toBe(3);
    expect(activity.weeks.at(-1)).toEqual({ week: ON, reviews: 1, avgScore: 3 });
    expect(activity.weeks.at(-2)).toEqual({ week: '2026-10-26', reviews: 2, avgScore: 3 });
  });
});

describe('editing through the tools', () => {
  it('edits a card and keeps its schedule and statistics', async () => {
    const fs = await memPack([subject([topic('a', [2])])]);
    await callTool(fs, 'edit_card', { subject: 'db', topic: 'a', id: 'q', prompt: 'Klarer?' });
    const q = JSON.parse((await fs.read('subjects/db.json'))!).topics[0].questions[0];
    expect(q).toMatchObject({ prompt: 'Klarer?', answer: '- Weil', due: '2026-10-31', intervalDays: 3, stats: stats([2]) });
    expect(await fs.read('log/events.jsonl')).toContain('"question.edit"');
  });

  it('refuses fields the app owns', async () => {
    const fs = await memPack([subject([topic('a', [2])])]);
    await expect(callTool(fs, 'edit_card', { subject: 'db', topic: 'a', id: 'q', due: '2030-01-01' })).rejects.toThrow(/Wrong arguments/);
  });

  it('leaves blocked cards alone', async () => {
    const t = topic('a', [2]);
    t.questions![0].blocked = true;
    const fs = await memPack([subject([t])]);
    await expect(callTool(fs, 'edit_card', { subject: 'db', topic: 'a', id: 'q', prompt: 'x' })).rejects.toThrow(/blocked/);
  });

  it('adds a new card and refuses a duplicate id', async () => {
    const fs = await memPack([subject([topic('a', [2])])]);
    const card = { subject: 'db', topic: 'a', id: 'neu', prompt: 'Was?', answer: '- Das' };
    await callTool(fs, 'add_card', card);
    const { cards } = (await callTool(fs, 'list_cards', { subject: 'db', filter: 'new' })) as { cards: { id: string }[] };
    expect(cards.map((c) => c.id)).toEqual(['neu']);
    await expect(callTool(fs, 'add_card', card)).rejects.toThrow(/already exists/);
    expect(await fs.read('log/events.jsonl')).toContain('"question.add"');
  });

  it('writes nothing when the result would be invalid', async () => {
    const fs = await memPack([subject([topic('a', [2])])]);
    const before = await fs.read('subjects/db.json');
    await expect(callTool(fs, 'add_card', { subject: 'db', topic: 'a', id: 'Not A Slug', prompt: 'x', answer: 'y' })).rejects.toThrow(/slug/);
    expect(await fs.read('subjects/db.json')).toBe(before);
  });

  it('records a grade on one card with the app rules', async () => {
    const fs = await memPack([subject([topic('a', [2])])]);
    const r = (await callTool(fs, 'record_review', { subject: 'db', topic: 'a', score: 5, card: 'q', note: 'Chat' })) as { card: { due: string } };
    expect(r.card.due > today()).toBe(true);
    const t = JSON.parse((await fs.read('subjects/db.json'))!).topics[0];
    expect(t.history.at(-1)).toMatchObject({ score: 5, source: 'quiz', note: 'Chat' });
  });

  it('marks results as processed', async () => {
    const fs = await memPack([subject([])]);
    await fs.append('log/events.jsonl', JSON.stringify({ ts: '2026-10-30T10:00:00Z', type: 'quiz.applied', actor: 'user', ref: 's1' }) + '\n');
    const before = (await callTool(fs, 'get_new_results')) as { counts: { quizzes: number } };
    expect(before.counts.quizzes).toBe(1);
    await callTool(fs, 'mark_results_processed');
    const after = (await callTool(fs, 'get_new_results')) as { counts: { quizzes: number } };
    expect(after.counts.quizzes).toBe(0);
  });
});

describe('MCP', () => {
  const rpc = (fs: MemFs, method: string, params?: object) => handleMessage(fs, { jsonrpc: '2.0', id: 1, method, params: params as Record<string, unknown> }) as Promise<any>; // eslint-disable-line

  it('initializes and lists the tools', async () => {
    const fs = await memPack([]);
    expect((await rpc(fs, 'initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion).toBe('2025-03-26');
    expect((await rpc(fs, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-06-18');
    const { tools } = (await rpc(fs, 'tools/list')).result;
    expect(tools).toHaveLength(TOOLS.length);
    expect(tools.find((t: { name: string }) => t.name === 'edit_card').annotations.readOnlyHint).toBe(false);
  });

  it('answers a call, and reports a failing call as a tool error', async () => {
    const fs = await memPack([subject([topic('a', [1])])]);
    const ok = await rpc(fs, 'tools/call', { name: 'get_weak_spots', arguments: {} });
    expect(JSON.parse(ok.result.content[0].text).spots[0].topic).toBe('a');
    const bad = await rpc(fs, 'tools/call', { name: 'get_topic', arguments: { subject: 'nope', topic: 'a' } });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain('Unknown subject');
  });

  it('does not answer notifications and rejects unknown methods', async () => {
    const fs = await memPack([]);
    expect(await handleMessage(fs, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect((await rpc(fs, 'nope')).error.code).toBe(-32601);
    expect((await rpc(fs, 'tools/call', { name: 'nope' })).error.code).toBe(-32602);
  });
});

describe('switching topics off', () => {
  const answered = () => topic('alt', [1, 4], { status: 'solid', due: '2026-11-20', intervalDays: 14, history: [{ date: '2026-10-30', score: 4, source: 'quiz' }] });
  const pack2 = () => [subject([answered(), topic('klausur', [3], { title: '★ Klausurfragen' })])];

  it('takes a topic out of the study material and restores it exactly', async () => {
    const fs = await memPack(pack2());
    const before = JSON.parse((await fs.read('subjects/db.json'))!);
    await callTool(fs, 'set_topics_enabled', { subject: 'db', enabled: false });
    expect(await callTool(fs, 'set_topics_enabled', { subject: 'db', enabled: true, match: 'klausur' })).toMatchObject({ changed: 1, activeTopics: 1 });

    const off = JSON.parse((await fs.read('subjects/db.json'))!) as Subject;
    expect(activeTopics(off).map((t) => t.id)).toEqual(['klausur']);
    expect(dueCards(off, ON).map((c) => c.topic.id)).toEqual(['klausur']);
    expect(deckOf(off).map((c) => c.topic.id)).toEqual(['klausur']);
    expect(overview(off, ON).statusCounts.solid).toBe(0);
    expect(off.topics[0]).toMatchObject({ status: 'solid', due: '2026-11-20', intervalDays: 14 });

    await callTool(fs, 'set_topics_enabled', { subject: 'db', enabled: true });
    const { $schema: _saved, ...after } = JSON.parse((await fs.read('subjects/db.json'))!);
    expect(after).toEqual(before);
  });

  it('stays off through a pull that changes the card, and is not pushed', () => {
    const start = pack2();
    const local = loaded(start);
    const repo = push(local, new Map([['db/subject.json', JSON.stringify({ id: 'db', name: 'DB' })]]), emptyState());
    const off = { ...local, subjects: [withTopicsEnabled(start[0], (t) => t.id === 'alt', false)] };
    const path = 'db/topics/alt.json';
    expect(repo.tree.get(path)).not.toContain('enabled');
    const changed = new Map(repo.tree).set(path, JSON.stringify({ id: 'alt', title: 'ALT', questions: [{ id: 'q', prompt: 'Neu?', answer: '- Neu' }, { id: 'q2', prompt: 'Zweite?' }] }));
    const [t] = pull(off, changed, repo.state).loaded.subjects[0].topics;
    expect(t).toMatchObject({ enabled: false, status: 'solid', due: '2026-11-20' });
    expect(t.questions![0]).toMatchObject({ prompt: 'Neu?', due: '2026-10-31', stats: stats([1, 4]) });
    expect(t.questions).toHaveLength(2);
    expect(push(off, repo.tree, repo.state).report).toEqual([]);
  });
});

