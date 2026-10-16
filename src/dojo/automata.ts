// Finite automata for auto-graded dojo drills: parse what the learner typed,
// build NFAs from regular expressions (Thompson), and decide equivalence with
// a shortest counterexample word.

/** Symbol used for ε-transitions. */
export const EPS = 'ε';

import type { AutomatonData } from '../model/types';

/**
 * Plain-data automaton as stored in dojo files and entered in the app.
 * Transitions are [from, symbol, to]; symbol "ε" (or "", "eps") for ε-transitions.
 */
export type Automaton = AutomatonData;

const isEps = (s: string) => s === '' || s === EPS || s === 'eps' || s === 'epsilon';

interface Nfa {
  start: number;
  final: Set<number>;
  /** state → symbol → targets; EPS for ε. */
  delta: Map<number, Map<string, Set<number>>>;
}

function addEdge(nfa: Nfa, from: number, sym: string, to: number) {
  let m = nfa.delta.get(from);
  if (!m) nfa.delta.set(from, (m = new Map()));
  let t = m.get(sym);
  if (!t) m.set(sym, (t = new Set()));
  t.add(to);
}

/** Problems that make an automaton unusable; [] when it is well-formed. */
export function automatonProblems(a: Automaton, alphabet: string[]): string[] {
  const out: string[] = [];
  const states = new Set(a.states);
  if (!a.states.length) out.push('The automaton has no states.');
  if (states.size !== a.states.length) out.push('Some state names appear twice.');
  if (!states.has(a.start)) out.push(`Start state "${a.start}" is not one of the states.`);
  for (const f of a.final) if (!states.has(f)) out.push(`Final state "${f}" is not one of the states.`);
  for (const [from, sym, to] of a.transitions) {
    if (!states.has(from)) out.push(`Transition from unknown state "${from}".`);
    if (!states.has(to)) out.push(`Transition to unknown state "${to}".`);
    if (!isEps(sym) && !alphabet.includes(sym)) out.push(`Symbol "${sym}" is not in the alphabet {${alphabet.join(', ')}}.`);
  }
  return [...new Set(out)];
}

function toNfa(a: Automaton): Nfa {
  const index = new Map(a.states.map((s, i) => [s, i]));
  const nfa: Nfa = { start: index.get(a.start)!, final: new Set(a.final.map((f) => index.get(f)!)), delta: new Map() };
  for (const [from, sym, to] of a.transitions) addEdge(nfa, index.get(from)!, isEps(sym) ? EPS : sym, index.get(to)!);
  return nfa;
}

/** Deterministic: no ε, at most one target per state and symbol. */
export function isDeterministic(a: Automaton): boolean {
  const seen = new Set<string>();
  for (const [from, sym] of a.transitions) {
    if (isEps(sym)) return false;
    const key = `${from}\u0000${sym}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Every state has a transition for every symbol. */
export function isComplete(a: Automaton, alphabet: string[]): boolean {
  const have = new Set(a.transitions.map(([f, s]) => `${f}\u0000${s}`));
  return a.states.every((st) => alphabet.every((sym) => have.has(`${st}\u0000${sym}`)));
}

function closure(nfa: Nfa, set: Iterable<number>): Set<number> {
  const out = new Set(set);
  const stack = [...out];
  while (stack.length) {
    const s = stack.pop()!;
    for (const t of nfa.delta.get(s)?.get(EPS) ?? []) {
      if (!out.has(t)) {
        out.add(t);
        stack.push(t);
      }
    }
  }
  return out;
}

const keyOf = (set: Set<number>) => [...set].sort((a, b) => a - b).join(',');

/** Complete DFA over `alphabet` (states are numbers 0…n-1, 0 = start). */
interface Dfa {
  final: boolean[];
  next: number[][];
}

function determinize(nfa: Nfa, alphabet: string[]): Dfa {
  const start = closure(nfa, [nfa.start]);
  const ids = new Map([[keyOf(start), 0]]);
  const sets = [start];
  const dfa: Dfa = { final: [], next: [] };
  for (let i = 0; i < sets.length; i++) {
    const cur = sets[i];
    dfa.final[i] = [...cur].some((s) => nfa.final.has(s));
    dfa.next[i] = alphabet.map((sym) => {
      const moved = new Set<number>();
      for (const s of cur) for (const t of nfa.delta.get(s)?.get(sym) ?? []) moved.add(t);
      const target = closure(nfa, moved);
      const k = keyOf(target);
      let id = ids.get(k);
      if (id === undefined) {
        id = sets.length;
        ids.set(k, id);
        sets.push(target);
      }
      return id;
    });
  }
  return dfa;
}

/**
 * Shortest word accepted by exactly one of the two automata, or null when
 * they accept the same language. The empty word is returned as "".
 */
export function counterexample(a: Automaton, b: Automaton, alphabet: string[]): string | null {
  const da = determinize(toNfa(a), alphabet);
  const db = determinize(toNfa(b), alphabet);
  const seen = new Set(['0,0']);
  const queue: [number, number, string][] = [[0, 0, '']];
  while (queue.length) {
    const [x, y, word] = queue.shift()!;
    if (da.final[x] !== db.final[y]) return word;
    alphabet.forEach((sym, i) => {
      const nx = da.next[x][i];
      const ny = db.next[y][i];
      const k = `${nx},${ny}`;
      if (!seen.has(k)) {
        seen.add(k);
        queue.push([nx, ny, word + sym]);
      }
    });
  }
  return null;
}

/** Whether `word` (one character per symbol) is accepted. */
export function accepts(a: Automaton, word: string, alphabet: string[]): boolean {
  const nfa = toNfa(a);
  let cur = closure(nfa, [nfa.start]);
  for (const ch of word) {
    if (!alphabet.includes(ch)) return false;
    const moved = new Set<number>();
    for (const s of cur) for (const t of nfa.delta.get(s)?.get(ch) ?? []) moved.add(t);
    cur = closure(nfa, moved);
  }
  return [...cur].some((s) => nfa.final.has(s));
}

/** Number of states of the minimal complete DFA (dead state included). */
export function minimalStateCount(a: Automaton, alphabet: string[]): number {
  const dfa = determinize(toNfa(a), alphabet);
  const n = dfa.final.length;
  // Moore's partition refinement.
  let block: number[] = dfa.final.map((f) => (f ? 1 : 0));
  for (;;) {
    const sigs = new Map<string, number>();
    const next = block.map((_, s) => {
      const sig = `${block[s]}|${dfa.next[s].map((t) => block[t]).join(',')}`;
      let id = sigs.get(sig);
      if (id === undefined) sigs.set(sig, (id = sigs.size));
      return id;
    });
    const before = new Set(block).size;
    block = next;
    if (sigs.size === before) break;
  }
  return n === 0 ? 0 : new Set(block).size;
}

/** Number of states after completing `a` with a dead state if transitions are missing. */
export function completedStateCount(a: Automaton, alphabet: string[]): number {
  return a.states.length + (isComplete(a, alphabet) ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Regular expressions: single-character symbols, | for union, juxtaposition
// for concatenation, postfix * + ?, parentheses, ε (or "eps") and ∅.

type Re =
  | { t: 'sym'; s: string }
  | { t: 'eps' }
  | { t: 'empty' }
  | { t: 'cat' | 'alt'; a: Re; b: Re }
  | { t: 'star' | 'plus' | 'opt'; a: Re };

export class RegexError extends Error {}

export function parseRegex(input: string, alphabet: string[]): Re {
  const src = input.replace(/\s+/g, '').replace(/eps(ilon)?/g, EPS).replace(/∪/g, '|');
  let i = 0;
  const peek = () => src[i];
  const alt = (): Re => {
    let left = cat();
    while (peek() === '|') {
      i++;
      left = { t: 'alt', a: left, b: cat() };
    }
    return left;
  };
  const cat = (): Re => {
    let left: Re | null = null;
    while (i < src.length && peek() !== '|' && peek() !== ')') {
      const next = post();
      left = left ? { t: 'cat', a: left, b: next } : next;
    }
    if (!left) throw new RegexError(i < src.length ? `Empty part before "${peek()}".` : 'The expression is empty.');
    return left;
  };
  const post = (): Re => {
    let base = atom();
    while (peek() === '*' || peek() === '+' || peek() === '?') {
      const op = src[i++];
      base = { t: op === '*' ? 'star' : op === '+' ? 'plus' : 'opt', a: base };
    }
    return base;
  };
  const atom = (): Re => {
    const c = src[i];
    if (c === '(') {
      i++;
      const inner = alt();
      if (peek() !== ')') throw new RegexError('Missing ")".');
      i++;
      return inner;
    }
    i++;
    if (c === EPS) return { t: 'eps' };
    if (c === '∅') return { t: 'empty' };
    if (alphabet.includes(c)) return { t: 'sym', s: c };
    if (c === '*' || c === '+' || c === '?') throw new RegexError(`"${c}" needs something before it.`);
    throw new RegexError(`"${c}" is not in the alphabet {${alphabet.join(', ')}}.`);
  };
  const re = alt();
  if (i < src.length) throw new RegexError(`Unexpected "${src[i]}".`);
  return re;
}

/** Thompson construction. */
export function regexToAutomaton(input: string, alphabet: string[]): Automaton {
  const re = parseRegex(input, alphabet);
  const transitions: [string, string, string][] = [];
  let n = 0;
  const fresh = () => `s${n++}`;
  const edge = (a: string, s: string, b: string) => transitions.push([a, s, b]);
  const build = (r: Re): [string, string] => {
    const s = fresh();
    const f = fresh();
    switch (r.t) {
      case 'sym':
        edge(s, r.s, f);
        break;
      case 'eps':
        edge(s, EPS, f);
        break;
      case 'empty':
        break;
      case 'cat': {
        const [as, af] = build(r.a);
        const [bs, bf] = build(r.b);
        edge(s, EPS, as);
        edge(af, EPS, bs);
        edge(bf, EPS, f);
        break;
      }
      case 'alt': {
        for (const part of [r.a, r.b]) {
          const [ps, pf] = build(part);
          edge(s, EPS, ps);
          edge(pf, EPS, f);
        }
        break;
      }
      default: {
        const [as, af] = build(r.a);
        edge(s, EPS, as);
        edge(af, EPS, f);
        if (r.t !== 'plus') edge(s, EPS, f);
        if (r.t !== 'opt') edge(af, EPS, as);
      }
    }
    return [s, f];
  };
  const [start, end] = build(re);
  return { states: Array.from({ length: n }, (_, k) => `s${k}`), start, final: [end], transitions };
}
