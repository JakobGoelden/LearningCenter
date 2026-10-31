import type { Chapter, Dojo, Exam, LoadedPack, Topic, TopicQuestion } from '../model/types';

/**
 * Sharing cards and dojos through a git repository (one per semester).
 *
 * Layout of the repo (paths are what `SharedTree` keys look like):
 *   repo.json                                   marker with title
 *   changelog.jsonl                             one line per change, append only
 *   <subject>/subject.json                      {id, name, short?, color?, exam?}
 *   <subject>/topics/<topic>.json               {id, title, notes?, questions: [...]}
 *   <subject>/dojos/<dojo>.json                 a dojo file
 *   <subject>/<chapter>/chapter.json            {id, title, order?}  (optional chapters)
 *   <subject>/<chapter>/topics/<topic>.json     topics and dojos of a chapter
 *   <subject>/<chapter>/dojos/<dojo>.json
 *
 * Only content is shared: prompt, kind and answer of a card. Stats, blocks,
 * schedules and history never leave the machine. Which version of each item
 * was last synced is kept per pack in `shared.json` (ShareState), as a hash,
 * so edits on either side can be told apart.
 */

/** Repo content as path → text. */
export type SharedTree = Map<string, string>;

export interface ShareState {
  schemaVersion: 1;
  /** Folder of the repo clone, remembered for the next run. */
  repo?: string;
  /** Number of changelog lines already shown. */
  changelogSeen: number;
  /**
   * Key → hash of the shared version at the last sync. `gone`: removed on one
   * side on purpose (a card deleted locally or upstream), never re-added or pushed.
   */
  items: Record<string, string>;
}

export const emptyState = (): ShareState => ({ schemaVersion: 1, changelogSeen: 0, items: {} });

export interface ChangelogEntry {
  ts: string;
  by?: string;
  action: 'add' | 'update';
  kind: 'card' | 'topic' | 'dojo' | 'chapter' | 'subject';
  subject: string;
  ref: string;
}

type SharedCard = Pick<TopicQuestion, 'id' | 'prompt' | 'kind' | 'answer'>;

interface SharedTopic {
  path: string;
  subject: string;
  chapter?: string;
  id: string;
  title: string;
  notes?: string;
  questions: SharedCard[];
}

/** What everybody in the course has in common about an exam. `aids` and `notes` stay in the pack. */
export type SharedExam = Pick<Exam, 'format' | 'date' | 'time' | 'durationMinutes' | 'location'>;

export interface SharedSubject {
  name: string;
  short?: string;
  color?: string;
  exam?: SharedExam;
}

/** The shareable part of an exam; nothing until it has a date. */
function sharedExam(e: Exam): SharedExam | undefined {
  if (!e.date) return undefined;
  return {
    format: e.format,
    date: e.date,
    ...(e.time ? { time: e.time } : {}),
    ...(e.durationMinutes ? { durationMinutes: e.durationMinutes } : {}),
    ...(e.location ? { location: e.location } : {}),
  };
}

export interface SharedContent {
  subjects: Map<string, SharedSubject>;
  chapters: Map<string, { subject: string; chapter: Chapter; order: number }>;
  topics: Map<string, SharedTopic>;
  dojos: Map<string, { path: string; dojo: Dojo }>;
}

// ---- hashing -------------------------------------------------------------

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** cyrb53: small, deterministic in Node and browsers. */
export function hash(v: unknown): string {
  const s = canonical(v);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const cardBody = (q: SharedCard) => ({ prompt: q.prompt, kind: q.kind, answer: q.answer });
// Topic notes are private: they never count as a change and are never pushed. Notes that already
// exist in the repo come in with a new topic and are left untouched in the repo on push.
const topicBody = (t: { title: string; chapter?: string }) => ({ title: t.title, chapter: t.chapter });

const keys = {
  subject: (s: string) => `subject:${s}`,
  exam: (s: string) => `exam:${s}`,
  chapter: (s: string, c: string) => `chapter:${s}/${c}`,
  topic: (s: string, t: string) => `topic:${s}/${t}`,
  card: (s: string, t: string, q: string) => `card:${s}/${t}/${q}`,
  dojo: (s: string, d: string) => `dojo:${s}/${d}`,
};

// ---- reading the repo ----------------------------------------------------

const SLUG = /^[a-z0-9][a-z0-9._-]*$/;

function parseJson<T>(path: string, text: string, problems: string[]): T | null {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    problems.push(`${path}: not valid JSON (${(e as Error).message})`);
    return null;
  }
}

export function readTree(tree: SharedTree, problems: string[] = []): SharedContent {
  const out: SharedContent = { subjects: new Map(), chapters: new Map(), topics: new Map(), dojos: new Map() };
  for (const [path, text] of [...tree].sort(([a], [b]) => a.localeCompare(b))) {
    const p = path.split('/');
    if (p.length < 2 || !p.every((x) => x && !x.startsWith('.')) || !p[p.length - 1].endsWith('.json')) continue;
    const [subject] = p;
    if (!SLUG.test(subject)) continue;
    const file = p[p.length - 1];
    if (p.length === 2 && file === 'subject.json') {
      const d = parseJson<SharedSubject>(path, text, problems);
      if (d?.name) out.subjects.set(subject, { name: d.name, ...(d.short ? { short: d.short } : {}), ...(d.color ? { color: d.color } : {}), ...(d.exam?.date ? { exam: d.exam } : {}) });
    } else if (p.length === 3 && file === 'chapter.json') {
      const d = parseJson<{ title?: string; order?: number }>(path, text, problems);
      if (d?.title) out.chapters.set(`${subject}/${p[1]}`, { subject, chapter: { id: p[1], title: d.title }, order: d.order ?? 0 });
    } else {
      const chapter = p.length === 4 ? p[1] : undefined;
      const kind = p[p.length - 2];
      if (p.length !== 3 && p.length !== 4) continue;
      const id = file.replace(/\.json$/, '');
      if (kind === 'topics') {
        const d = parseJson<{ title?: string; notes?: string; questions?: SharedCard[] }>(path, text, problems);
        if (d?.title)
          out.topics.set(keys.topic(subject, id), {
            path,
            subject,
            ...(chapter ? { chapter } : {}),
            id,
            title: d.title,
            ...(d.notes ? { notes: d.notes } : {}),
            questions: (d.questions ?? []).filter((q) => q?.id && q.prompt),
          });
      } else if (kind === 'dojos') {
        const d = parseJson<Dojo>(path, text, problems);
        if (d?.id === id) out.dojos.set(keys.dojo(subject, id), { path, dojo: { ...d, subject, ...(chapter ? { chapter } : {}) } });
        else if (d) problems.push(`${path}: the dojo id must be "${id}"`);
      }
    }
  }
  return out;
}

export function readChangelog(tree: SharedTree): ChangelogEntry[] {
  return (tree.get('changelog.jsonl') ?? '')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as ChangelogEntry];
      } catch {
        return [];
      }
    });
}

// ---- pull ------------------------------------------------------------------

export interface PullOptions {
  /** New chapters start switched on (default: off, the learner chooses). */
  enableNewChapters?: boolean;
}

export interface PullResult {
  loaded: LoadedPack;
  state: ShareState;
  report: string[];
  changed: boolean;
}

type Verdict = 'add' | 'update' | 'same' | 'local-edit' | 'conflict' | 'skip';

function reconcile(state: ShareState, key: string, local: string | undefined, shared: string): Verdict {
  const st = state.items[key];
  if (local === undefined) return st === undefined ? 'add' : 'skip';
  if (local === shared) return 'same';
  if (st === undefined || st === 'gone') return 'conflict';
  if (local === st) return 'update';
  return shared === st ? 'local-edit' : 'conflict';
}

export function pull(loaded: LoadedPack, tree: SharedTree, stateIn: ShareState, opts: PullOptions = {}): PullResult {
  const problems: string[] = [];
  const shared = readTree(tree, problems);
  const state: ShareState = { ...stateIn, items: { ...stateIn.items } };
  const report: string[] = problems.map((p) => `skipped ${p}`);
  const subjects = loaded.subjects.map((s) => ({ ...s }));
  let dojos = [...loaded.dojos];
  let packSubjects = [...loaded.pack.subjects];
  let packDojos = [...(loaded.pack.dojos ?? [])];
  let changed = false;
  const seenKeys = new Set<string>();

  for (const [sid, info] of shared.subjects) {
    let subj = subjects.find((s) => s.id === sid);
    if (!subj) {
      subj = { id: sid, name: info.name, ...(info.short ? { short: info.short } : {}), ...(info.color ? { color: info.color } : {}), exam: { format: 'unknown' }, topics: [] };
      subjects.push(subj);
      packSubjects.push(sid);
      report.push(`new subject ${info.name}`);
      changed = true;
    }
    seenKeys.add(keys.subject(sid));
    state.items[keys.subject(sid)] = hash(info);

    // Exam: take the repo's date unless the person changed theirs since the last sync.
    const examKey = keys.exam(sid);
    seenKeys.add(examKey);
    if (info.exam) {
      const theirs = hash(info.exam);
      const mine = sharedExam(subj.exam);
      if (theirs !== (mine && hash(mine)) && (!mine || hash(mine) === state.items[examKey])) {
        subj.exam = { ...subj.exam, ...info.exam };
        report.push(`${info.name}: exam on ${info.exam.date}`);
        changed = true;
      }
      state.items[examKey] = theirs;
    }

    // chapters
    const chapters = [...(subj.chapters ?? [])];
    const wanted = [...shared.chapters.values()].filter((c) => c.subject === sid).sort((a, b) => a.order - b.order || a.chapter.id.localeCompare(b.chapter.id));
    for (const c of wanted) {
      const key = keys.chapter(sid, c.chapter.id);
      seenKeys.add(key);
      const have = chapters.find((x) => x.id === c.chapter.id);
      if (!have) {
        chapters.push({ ...c.chapter, enabled: opts.enableNewChapters ? true : false });
        report.push(`${subj.name}: new chapter "${c.chapter.title}"${opts.enableNewChapters ? '' : ' (switched off, turn it on on the subject page)'}`);
        changed = true;
      } else if (have.title !== c.chapter.title && (state.items[key] === undefined || state.items[key] === hash({ title: have.title }))) {
        chapters[chapters.indexOf(have)] = { ...have, title: c.chapter.title };
        changed = true;
      }
      state.items[key] = hash({ title: c.chapter.title });
    }
    if (chapters.length !== (subj.chapters?.length ?? 0) || chapters.some((c, i) => c !== subj!.chapters?.[i])) subj.chapters = chapters;

    // topics and cards
    let topics = [...subj.topics];
    for (const st of [...shared.topics.values()].filter((t) => t.subject === sid)) {
      const tk = keys.topic(sid, st.id);
      seenKeys.add(tk);
      const idx = topics.findIndex((t) => t.id === st.id);
      const sBody = topicBody({ title: st.title, chapter: st.chapter });
      if (idx < 0) {
        const topic: Topic = {
          id: st.id,
          title: st.title,
          ...(st.notes ? { notes: st.notes } : {}),
          ...(st.chapter ? { chapter: st.chapter } : {}),
          status: 'new',
          questions: st.questions.map((q) => ({ id: q.id, prompt: q.prompt, ...(q.kind ? { kind: q.kind } : {}), ...(q.answer ? { answer: q.answer } : {}) })),
        };
        topics.push(topic);
        state.items[tk] = hash(sBody);
        for (const q of st.questions) {
          seenKeys.add(keys.card(sid, st.id, q.id));
          state.items[keys.card(sid, st.id, q.id)] = hash(cardBody(q));
        }
        report.push(`${subj.name} / ${st.title}: new topic with ${st.questions.length} cards`);
        changed = true;
        continue;
      }
      let topic = topics[idx];
      const v = reconcile(state, tk, hash(topicBody(topic)), hash(sBody));
      if (v === 'update') {
        topic = { ...topic, title: st.title, ...(st.chapter ? { chapter: st.chapter } : {}) };
        if (!st.chapter) delete topic.chapter;
        report.push(`${subj.name} / ${st.title}: topic updated`);
        changed = true;
      } else if (v === 'conflict') report.push(`${subj.name} / ${st.title}: topic differs from the repo, kept yours`);
      if (v !== 'conflict' && v !== 'local-edit') state.items[tk] = hash(sBody);

      const questions = [...(topic.questions ?? [])];
      let added = 0;
      let updated = 0;
      for (const q of st.questions) {
        const ck = keys.card(sid, st.id, q.id);
        seenKeys.add(ck);
        const i = questions.findIndex((x) => x.id === q.id);
        const cv = reconcile(state, ck, i < 0 ? undefined : hash(cardBody(questions[i])), hash(cardBody(q)));
        if (cv === 'add') {
          questions.push({ id: q.id, prompt: q.prompt, ...(q.kind ? { kind: q.kind } : {}), ...(q.answer ? { answer: q.answer } : {}) });
          added++;
        } else if (cv === 'update') {
          const { kind: _k, answer: _a, ...rest } = questions[i];
          questions[i] = { ...rest, prompt: q.prompt, ...(q.kind ? { kind: q.kind } : {}), ...(q.answer ? { answer: q.answer } : {}) };
          updated++;
        } else if (cv === 'conflict') report.push(`${subj.name} / ${st.title} / ${q.id}: card differs from the repo, kept yours`);
        if (cv === 'add' || cv === 'update' || cv === 'same') state.items[ck] = hash(cardBody(q));
      }
      if (added || updated) {
        report.push(`${subj.name} / ${st.title}: ${added ? `${added} new cards` : ''}${added && updated ? ', ' : ''}${updated ? `${updated} cards updated` : ''}`);
        changed = true;
      }
      topics[idx] = { ...topic, questions: questions.length ? questions : topic.questions };
      if (!questions.length && !topic.questions) delete topics[idx].questions;
    }
    subj.topics = topics;
  }

  // dojos
  for (const [dk, sd] of shared.dojos) {
    seenKeys.add(dk);
    const idx = dojos.findIndex((d) => d.subject === sd.dojo.subject && d.id === sd.dojo.id);
    const v = reconcile(state, dk, idx < 0 ? undefined : hash(dojos[idx]), hash(sd.dojo));
    if (v === 'add') {
      dojos.push(sd.dojo);
      if (!packDojos.includes(sd.dojo.id)) packDojos.push(sd.dojo.id);
      report.push(`new dojo ${sd.dojo.title} (${sd.dojo.subject})`);
      changed = true;
    } else if (v === 'update') {
      dojos[idx] = sd.dojo;
      report.push(`dojo ${sd.dojo.title} updated`);
      changed = true;
    } else if (v === 'conflict') report.push(`dojo ${sd.dojo.title} differs from the repo, kept yours`);
    if (v === 'add' || v === 'update' || v === 'same') state.items[dk] = hash(sd.dojo);
  }

  // removed upstream: never re-add, never push back
  for (const k of Object.keys(state.items)) {
    if (!seenKeys.has(k) && state.items[k] !== 'gone') {
      const sid = k.slice(k.indexOf(':') + 1).split('/')[0];
      if (shared.subjects.has(sid)) {
        state.items[k] = 'gone';
        if (k.startsWith('card:') || k.startsWith('dojo:')) report.push(`${k} was removed from the repo (yours stays, not pushed)`);
      }
    }
  }

  return {
    loaded: { pack: { ...loaded.pack, subjects: packSubjects, ...(packDojos.length ? { dojos: packDojos } : {}) }, subjects, dojos },
    state,
    report,
    changed,
  };
}

// ---- push ------------------------------------------------------------------

export interface PushOptions {
  /** Subjects that may be created in the repo; others are only pushed if the repo already has them. */
  subjects?: string[];
  author?: string;
  now?: string;
}

export interface PushResult {
  tree: SharedTree;
  state: ShareState;
  report: string[];
  /** Paths that were written. */
  written: string[];
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

export function push(loaded: LoadedPack, treeIn: SharedTree, stateIn: ShareState, opts: PushOptions = {}): PushResult {
  const tree: SharedTree = new Map(treeIn);
  const shared = readTree(tree);
  const state: ShareState = { ...stateIn, items: { ...stateIn.items } };
  const report: string[] = [];
  const written: string[] = [];
  const log: ChangelogEntry[] = [];
  const ts = opts.now ?? new Date().toISOString();
  const entry = (action: ChangelogEntry['action'], kind: ChangelogEntry['kind'], subject: string, ref: string) =>
    log.push({ ts, ...(opts.author ? { by: opts.author } : {}), action, kind, subject, ref });
  const put = (path: string, text: string) => {
    tree.set(path, text);
    if (!written.includes(path)) written.push(path);
  };

  /** Decides if a local item goes into the repo. */
  const toPush = (key: string, local: string, remote: string | undefined, label: string): 'add' | 'update' | null => {
    const st = state.items[key];
    if (st === 'gone' || st === local) return null;
    if (remote === local) {
      state.items[key] = local;
      return null;
    }
    if (st !== undefined && remote === undefined) {
      report.push(`${label}: removed from the repo meanwhile, not pushed`);
      return null;
    }
    if (remote !== undefined && remote !== st) {
      report.push(`${label}: changed in the repo and here, pull first`);
      return null;
    }
    return remote === undefined ? 'add' : 'update';
  };

  for (const subj of loaded.subjects) {
    const inRepo = shared.subjects.has(subj.id);
    if (!inRepo && !opts.subjects?.includes(subj.id)) {
      report.push(`${subj.name}: not in the repo, not shared (add --subject ${subj.id} to share it)`);
      continue;
    }
    if (!inRepo) {
      put(`${subj.id}/subject.json`, json({ id: subj.id, name: subj.name, ...(subj.short ? { short: subj.short } : {}), ...(subj.color ? { color: subj.color } : {}) }));
      entry('add', 'subject', subj.id, subj.id);
      state.items[keys.subject(subj.id)] = hash({ name: subj.name, ...(subj.short ? { short: subj.short } : {}), ...(subj.color ? { color: subj.color } : {}) });
    }
    const exam = sharedExam(subj.exam);
    const examKey = keys.exam(subj.id);
    if (exam && hash(exam) !== state.items[examKey]) {
      const inRepoNow = shared.subjects.get(subj.id);
      const theirs = inRepoNow?.exam;
      if (theirs && hash(theirs) !== state.items[examKey] && hash(theirs) !== hash(exam)) {
        report.push(`${subj.name}: exam date changed in the repo too, pull first`);
      } else if (!theirs || hash(theirs) !== hash(exam)) {
        put(`${subj.id}/subject.json`, json({ id: subj.id, name: subj.name, ...(subj.short ? { short: subj.short } : {}), ...(subj.color ? { color: subj.color } : {}), ...inRepoNow, exam }));
        entry('update', 'subject', subj.id, subj.id);
        state.items[examKey] = hash(exam);
      } else {
        state.items[examKey] = hash(exam);
      }
    }
    const chapterIds = new Set<string>();
    for (const t of subj.topics) {
      const cardsHere = (t.questions ?? []).filter((q) => !q.blocked);
      const tk = keys.topic(subj.id, t.id);
      const existing = shared.topics.get(tk);
      if (t.chapter) chapterIds.add(t.chapter);

      const metaAction = toPush(tk, hash(topicBody(t)), existing ? hash(topicBody({ title: existing.title, chapter: existing.chapter })) : undefined, `${subj.name} / ${t.title}`);
      const merged = new Map<string, SharedCard>((existing?.questions ?? []).map((q) => [q.id, q]));
      let cardChanges = 0;
      for (const q of cardsHere) {
        const ck = keys.card(subj.id, t.id, q.id);
        const remote = merged.get(q.id);
        const act = toPush(ck, hash(cardBody(q)), remote ? hash(cardBody(remote)) : undefined, `${subj.name} / ${t.title} / ${q.id}`);
        if (!act) continue;
        merged.set(q.id, { id: q.id, prompt: q.prompt, ...(q.kind ? { kind: q.kind } : {}), ...(q.answer ? { answer: q.answer } : {}) });
        state.items[ck] = hash(cardBody(q));
        entry(act, 'card', subj.id, `${t.id}/${q.id}`);
        cardChanges++;
      }
      if (!metaAction && !cardChanges) continue;
      const path = `${subj.id}/${t.chapter ? `${t.chapter}/` : ''}topics/${t.id}.json`;
      if (existing && existing.path !== path) {
        tree.delete(existing.path);
        written.push(existing.path);
      }
      put(path, json({ id: t.id, title: t.title, ...(existing?.notes ? { notes: existing.notes } : {}), questions: [...merged.values()] }));
      if (metaAction) {
        state.items[tk] = hash(topicBody(t));
        entry(metaAction, 'topic', subj.id, t.id);
      } else if (state.items[tk] === undefined) state.items[tk] = hash(topicBody(t));
      report.push(`${subj.name} / ${t.title}: ${cardChanges} cards${metaAction === 'add' ? ' (new topic)' : ''}`);
    }
    for (const cid of chapterIds) {
      const ch = subj.chapters?.find((c) => c.id === cid);
      const ck = keys.chapter(subj.id, cid);
      if (ch && !shared.chapters.has(`${subj.id}/${cid}`)) {
        const order = (subj.chapters ?? []).indexOf(ch);
        put(`${subj.id}/${cid}/chapter.json`, json({ id: cid, title: ch.title, order }));
        state.items[ck] = hash({ title: ch.title });
        entry('add', 'chapter', subj.id, cid);
      }
    }
  }

  // dojos
  for (const d of loaded.dojos) {
    if (!shared.subjects.has(d.subject) && !opts.subjects?.includes(d.subject)) continue;
    const dk = keys.dojo(d.subject, d.id);
    const existing = shared.dojos.get(dk);
    const act = toPush(dk, hash(d), existing ? hash(existing.dojo) : undefined, `dojo ${d.title}`);
    if (!act) continue;
    const path = `${d.subject}/${d.chapter ? `${d.chapter}/` : ''}dojos/${d.id}.json`;
    if (existing && existing.path !== path) {
      tree.delete(existing.path);
      written.push(existing.path);
    }
    put(path, json(d));
    state.items[dk] = hash(d);
    entry(act, 'dojo', d.subject, d.id);
    report.push(`dojo ${d.title}: ${act === 'add' ? 'new' : 'updated'}`);
  }

  if (log.length) {
    put('changelog.jsonl', (tree.get('changelog.jsonl') ?? '') + log.map((l) => JSON.stringify(l)).join('\n') + '\n');
    state.changelogSeen = readChangelog(tree).length;
  }
  if (!tree.has('repo.json')) put('repo.json', json({ format: 'learningcenter-shared', schemaVersion: 1 }));
  return { tree, state, report, written };
}
