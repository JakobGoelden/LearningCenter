import { describe, expect, it } from 'vitest';
import { emptyState, pull, push, readChangelog, type SharedTree } from '../src/sharing/shared';
import { check } from '../src/model/validate';
import type { Dojo, LoadedPack } from '../src/model/types';

const pack = (over: Partial<LoadedPack> = {}): LoadedPack => ({
  pack: { schemaVersion: 1, id: 'p', title: 'P', subjects: [], ...(over.pack ?? {}) },
  subjects: over.subjects ?? [],
  dojos: over.dojos ?? [],
});

const dojo: Dojo = { id: 'sql', subject: 'db', title: 'SQL', procedure: 'Write queries', promptTemplate: 'x' };

/** Alice has db with a chapter and a dojo; she pushes into an empty repo. */
function aliceRepo(): { tree: SharedTree; alice: LoadedPack } {
  const alice = pack({
    pack: { schemaVersion: 1, id: 'a', title: 'A', subjects: ['db'], dojos: ['sql'] },
    subjects: [
      {
        id: 'db',
        name: 'Databases',
        exam: { format: 'written' },
        chapters: [{ id: 'ch1', title: 'Chapter 1' }],
        topics: [
          {
            id: 'nf',
            title: 'Normal forms',
            status: 'solid',
            chapter: 'ch1',
            history: [{ date: '2026-10-01', score: 5, source: 'quiz' }],
            questions: [
              { id: 'q1', prompt: 'Why 3NF?', answer: '- a', stats: { seen: 3, recent: [5, 5, 5], last: '2026-10-01' } },
              { id: 'q2', prompt: 'Private', blocked: true },
            ],
          },
        ],
      },
    ],
    dojos: [dojo],
  });
  const r = push(alice, new Map(), emptyState(), { subjects: ['db'], author: 'alice', now: '2026-10-18T10:00:00Z' });
  return { tree: r.tree, alice };
}

describe('sharing', () => {
  it('push writes content only, in the folder layout, with a changelog', () => {
    const { tree } = aliceRepo();
    expect([...tree.keys()].sort()).toEqual(['changelog.jsonl', 'db/ch1/chapter.json', 'db/ch1/topics/nf.json', 'db/dojos/sql.json', 'db/subject.json', 'repo.json']);
    const t = tree.get('db/ch1/topics/nf.json')!;
    expect(t).toContain('Why 3NF?');
    expect(t).not.toMatch(/stats|blocked|history|Private|status/);
    expect(readChangelog(tree).map((l) => `${l.action}:${l.kind}`)).toEqual(expect.arrayContaining(['add:card', 'add:topic', 'add:dojo', 'add:chapter']));
  });

  it('pull gives a friend a valid subject; chapters start switched off', () => {
    const { tree } = aliceRepo();
    const bob = pull(pack(), tree, emptyState());
    const s = bob.loaded.subjects[0];
    expect(bob.loaded.pack.subjects).toEqual(['db']);
    expect(bob.loaded.pack.dojos).toEqual(['sql']);
    expect(s.topics[0]).toMatchObject({ id: 'nf', status: 'new', chapter: 'ch1' });
    expect(s.topics[0].questions).toHaveLength(1);
    expect(s.chapters).toEqual([{ id: 'ch1', title: 'Chapter 1', enabled: false }]);
    expect(check('subject', s)).toBeNull();
    expect(check('dojo', bob.loaded.dojos[0])).toBeNull();
    expect(pull(pack(), tree, emptyState(), { enableNewChapters: true }).loaded.subjects[0].chapters![0].enabled).toBe(true);
  });

  it('a second pull changes nothing; a blocked card is never re-added or overwritten', () => {
    const { tree } = aliceRepo();
    const first = pull(pack(), tree, emptyState());
    const blocked = structuredClone(first.loaded);
    blocked.subjects[0].topics[0].questions![0].blocked = true;
    const again = pull(blocked, tree, first.state);
    expect(again.changed).toBe(false);
    expect(again.loaded.subjects[0].topics[0].questions![0].blocked).toBe(true);
  });

  it('takes upstream edits for untouched cards, keeps local edits on conflict', () => {
    const { tree, alice } = aliceRepo();
    const bob0 = pull(pack(), tree, emptyState());
    // Alice edits the card and pushes again
    const a2 = structuredClone(alice);
    a2.subjects[0].topics[0].questions![0].prompt = 'Why 3NF, really?';
    const r2 = push(a2, tree, emptyState(), { subjects: ['db'] }); // alice's own state is not needed to see the edit as an update
    expect(r2.report.join()).toContain('pull first'); // stale state: protects against overwriting
    // with Alice's real state the edit goes through
    const aState = push(alice, new Map(), emptyState(), { subjects: ['db'] }).state;
    const r3 = push(a2, tree, aState);
    expect(r3.tree.get('db/ch1/topics/nf.json')).toContain('really');
    const bob1 = pull(bob0.loaded, r3.tree, bob0.state);
    expect(bob1.loaded.subjects[0].topics[0].questions![0].prompt).toBe('Why 3NF, really?');
    // Bob edits locally, Alice edits again: conflict, Bob keeps his
    const bobEdit = structuredClone(bob1.loaded);
    bobEdit.subjects[0].topics[0].questions![0].prompt = 'Bob wording';
    const a3 = structuredClone(a2);
    a3.subjects[0].topics[0].questions![0].prompt = 'Alice again';
    const r4 = push(a3, r3.tree, r3.state);
    const bob2 = pull(bobEdit, r4.tree, bob1.state);
    expect(bob2.loaded.subjects[0].topics[0].questions![0].prompt).toBe('Bob wording');
    expect(bob2.report.join()).toContain('kept yours');
  });

  it('pushes new local cards, keeps stats and blocks home, and refuses unlisted subjects', () => {
    const { tree } = aliceRepo();
    const bob0 = pull(pack(), tree, emptyState());
    const bob = structuredClone(bob0.loaded);
    bob.subjects[0].topics[0].questions!.push({ id: 'bob1', prompt: 'New from Bob', stats: { seen: 1, recent: [0] } });
    bob.subjects.push({ id: 'secret', name: 'Secret', exam: { format: 'unknown' }, topics: [] });
    const r = push(bob, tree, bob0.state);
    expect(r.tree.get('db/ch1/topics/nf.json')).toContain('New from Bob');
    expect(r.tree.get('db/ch1/topics/nf.json')).not.toContain('stats');
    expect([...r.tree.keys()].some((k) => k.startsWith('secret/'))).toBe(false);
    expect(r.report.join()).toContain('not in the repo');
    expect(push(bob, r.tree, r.state).written).toEqual([]);
  });

  it('a card removed upstream stays with the learner but is not pushed back', () => {
    const { tree } = aliceRepo();
    const bob0 = pull(pack(), tree, emptyState());
    const t2 = new Map(tree);
    t2.set('db/ch1/topics/nf.json', JSON.stringify({ id: 'nf', title: 'Normal forms', questions: [] }));
    const bob1 = pull(bob0.loaded, t2, bob0.state);
    expect(bob1.loaded.subjects[0].topics[0].questions).toHaveLength(1);
    expect(push(bob1.loaded, t2, bob1.state).written).toEqual([]);
  });
  it('topic notes stay private: never pushed, repo notes come in once and local notes survive pulls', () => {
    const { tree, alice } = aliceRepo();
    const withNotes = structuredClone(alice);
    withNotes.subjects[0].topics[0].notes = 'Stand 26.10.: falsch';
    const r = push(withNotes, tree, emptyState(), { subjects: ['db'], author: 'alice', now: '2026-10-19T10:00:00Z' });
    expect(r.tree.get('db/ch1/topics/nf.json')).not.toContain('Stand 26.10.');

    const repo = new Map(r.tree);
    const f = JSON.parse(repo.get('db/ch1/topics/nf.json')!);
    repo.set('db/ch1/topics/nf.json', JSON.stringify({ ...f, notes: 'Shared hint' }));
    const bob = pull(pack(), repo, emptyState());
    expect(bob.loaded.subjects[0].topics[0].notes).toBe('Shared hint');

    const bobLocal = structuredClone(bob.loaded);
    bobLocal.subjects[0].topics[0].notes = 'my own';
    const again = pull(bobLocal, repo, bob.state);
    expect(again.loaded.subjects[0].topics[0].notes).toBe('my own');
    const back = push(bobLocal, repo, bob.state, { subjects: ['db'], author: 'bob', now: '2026-10-20T10:00:00Z' });
    expect(back.tree.get('db/ch1/topics/nf.json')).toContain('Shared hint');
    expect(back.tree.get('db/ch1/topics/nf.json')).not.toContain('my own');
  });
});
