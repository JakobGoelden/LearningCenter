// SQL drills: the learner writes real statements. They run in PGlite, PostgreSQL
// compiled to WebAssembly, on a fresh copy of the drill's database, and so does
// the solution; then the results are compared, so any correct way of writing it
// counts. The engine is large, so it loads only when a SQL drill is opened.

import type { Results } from '@electric-sql/pglite';
import type { Drill, Score } from '../model/types';
import type { DrillResult } from './drills';

export type SqlDrill = Extract<Drill, { kind: 'sql' }>;

interface Db {
  exec(sql: string, options: { rowMode: 'array' }): Promise<Results[]>;
}

/** Result sets of a statement, as rows of comparable text. */
type Tables = { columns: number; rows: string[] }[];

let engine: Promise<Db> | null = null;

/** Starts the database; call it early so the first check does not wait for the download. */
export function sqlEngine(): Promise<Db> {
  engine ??= import('@electric-sql/pglite').then(({ PGlite }) => PGlite.create());
  return engine;
}

/** Rows as lists: two columns may share a name, as in `SELECT m.name, a.name`. */
const ARRAYS = { rowMode: 'array' } as const;
const RESET = 'RESET ALL; DROP SCHEMA public CASCADE; CREATE SCHEMA public;';

/** Text for one value: 3700.00 and 3700 are the same number. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  const text = String(v);
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : text;
}

const toTables = (results: Results[]): Tables =>
  results
    .filter((r) => r.fields.length > 0)
    .map((r) => ({
      columns: r.fields.length,
      rows: r.rows.map((row) => (row as unknown[]).map(cell).join(' | ')),
    }));

/** Runs a script on a fresh database. The tables come from `check` if the drill has one, else from the script. */
async function run(db: Db, d: SqlDrill, script: string): Promise<Tables> {
  await db.exec(RESET, ARRAYS);
  if (d.setup) await db.exec(d.setup, ARRAYS);
  const out = await db.exec(script, ARRAYS);
  return toTables(d.check ? await db.exec(d.check, ARRAYS) : out);
}

const sameRows = (a: string[], b: string[]) => a.length === b.length && a.every((r, i) => r === b[i]);
const sorted = (rows: string[]) => [...rows].sort();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const preview = (rows: string[]) => (rows.length ? rows.slice(0, 8).join('\n') + (rows.length > 8 ? `\n… ${rows.length - 8} more` : '') : '(no rows)');

function compare(d: SqlDrill, got: Tables, want: Tables): Omit<DrillResult, 'share'> {
  const wrong = (feedback: string, score: Score = 1) => ({ correct: false, score, feedback });
  if (got.length < want.length) return wrong(d.check ? 'The database does not match.' : 'Your statement returned no rows, but a result was asked for.');
  for (let i = 0; i < want.length; i++) {
    const g = got[d.check ? i : got.length - want.length + i];
    const w = want[i];
    const state = d.check ? 'The database ends up different' : 'Your result is different';
    if (g.columns !== w.columns) return wrong(`${state}: ${plural(g.columns, 'column')} instead of ${w.columns}.`);
    if (!sameRows(sorted(g.rows), sorted(w.rows))) {
      const count = g.rows.length === w.rows.length ? '' : `, ${plural(g.rows.length, 'row')} instead of ${w.rows.length}`;
      return wrong(`${state}${count}.\n\nYours:\n${preview(g.rows)}\n\nExpected:\n${preview(w.rows)}`);
    }
    if (d.ordered && !sameRows(g.rows, w.rows)) return wrong('The right rows, but in the wrong order.', 3);
  }
  return { correct: true, score: 5, feedback: '' };
}

export async function gradeSqlDrill(d: SqlDrill, script: string): Promise<DrillResult> {
  if (!script.trim()) return { correct: false, score: 0, feedback: 'No answer.' };
  const db = await sqlEngine();
  const want = await run(db, d, d.solution);
  let got: Tables;
  try {
    got = await run(db, d, script);
  } catch (e) {
    return { correct: false, score: 1, feedback: `PostgreSQL says: ${(e as Error).message}` };
  }
  return compare(d, got, want);
}

/** Problems a solution only shows when run: errors, and tasks that are done before they start. */
export async function sqlProblems(d: SqlDrill): Promise<string[]> {
  const db = await sqlEngine();
  try {
    const result = await gradeSqlDrill(d, d.solution);
    if (!result.correct) return [`solution does not match itself: ${result.feedback}`];
    if (d.check && (await gradeSqlDrill(d, 'SELECT 1')).correct) return ['check passes without doing anything'];
    if (!d.check && !(await run(db, d, d.solution)).length) return ['solution returns no result and there is no check'];
  } catch (e) {
    return [`solution fails: ${(e as Error).message}`];
  }
  return [];
}
