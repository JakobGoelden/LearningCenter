import { afterEach, describe, expect, it, vi } from 'vitest';
import { dojoChatPrompt, quizChatPrompt, quizGradeChatPrompt, sheetChatPrompt, syncPrompt, type ResultsDigest } from '../src/ai/chat';
import { collectResults, parseGrades, withGrades } from '../src/ai/results';
import { pendingResults } from '../src/model/sync';
import type { Dojo, Pack, Session, Sheet, Subject, Topic } from '../src/model/types';
import { quizScores, withQuizResults } from '../src/scheduling/cards';
import { DevFs } from '../src/storage/dev-fs';
import { MemFs } from './memfs';

const pack = { id: 'p', title: 'P', subjects: ['db'] } as Pack;
const subject = { id: 'db', name: 'Databases', topics: [] } as unknown as Subject;
const sheet: Sheet = {
  id: 'sheet-02',
  label: 'Sheet 2',
  status: 'open',
  file: 'material/db/sheet-02.pdf',
  tasks: [
    { id: 't1', label: 'Task 1', text: 'Normalise R.', points: 4 },
    { id: 't2', label: 'Task 2', text: 'Write the SQL.' },
  ],
};

describe('sheetChatPrompt', () => {
  it('points the AI at the pack files and the work file', () => {
    const p = sheetChatPrompt({
      fs: { kind: 'dev', label: 'local/s3', sharedWithAi: true },
      pack,
      subject,
      sheet,
      work: { subject: 'db', sheet: 'sheet-02', answers: { t1: 'R is in 2NF' } },
    });
    expect(p).toContain('"Sheet 2" (Databases)');
    expect(p).toContain('Working on a sheet in the chat');
    expect(p).toContain('work/db/sheet-02.json');
    expect(p).toContain('answers to 1 task');
    expect(p).not.toContain('Normalise R.');
  });

  it('inlines tasks and answers when the pack lives in the browser', () => {
    const p = sheetChatPrompt({
      fs: { kind: 'browser', label: 'Browser', sharedWithAi: false },
      pack,
      subject,
      sheet,
      work: { subject: 'db', sheet: 'sheet-02', answers: { t1: 'R is in 2NF' } },
    });
    expect(p).toContain('Task 1 (4 pts):\nNormalise R.\nMy answer so far: R is in 2NF');
    expect(p).toContain('Task 2:\nWrite the SQL.');
    expect(p).not.toContain('\n\n\n');
  });
});

const hosted = { kind: 'server', label: 'jakob', sharedWithAi: false } as const;
const local = { kind: 'dev', label: 'local/s3', sharedWithAi: true } as const;
const FILE_TALK = /CLAUDE\.md|npm run|sessions\/|in the LearningCenter repo|jakob/;

const quiz = (over: Partial<Session> = {}): Session => ({
  id: 'q1',
  type: 'quiz',
  subject: 'db',
  startedAt: '2026-10-30T09:00:00Z',
  items: [
    { n: 1, topicId: 'nf', question: 'c1', kind: 'explain', prompt: 'What is 3NF?', answer: 'no idea', solution: 'No transitive dependencies' },
    { n: 2, topicId: 'nf', question: 'c2', kind: 'explain', prompt: 'What is a key?', answer: 'identifies a row', solution: 'Minimal superkey' },
  ],
  ...over,
});

describe('prompts on the hosted app', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('a production build treats the pack API as a server the AI cannot read', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"dir":"jakob"}', { headers: { 'content-type': 'application/json' } }));
    vi.stubEnv('PROD', true);
    const fs = await DevFs.detect();
    expect(fs).toMatchObject({ kind: 'server', label: 'jakob', sharedWithAi: false });
    vi.stubEnv('PROD', false);
    expect(await DevFs.detect()).toMatchObject({ kind: 'dev', sharedWithAi: true });
  });

  it('the results prompt carries the results and asks for a grades block', () => {
    const digest: ResultsDigest = {
      open: [quiz()],
      quizzes: [quiz({ id: 'q2', items: [{ n: 1, kind: 'explain', prompt: 'What is BCNF?', answer: 'dunno', score: 1 }] })],
      dojo: [quiz({ id: 'd1', type: 'dojo', dojo: 'db-sql', items: [{ n: 1, kind: 'drill', prompt: 'Write a join', answer: 'SELECT', score: 3 }] })],
      sheets: [{ subject, sheet, work: { subject: 'db', sheet: 'sheet-02', answers: { t1: 'R is in 2NF' } } }],
    };
    const p = syncPrompt({ fs: hosted, pack, subjects: [subject], digest });
    expect(p).not.toMatch(FILE_TALK);
    for (const text of ['Session q1 (Databases)', 'My answer: no idea', 'Key points: Minimal superkey', 'What is BCNF?', '(score 1)', 'Databases, db-sql', 'Write a join', 'Sheet 2 (Databases)', 'R is in 2NF', '"grades"']) {
      expect(p).toContain(text);
    }
  });

  it('asks for no grades block when nothing is open, and stays short with many weak answers', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ n: i + 1, kind: 'explain' as const, prompt: `Q${i + 1}`, score: 1 as const }));
    const p = syncPrompt({ fs: hosted, pack, subjects: [subject], digest: { open: [], quizzes: [quiz({ items: many })], dojo: [], sheets: [] } });
    expect(p).not.toContain('"grades"');
    expect(p).toContain('Q40');
    expect(p).not.toContain('Q41\n');
    expect(p).toContain('20 more weak answers left out');
  });

  it('keeps the file-based prompt for a pack the AI can open', () => {
    const p = syncPrompt({ fs: local, pack, subjects: [] });
    expect(p).toContain('`local/s3`');
    expect(p).toContain('Processing new results');
  });

  it('quiz, grade and dojo prompts work without files', () => {
    const topic = { id: 'nf', title: 'Normal forms', status: 'new' } as Topic;
    const question = { id: 'c1', kind: 'explain', prompt: 'What is 3NF?', answer: 'No transitive dependencies' } as const;
    const q = quizChatPrompt({ fs: hosted, pack, blocks: [{ subject, topics: [topic], cards: [{ topic, question }] }] });
    expect(q).toContain('Card c1: What is 3NF?');
    expect(q).toContain('No transitive dependencies');
    expect(q).not.toMatch(FILE_TALK);

    const g = quizGradeChatPrompt({ fs: hosted, pack, session: quiz() });
    expect(g).toContain('My answer: no idea');
    expect(g).toContain('The session id is q1');
    expect(g).not.toMatch(FILE_TALK);

    const dojo = { id: 'sql', title: 'SQL', procedure: 'Write queries', subject: 'db', promptTemplate: 'Set a {{level}} SQL task in {{language}}.' } as Dojo;
    const d = dojoChatPrompt({ fs: hosted, pack, subject, dojo, level: 'easy' });
    expect(d).toContain('Set a easy SQL task in English.');
    expect(d).not.toMatch(FILE_TALK);
  });

  it('gathers the sessions and sheets behind the banner', async () => {
    const fs = new MemFs();
    await fs.write('sessions/q1.json', JSON.stringify(quiz()));
    await fs.write('sessions/q2.json', JSON.stringify(quiz({ id: 'q2' })));
    await fs.write('work/db/sheet-02.json', JSON.stringify({ subject: 'db', sheet: 'sheet-02', answers: { t1: 'x' } }));
    const ev = (type: string, ref: string, extra = {}) => ({ ts: '2026-10-30T09:00:00Z', type, actor: 'user' as const, ref, ...extra });
    const p = pendingResults([ev('quiz.gradeLater', 'q1'), ev('quiz.applied', 'q2'), ev('dojo.drill.round', 'gone'), ev('sheet.work', 'sheet-02', { subject: 'db' })]);
    const d = await collectResults(fs, [{ ...subject, sheets: [sheet] }], p);
    expect(d.open.map((s) => s.id)).toEqual(['q1']);
    expect(d.quizzes.map((s) => s.id)).toEqual(['q2']);
    expect(d.dojo).toEqual([]);
    expect(d.sheets[0].work?.answers.t1).toBe('x');
  });
});

describe('pasted grades', () => {
  const reply = 'Great work!\n```json\n{"grades":[{"session":"q1","n":1,"score":1,"feedback":"Wrong.","gaps":["3NF"]},{"n":2,"score":4}],"summary":"Review 3NF."}\n```';

  it('reads the block and fills in the session', () => {
    expect(parseGrades(reply, 'q1')).toEqual({
      grades: [
        { session: 'q1', n: 1, score: 1, feedback: 'Wrong.', gaps: ['3NF'] },
        { session: 'q1', n: 2, score: 4 },
      ],
      summary: 'Review 3NF.',
    });
  });

  it('refuses what it cannot use', () => {
    expect(() => parseGrades('no json at all')).toThrow(/No JSON/);
    expect(() => parseGrades('{"grades":[]}')).toThrow(/no "grades"/);
    expect(() => parseGrades(reply)).toThrow(/names no session/);
    expect(() => parseGrades('{"grades":[{"session":"q1","n":1,"score":7}]}')).toThrow(/0 to 5/);
    expect(() => withGrades(quiz(), [{ session: 'q1', n: 9, score: 3 }])).toThrow(/no answer 9/);
  });

  it('applies like a quiz graded in the app', () => {
    const s = withGrades(quiz(), parseGrades(reply, 'q1').grades, 'Review 3NF.');
    expect(s.items[0]).toMatchObject({ score: 1, feedback: 'Wrong.', gaps: ['3NF'] });
    const topic = { id: 'nf', title: 'Normal forms', status: 'new', questions: [{ id: 'c1', kind: 'explain', prompt: 'a' }, { id: 'c2', kind: 'explain', prompt: 'b' }] } as Topic;
    const after = withQuizResults({ ...subject, topics: [topic] }, s, '2026-10-30');
    expect(quizScores(s)).toEqual({ nf: expect.any(Number) });
    expect(after.topics[0].history).toHaveLength(1);
    expect(after.topics[0].questions?.[0].stats).toMatchObject({ seen: 1, recent: [1] });
    expect(after.topics[0].questions?.[1].stats).toMatchObject({ seen: 1, recent: [4] });
  });
});
