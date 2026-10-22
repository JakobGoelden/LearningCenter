// ```automaton blocks in Markdown (cards, sheets, dojo texts): a small text
// format, or the JSON used in drill files, drawn as a state diagram.
//
//   start: q0
//   final: q2
//   q0 -a-> q1
//   q1 -a,b-> q2
//   q2 b q2
//
// "states:" is optional (the order of appearance is used); ε or eps for
// ε-transitions; lines starting with # are comments.

import { automatonProblems, EPS, type Automaton } from './automata';

export type AutomatonBlock = { automaton: Automaton } | { error: string };

const list = (s: string) => s.split(/[\s,]+/).filter(Boolean);
const symbol = (s: string) => (s === 'eps' || s === 'epsilon' ? EPS : s);

function parseText(text: string): Automaton | string {
  let start: string | undefined;
  let final: string[] = [];
  let states: string[] | undefined;
  const seen: string[] = [];
  const see = (s: string) => {
    if (!seen.includes(s)) seen.push(s);
  };
  const transitions: [string, string, string][] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const kv = line.match(/^(start|final|states)\s*:\s*(.*)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      if (key === 'start') start = kv[2].trim();
      else if (key === 'final') final = list(kv[2]);
      else states = list(kv[2]);
      continue;
    }
    const m = line.match(/^(\S+)\s+-+\s*(.+?)\s*-*>\s*(\S+)$/) ?? line.match(/^(\S+)\s+(\S+)\s+(\S+)$/);
    if (!m) return `Cannot read the line "${line}". Write it as "q0 -a-> q1".`;
    see(m[1]);
    see(m[3]);
    for (const sym of m[2].split(',').map((s) => s.trim()).filter(Boolean)) transitions.push([m[1], symbol(sym), m[3]]);
  }
  if (!start) return 'The start state is missing (a line "start: q0").';
  return {
    states: states ?? [start, ...seen.filter((s) => s !== start), ...final.filter((f) => f !== start && !seen.includes(f))],
    start,
    final,
    transitions,
  };
}

function parseJson(text: string): Automaton | string {
  let data: Partial<Automaton>;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return `Not valid JSON: ${(e as Error).message}`;
  }
  if (typeof data.start !== 'string' || !Array.isArray(data.transitions)) return 'JSON needs "start" and "transitions".';
  const transitions = data.transitions.map(([from, sym, to]) => [from, symbol(sym), to] as [string, string, string]);
  const states = data.states ?? [...new Set([data.start, ...transitions.flatMap(([f, , t]) => [f, t]), ...(data.final ?? [])])];
  return { states, start: data.start, final: data.final ?? [], transitions };
}

/** Reads the body of an ```automaton block. */
export function parseAutomatonBlock(body: string): AutomatonBlock {
  const text = body.trim();
  const a = text.startsWith('{') ? parseJson(text) : parseText(text);
  if (typeof a === 'string') return { error: a };
  const alphabet = [...new Set(a.transitions.map(([, s]) => s).filter((s) => s !== EPS))];
  const problems = automatonProblems(a, alphabet);
  return problems.length ? { error: problems.join(' ') } : { automaton: a };
}

/** Problems of all ```automaton blocks in a Markdown text (for validation). */
export function automatonBlockProblems(markdown: string): string[] {
  const out: string[] = [];
  const re = /^```\s*automaton\s*\n([\s\S]*?)^```/gm;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
    const r = parseAutomatonBlock(m[1]);
    if ('error' in r) out.push(r.error);
  }
  return out;
}
