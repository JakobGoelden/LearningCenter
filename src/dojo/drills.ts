// Drills: prepared dojo exercises that run and get graded inside the app,
// without asking an AI. Six kinds cover most subjects:
//   choice    multiple choice (one or several correct options)
//   input     short text answer, compared after normalizing
//   number    numeric answer with a tolerance
//   order     put steps into the right order
//   automaton build a finite automaton, checked for language equivalence
//   regex     write a regular expression, checked for language equivalence
//   self      open answer, then the learner compares with the solution and rates it

import type { Drill, Level, Score } from '../model/types';
import {
  accepts,
  automatonProblems,
  completedStateCount,
  counterexample,
  isDeterministic,
  minimalStateCount,
  RegexError,
  regexToAutomaton,
  type Automaton,
} from './automata';

/** What the learner entered, per drill kind. */
export type DrillAnswer =
  | { kind: 'choice'; picked: number[] }
  | { kind: 'input' | 'number' | 'regex' | 'self'; text: string }
  | { kind: 'order'; order: number[] }
  | { kind: 'automaton'; automaton: Automaton };

export interface DrillResult {
  correct: boolean;
  score: Score;
  /** Short explanation of what was wrong, shown before the drill's own explanation. */
  feedback: string;
}

/** Default time per drill when the drill sets none. */
export const DEFAULT_SECONDS: Record<Level, number> = { easy: 60, medium: 120, exam: 240 };
const SLOW_KINDS = new Set(['automaton', 'regex', 'self']);

export function secondsFor(d: Drill): number {
  if (d.seconds) return d.seconds;
  const base = DEFAULT_SECONDS[d.level ?? 'medium'];
  return SLOW_KINDS.has(d.kind) ? base * 2 : base;
}

const wordLabel = (w: string) => (w === '' ? 'the empty word ε' : `"${w}"`);

/** Lowercase, collapse spaces, drop spaces around punctuation, unify quotes and dashes. */
export function normalize(s: string, caseSensitive = false): string {
  let t = s
    .trim()
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:(){}[\]=+*/<>|-])\s*/g, '$1');
  if (!caseSensitive) t = t.toLowerCase();
  return t;
}

/** Accepts "0.5", "0,5" (decimal comma), "1,000.5" and "1.000,5". */
export function parseNumber(s: string): number | null {
  let t = s.trim().replace(/\s/g, '');
  const comma = t.lastIndexOf(',');
  const dot = t.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (comma >= 0) t = t.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  return Number(t);
}

const result = (correct: boolean, feedback = ''): DrillResult => ({ correct, score: correct ? 5 : 1, feedback });

export function referenceAutomaton(d: Drill & { kind: 'automaton' | 'regex' }): Automaton {
  if (d.reference.regex !== undefined) return regexToAutomaton(d.reference.regex, d.alphabet);
  return d.reference.automaton!;
}

export function gradeDrill(d: Drill, answer: DrillAnswer): DrillResult {
  switch (d.kind) {
    case 'choice': {
      if (answer.kind !== 'choice') break;
      const want = new Set(d.correct);
      const got = new Set(answer.picked);
      const ok = want.size === got.size && [...want].every((i) => got.has(i));
      if (ok) return result(true);
      const missing = [...want].filter((i) => !got.has(i)).length;
      const wrong = [...got].filter((i) => !want.has(i)).length;
      const parts = [wrong ? `${wrong} wrong option${wrong > 1 ? 's' : ''} picked` : '', missing ? `${missing} correct option${missing > 1 ? 's' : ''} missing` : ''];
      const r = result(false, parts.filter(Boolean).join(', ') + '.');
      // Partly right in a multi-answer question.
      if (want.size > 1 && got.size && missing + wrong <= 1) r.score = 3;
      return r;
    }
    case 'input': {
      if (answer.kind !== 'input') break;
      const got = normalize(answer.text, d.caseSensitive);
      if (!got) return { correct: false, score: 0, feedback: 'No answer.' };
      const ok = d.accept.some((a) => normalize(a, d.caseSensitive) === got);
      return result(ok, ok ? '' : `Expected: ${d.accept[0]}`);
    }
    case 'number': {
      if (answer.kind !== 'number') break;
      const n = parseNumber(answer.text);
      if (n === null) return { correct: false, score: answer.text.trim() ? 1 : 0, feedback: 'That is not a number.' };
      const tol = d.tolerance ?? 0;
      const ok = Math.abs(n - d.answer) <= tol + 1e-9 * Math.max(1, Math.abs(d.answer));
      return result(ok, ok ? '' : `Expected: ${d.answer}${d.unit ? ` ${d.unit}` : ''}`);
    }
    case 'order': {
      if (answer.kind !== 'order') break;
      const ok = answer.order.every((v, i) => v === i);
      if (ok) return result(true);
      const right = answer.order.filter((v, i) => v === i).length;
      const r = result(false, `${right} of ${d.items.length} in the right place.`);
      if (right >= d.items.length - 2 && d.items.length > 3) r.score = 3;
      return r;
    }
    case 'automaton': {
      if (answer.kind !== 'automaton') break;
      const a = answer.automaton;
      const problems = automatonProblems(a, d.alphabet);
      if (problems.length) return result(false, problems.join(' '));
      if (d.deterministic && !isDeterministic(a)) {
        return result(false, 'The automaton must be deterministic: no ε-transitions and at most one target per state and symbol.');
      }
      const ref = referenceAutomaton(d);
      const w = counterexample(a, ref, d.alphabet);
      if (w !== null) {
        const verdict = accepts(a, w, d.alphabet) ? 'accepted by your automaton but should not be' : 'not accepted by your automaton but should be';
        return result(false, `Not the right language: ${wordLabel(w)} is ${verdict}.`);
      }
      if (d.minimal) {
        const min = minimalStateCount(ref, d.alphabet);
        const have = completedStateCount(a, d.alphabet);
        if (have > min) {
          return { correct: false, score: 3, feedback: `Right language, but not minimal: the minimal complete DFA has ${min} states (dead state included), yours has ${have}.` };
        }
      }
      return result(true);
    }
    case 'regex': {
      if (answer.kind !== 'regex') break;
      if (!answer.text.trim()) return { correct: false, score: 0, feedback: 'No answer.' };
      let a: Automaton;
      try {
        a = regexToAutomaton(answer.text, d.alphabet);
      } catch (e) {
        if (e instanceof RegexError) return result(false, `Could not read the expression: ${e.message}`);
        throw e;
      }
      const ref = referenceAutomaton(d);
      const w = counterexample(a, ref, d.alphabet);
      if (w === null) return result(true);
      return result(
        false,
        `Not the right language: ${wordLabel(w)} ${accepts(ref, w, d.alphabet) ? 'should match but does not' : 'matches but should not'}.`,
      );
    }
    case 'self':
      // Graded by the learner after seeing the solution; see selfResult.
      break;
  }
  throw new Error(`Answer of kind ${answer.kind} does not fit drill kind ${d.kind}.`);
}

/** Result of a self-checked drill, from the learner's own rating. */
export function selfResult(rating: 'right' | 'partly' | 'wrong'): DrillResult {
  return rating === 'right'
    ? { correct: true, score: 5, feedback: '' }
    : rating === 'partly'
      ? { correct: false, score: 3, feedback: 'Partly right (your own rating).' }
      : { correct: false, score: 1, feedback: 'Not right yet (your own rating).' };
}

/** Problems in a drill definition (for validation); [] when it is usable. */
export function drillProblems(d: Drill): string[] {
  const out: string[] = [];
  switch (d.kind) {
    case 'choice':
      if (d.options.length < 2) out.push('needs at least 2 options');
      if (!d.correct.length) out.push('needs at least one correct option');
      for (const i of d.correct) if (i < 0 || i >= d.options.length) out.push(`correct index ${i} is out of range`);
      break;
    case 'input':
      if (!d.accept.length) out.push('needs at least one accepted answer');
      break;
    case 'order':
      if (d.items.length < 2) out.push('needs at least 2 items');
      break;
    case 'automaton':
    case 'regex':
      if ((d.reference.regex === undefined) === (d.reference.automaton === undefined)) {
        out.push('reference needs exactly one of "regex" or "automaton"');
        break;
      }
      try {
        const ref = referenceAutomaton(d);
        out.push(...automatonProblems(ref, d.alphabet).map((p) => `reference: ${p}`));
      } catch (e) {
        out.push(`reference regex: ${(e as Error).message}`);
      }
      if (d.given) out.push(...automatonProblems(d.given, d.alphabet).map((p) => `given: ${p}`));
      break;
  }
  return out;
}

/** A round: drills of the chosen level (or all), shuffled, at most `count`. */
export function pickRound(drills: Drill[], level: Level | 'all', count: number, random = Math.random): Drill[] {
  const pool = drills.filter((d) => level === 'all' || (d.level ?? 'medium') === level);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

/** Shuffled presentation order for an order drill, never already solved. */
export function shuffledOrder(n: number, random = Math.random): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return idx;
  do {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
  } while (idx.every((v, i) => v === i));
  return idx;
}

/** Overall score of a round, 0–5, for the spaced-repetition history. */
export function roundScore(results: DrillResult[]): Score {
  if (!results.length) return 0;
  return Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) as Score;
}

/** Text form of an answer, for the session log. */
export function answerText(d: Drill, a: DrillAnswer): string {
  switch (a.kind) {
    case 'choice':
      return a.picked.map((i) => (d.kind === 'choice' ? d.options[i] : String(i))).join(' | ');
    case 'order':
      return a.order.map((i) => (d.kind === 'order' ? d.items[i] : String(i))).join(' → ');
    case 'automaton':
      return JSON.stringify(a.automaton);
    default:
      return a.text;
  }
}

const KIND_KEYS: Record<Drill['kind'], string[]> = {
  choice: ['options', 'correct'],
  input: ['accept', 'caseSensitive'],
  number: ['answer', 'tolerance', 'unit'],
  order: ['items'],
  regex: ['alphabet', 'reference', 'given'],
  automaton: ['alphabet', 'reference', 'given', 'deterministic', 'minimal'],
  self: ['solution'],
};
const COMMON_KEYS = ['id', 'kind', 'level', 'topic', 'prompt', 'explanation', 'seconds'];

/**
 * Turns an AI-written drill into the stored shape: keeps only the fields of
 * its kind, drops empty values, and maps the flat `referenceRegex` (used by
 * structured outputs) to `reference.regex`.
 */
export function normalizeDrill(raw: Record<string, unknown>): Record<string, unknown> {
  const kind = raw.kind as Drill['kind'];
  const keys = [...COMMON_KEYS, ...(KIND_KEYS[kind] ?? [])];
  const src = { ...raw };
  if (typeof src.referenceRegex === 'string' && src.referenceRegex && !src.reference) src.reference = { regex: src.referenceRegex };
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = src[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0 && k !== 'correct')) continue;
    if (k === 'seconds' && v === 0) continue;
    out[k] = v;
  }
  if (typeof out.id === 'string') out.id = out.id.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '');
  return out;
}
