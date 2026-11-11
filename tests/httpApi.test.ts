import { describe, expect, it } from 'vitest';
import { createApi, hashToken, newToken, RateLimiter, readOnly, type TokenFile } from '../src/api/http';
import { examDatesView, weakSpotsView } from '../src/api/readonly';
import type { Snapshot } from '../src/api/insights';
import type { LoadedPack, Session, Subject } from '../src/model/types';
import { MemFs } from './memfs';

const ON = '2026-11-02';
const subject: Subject = {
  id: 'db',
  name: 'DB',
  notes: 'private remark',
  exam: { format: 'written', date: '2026-11-20', aids: ['cheat sheet'], notes: 'private' },
  chapters: [
    { id: 'c1', title: 'One' },
    { id: 'c2', title: 'Two', enabled: false },
  ],
  topics: [
    { id: 'a', title: 'A', chapter: 'c1', status: 'shaky', notes: 'Stand 26.10.: falsch', questions: [{ id: 'q', prompt: 'Why?', stats: { seen: 2, recent: [1, 1], last: '2026-10-30' }, due: '2026-10-31', intervalDays: 1, since: '2026-10-01' }] },
    { id: 'b', title: 'B', chapter: 'c2', status: 'new', questions: [{ id: 'q', prompt: 'What?' }] },
  ],
  openItems: [{ id: 'o', text: 'Ask Prof. X by mail' }],
};
const loaded: LoadedPack = { pack: { schemaVersion: 1, id: 'p', title: 'Personal title', subjects: ['db'], dojos: [] }, subjects: [subject], dojos: [] };
const session: Session = {
  id: 's1',
  type: 'quiz',
  subject: 'db',
  startedAt: '2026-11-01T10:00:00Z',
  finishedAt: '2026-11-01T10:12:00Z',
  items: [{ n: 1, topicId: 'a', prompt: 'Why?', answer: 'my secret answer', score: 2, feedback: 'gap' }],
};
const snap: Snapshot = { loaded, sessions: [session], on: ON };

const TOKEN = newToken();
const file: TokenFile = { tokens: [{ id: 'uni', user: 'jakob', sha256: hashToken(TOKEN), created: '2026-11-01T00:00:00Z' }] };

function api(over: Partial<Parameters<typeof createApi>[0]> = {}) {
  return createApi({ tokens: () => file, snapshot: async () => ({ snap, freshness: { lastSync: '2026-11-01T10:12:00.000Z' } }), now: () => 0, ...over });
}
const get = (path: string, token: string | null = TOKEN, method = 'GET') =>
  ({ method, url: path, headers: token ? { authorization: `Bearer ${token}` } : {}, ip: '1.2.3.4' });

describe('read-only HTTP API', () => {
  it('answers the four endpoints with the sync time', async () => {
    const h = api();
    for (const e of ['progress', 'weak-spots', 'recent-activity', 'exam-dates']) {
      const r = await h(get(`/api/v1/${e}`));
      expect(r.status, e).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.lastSync).toBe('2026-11-01T10:12:00.000Z');
      expect(body.generatedAt).toBeTruthy();
    }
  });

  it('refuses missing, wrong and revoked tokens and every write method', async () => {
    expect((await api()(get('/api/v1/progress', null))).status).toBe(401);
    expect((await api()(get('/api/v1/progress', 'lc_ro_wrong'))).status).toBe(401);
    const revoked: TokenFile = { tokens: [{ ...file.tokens[0], revoked: '2026-11-02T00:00:00Z' }] };
    expect((await api({ tokens: () => revoked })(get('/api/v1/progress'))).status).toBe(401);
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) expect((await api()(get('/api/v1/progress', TOKEN, m))).status).toBe(405);
  });

  it('limits requests per token and failed attempts per address', async () => {
    const h = api({ perToken: new RateLimiter(2, 60_000), failures: new RateLimiter(1, 60_000) });
    expect((await h(get('/api/v1/exam-dates'))).status).toBe(200);
    expect((await h(get('/api/v1/exam-dates'))).status).toBe(200);
    const limited = await h(get('/api/v1/exam-dates'));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect((await h(get('/api/v1/exam-dates', 'bad'))).status).toBe(401);
    expect((await h(get('/api/v1/exam-dates', 'bad'))).status).toBe(429);
  });

  it('leaves out notes, answers, open tasks and the pack title', async () => {
    const h = api();
    const all = (await Promise.all(['progress', 'weak-spots', 'recent-activity', 'exam-dates'].map((e) => h(get(`/api/v1/${e}`))))).map((r) => r.body).join('\n');
    for (const secret of ['private', 'falsch', 'my secret answer', 'Prof. X', 'Personal title', 'cheat sheet', 'jakob']) expect(all).not.toContain(secret);
  });

  it('names weak topics, never asked chapters and exams', () => {
    const w = weakSpotsView(snap);
    expect(w.topics.map((t) => t.topic)).toEqual(['a']);
    expect(w.neverAsked).toEqual([{ subject: 'db', chapter: 'c2', title: 'Two', switchedOn: false, topics: 1, cards: 1 }]);
    expect(examDatesView(snap).exams[0]).toMatchObject({ subject: 'db', date: '2026-11-20', inDays: 18 });
  });

  it('cannot write through the pack', async () => {
    const fs = readOnly(new MemFs());
    await expect(fs.write('x', 'y')).rejects.toThrow('read-only');
    await expect(fs.append('x', 'y')).rejects.toThrow('read-only');
    await expect(fs.remove('x')).rejects.toThrow('read-only');
  });
});
