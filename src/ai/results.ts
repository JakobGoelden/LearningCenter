// Results for an AI that cannot open the pack (hosted app, browser storage):
// the app gathers them for the prompt and takes the grades back as pasted JSON.

import type { PendingResults } from '../model/sync';
import type { Score, Session, Subject } from '../model/types';
import type { PackFs } from '../storage/fs';
import { loadSession, loadWork } from '../storage/repo';
import type { ResultsDigest } from './chat';
import { extractJson } from './response';

/** Reads the sessions and sheets behind the banner's counts. Missing files are left out. */
export async function collectResults(fs: PackFs, subjects: Subject[], p: Pick<PendingResults, 'refs'>): Promise<ResultsDigest> {
  const sessions = async (ids: string[]) => (await Promise.all(ids.map((id) => loadSession(fs, id)))).filter((s): s is Session => !!s);
  const sheets = await Promise.all(
    p.refs.sheets.map(async (ref) => {
      const [subjectId, sheetId] = ref.split('/');
      const subject = subjects.find((s) => s.id === subjectId);
      const sheet = subject?.sheets?.find((s) => s.id === sheetId);
      return subject && sheet ? [{ subject, sheet, work: await loadWork(fs, subject.id, sheet.id) }] : [];
    }),
  );
  return {
    open: (await sessions(p.refs.toGrade)).filter((s) => !s.applied),
    quizzes: await sessions(p.refs.quizzes),
    dojo: await sessions(p.refs.dojo),
    sheets: sheets.flat(),
  };
}

export interface PastedGrade {
  session: string;
  n: number;
  score: Score;
  feedback?: string;
  gaps?: string[];
}

/** Reads the grades block out of an AI's reply. `session` fills in grades that do not name one. */
export function parseGrades(text: string, session?: string): { grades: PastedGrade[]; summary?: string } {
  const raw = extractJson(text) as { grades?: unknown; summary?: unknown };
  if (!Array.isArray(raw.grades) || !raw.grades.length) throw new Error('The answer has no "grades" list.');
  const grades = (raw.grades as Record<string, unknown>[]).map((g) => {
    const id = typeof g.session === 'string' && g.session ? g.session : session;
    const label = `Grade for answer ${String(g.n)}`;
    if (!id) throw new Error(`${label} names no session.`);
    if (typeof g.n !== 'number') throw new Error('A grade has no answer number "n".');
    if (!Number.isInteger(g.score) || (g.score as number) < 0 || (g.score as number) > 5) throw new Error(`${label}: the score must be a whole number from 0 to 5.`);
    return {
      session: id,
      n: g.n,
      score: g.score as Score,
      ...(typeof g.feedback === 'string' && g.feedback ? { feedback: g.feedback } : {}),
      ...(Array.isArray(g.gaps) && g.gaps.length ? { gaps: g.gaps.map(String) } : {}),
    };
  });
  return { grades, ...(typeof raw.summary === 'string' && raw.summary ? { summary: raw.summary } : {}) };
}

/** The session with the pasted grades written into its answers. Throws on an answer it does not have. */
export function withGrades(session: Session, grades: PastedGrade[], summary?: string): Session {
  const unknown = grades.find((g) => !session.items.some((i) => i.n === g.n));
  if (unknown) throw new Error(`Session ${session.id} has no answer ${unknown.n}.`);
  const byN = new Map(grades.map((g) => [g.n, g]));
  return {
    ...session,
    ...(summary ? { summary } : {}),
    items: session.items.map((it) => {
      const g = byN.get(it.n);
      return g ? { ...it, score: g.score, ...(g.feedback ? { feedback: g.feedback } : {}), ...(g.gaps ? { gaps: g.gaps } : {}) } : it;
    }),
  };
}
