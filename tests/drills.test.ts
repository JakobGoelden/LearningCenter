import { describe, expect, it } from 'vitest';
import {
  accepts,
  counterexample,
  isDeterministic,
  minimalStateCount,
  parseRegex,
  RegexError,
  regexToAutomaton,
  type Automaton,
} from '../src/dojo/automata';
import { gradeDrill, normalize, parseNumber, pickRound, roundScore, shuffledOrder } from '../src/dojo/drills';
import type { Drill } from '../src/model/types';

const AB = ['a', 'b'];

// DFA for "words ending in ab".
const endsAb: Automaton = {
  states: ['0', '1', '2'],
  start: '0',
  final: ['2'],
  transitions: [
    ['0', 'a', '1'],
    ['0', 'b', '0'],
    ['1', 'a', '1'],
    ['1', 'b', '2'],
    ['2', 'a', '1'],
    ['2', 'b', '0'],
  ],
};

describe('automata', () => {
  it('builds NFAs from regular expressions', () => {
    const re = regexToAutomaton('(a|b)*ab', AB);
    expect(accepts(re, 'ab', AB)).toBe(true);
    expect(accepts(re, 'babab', AB)).toBe(true);
    expect(accepts(re, 'ba', AB)).toBe(false);
    expect(accepts(re, '', AB)).toBe(false);
    expect(accepts(regexToAutomaton('a+b?', AB), 'aab', AB)).toBe(true);
    expect(accepts(regexToAutomaton('a+b?', AB), 'b', AB)).toBe(false);
    expect(accepts(regexToAutomaton('ε|a', AB), '', AB)).toBe(true);
    expect(accepts(regexToAutomaton('∅', AB), '', AB)).toBe(false);
  });

  it('reports unreadable expressions', () => {
    expect(() => parseRegex('(ab', AB)).toThrow(RegexError);
    expect(() => parseRegex('ac', AB)).toThrow(/not in the alphabet/);
    expect(() => parseRegex('*a', AB)).toThrow(RegexError);
    expect(() => parseRegex('', AB)).toThrow(RegexError);
  });

  it('finds the shortest counterexample', () => {
    expect(counterexample(endsAb, regexToAutomaton('(a|b)*ab', AB), AB)).toBeNull();
    expect(counterexample(endsAb, regexToAutomaton('(a|b)*b', AB), AB)).toBe('b');
    expect(counterexample(regexToAutomaton('a*', AB), regexToAutomaton('a+', AB), AB)).toBe('');
  });

  it('knows determinism and minimal size', () => {
    expect(isDeterministic(endsAb)).toBe(true);
    expect(isDeterministic(regexToAutomaton('a|b', AB))).toBe(false);
    expect(minimalStateCount(endsAb, AB)).toBe(3);
    // a* over {a,b}: start state plus dead state.
    expect(minimalStateCount(regexToAutomaton('a*', AB), AB)).toBe(2);
    expect(minimalStateCount(regexToAutomaton('(a|b)*', AB), AB)).toBe(1);
  });
});

describe('drills', () => {
  const choice: Drill = { id: 'c', kind: 'choice', prompt: '?', options: ['x', 'y', 'z'], correct: [0, 2] };
  const dfa: Drill = {
    id: 'd',
    kind: 'automaton',
    prompt: 'DFA for words ending in ab',
    alphabet: AB,
    reference: { regex: '(a|b)*ab' },
    deterministic: true,
    minimal: true,
  };

  it('grades multiple choice, with partial credit for one slip', () => {
    expect(gradeDrill(choice, { kind: 'choice', picked: [2, 0] }).correct).toBe(true);
    const partly = gradeDrill(choice, { kind: 'choice', picked: [0] });
    expect([partly.correct, partly.score]).toEqual([false, 3]);
    expect(gradeDrill(choice, { kind: 'choice', picked: [1] }).score).toBe(1);
  });

  it('grades text and numbers leniently', () => {
    const input: Drill = { id: 'i', kind: 'input', prompt: '?', accept: ['{q0, q1}'] };
    expect(gradeDrill(input, { kind: 'input', text: ' {Q0,q1} ' }).correct).toBe(true);
    expect(normalize('A  =  b ( c )')).toBe('a=b(c)');
    const num: Drill = { id: 'n', kind: 'number', prompt: '?', answer: 0.5, tolerance: 0.01 };
    expect(gradeDrill(num, { kind: 'number', text: '0,505' }).correct).toBe(true);
    expect(gradeDrill(num, { kind: 'number', text: '0.6' }).correct).toBe(false);
    expect(parseNumber('1.000,5')).toBe(1000.5);
    expect(parseNumber('1,000.5')).toBe(1000.5);
    expect(parseNumber('abc')).toBeNull();
  });

  it('grades automata by language, determinism and size', () => {
    expect(gradeDrill(dfa, { kind: 'automaton', automaton: endsAb })).toMatchObject({ correct: true, score: 5 });
    const nfa = regexToAutomaton('(a|b)*ab', AB);
    expect(gradeDrill(dfa, { kind: 'automaton', automaton: nfa }).feedback).toMatch(/deterministic/);
    const wrong: Automaton = { ...endsAb, final: ['1'] };
    expect(gradeDrill(dfa, { kind: 'automaton', automaton: wrong }).feedback).toMatch(/"a" is accepted by your automaton but should not be/);
    // Same language, one redundant state.
    const big: Automaton = {
      states: [...endsAb.states, '3'],
      start: '0',
      final: ['2'],
      transitions: [...endsAb.transitions.filter(([f]) => f !== '2'), ['2', 'a', '3'], ['2', 'b', '0'], ['3', 'a', '1'], ['3', 'b', '2']],
    };
    expect(gradeDrill(dfa, { kind: 'automaton', automaton: big })).toMatchObject({ correct: false, score: 3 });
  });

  it('grades regular expressions by language', () => {
    const re: Drill = { id: 'r', kind: 'regex', prompt: '?', alphabet: AB, reference: { automaton: endsAb } };
    expect(gradeDrill(re, { kind: 'regex', text: '(a|b)*ab' }).correct).toBe(true);
    expect(gradeDrill(re, { kind: 'regex', text: 'b*a(a|b)*b' }).feedback).toMatch(/"abb" matches but should not/);
    expect(gradeDrill(re, { kind: 'regex', text: '(ab' }).feedback).toMatch(/Could not read/);
  });

  it('builds rounds and scores', () => {
    const drills: Drill[] = [
      { ...choice, id: 'e1', level: 'easy' },
      { ...choice, id: 'e2', level: 'easy' },
      { ...choice, id: 'x1', level: 'exam' },
    ];
    expect(pickRound(drills, 'easy', 5).map((d) => d.id).sort()).toEqual(['e1', 'e2']);
    expect(pickRound(drills, 'all', 2)).toHaveLength(2);
    expect(shuffledOrder(4)).not.toEqual([0, 1, 2, 3]);
    expect(roundScore([{ correct: true, score: 5, feedback: '' }, { correct: false, score: 1, feedback: '' }])).toBe(3);
  });
});

describe('prepared drills in the repo', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { drillProblems } = await import('../src/dojo/drills');
  const files = [
    ...readdirSync('packs/demo/dojos').map((f) => `packs/demo/dojos/${f}`),
    ...readdirSync('packs/dojo-library').filter((f) => f.endsWith('.json')).map((f) => `packs/dojo-library/${f}`),
  ];
  const all = new Map<string, Drill>();
  for (const f of files) {
    for (const d of (JSON.parse(readFileSync(f, 'utf8')).drills ?? []) as Drill[]) all.set(`${f.split('/').pop()!.replace('.json', '')}/${d.id}`, d);
  }
  const get = (key: string) => {
    const d = all.get(key);
    if (!d) throw new Error(`missing drill ${key}`);
    return d;
  };

  it('are all well-formed', () => {
    expect(all.size).toBeGreaterThan(40);
    for (const [key, d] of all) expect([key, drillProblems(d)]).toEqual([key, []]);
  });

  it('accept the answers their explanations give', () => {
    const re = (key: string, text: string) => gradeDrill(get(key), { kind: 'regex', text }).correct;
    expect(re('theo-dfa-regex/regex-even-a', 'b*(ab*ab*)*')).toBe(true);
    expect(re('theo-dfa-regex/regex-ends-ab', '(a|b)*ab')).toBe(true);
    expect(re('theo-dfa-regex/regex-no-bb', '(a|ba)*(b|ε)')).toBe(true);
    expect(re('theo-dfa-regex/regex-no-bb', '(a|ba)*')).toBe(false);
    expect(re('theo-regex-nfa/regex-even-length', '((a|b)(a|b))*')).toBe(true);

    const dfa = (key: string, a: Automaton) => gradeDrill(get(key), { kind: 'automaton', automaton: a });
    // Powerset construction of the "ends in ab" NFA.
    expect(
      dfa('theo-nfa-dfa/convert-ends-ab', {
        states: ['{q0}', '{q0,q1}', '{q0,q2}'],
        start: '{q0}',
        final: ['{q0,q2}'],
        transitions: [
          ['{q0}', 'a', '{q0,q1}'],
          ['{q0}', 'b', '{q0}'],
          ['{q0,q1}', 'a', '{q0,q1}'],
          ['{q0,q1}', 'b', '{q0,q2}'],
          ['{q0,q2}', 'a', '{q0,q1}'],
          ['{q0,q2}', 'b', '{q0}'],
        ],
      }).correct,
    ).toBe(true);
    // "Contains aa" as a 3-state DFA.
    expect(
      dfa('theo-nfa-dfa/convert-contains-aa', {
        states: ['A', 'B', 'C'],
        start: 'A',
        final: ['C'],
        transitions: [
          ['A', 'a', 'B'],
          ['A', 'b', 'A'],
          ['B', 'a', 'C'],
          ['B', 'b', 'A'],
          ['C', 'a', 'C'],
          ['C', 'b', 'C'],
        ],
      }).correct,
    ).toBe(true);
    // Minimal DFA for "ends in a": exactly two states.
    const two: Automaton = {
      states: ['N', 'F'],
      start: 'N',
      final: ['F'],
      transitions: [
        ['N', 'a', 'F'],
        ['N', 'b', 'N'],
        ['F', 'a', 'F'],
        ['F', 'b', 'N'],
      ],
    };
    expect(dfa('theo-minimize/minimize-ends-a', two).correct).toBe(true);
    expect(gradeDrill(get('theo-minimize/count-min'), { kind: 'number', text: '2' }).correct).toBe(true);
    expect(gradeDrill(get('net-fragmentation/length-last'), { kind: 'number', text: '1040' }).correct).toBe(true);
    expect(gradeDrill(get('theo-nfa-dfa/eps-closure'), { kind: 'input', text: '{q2, q0, q1}' }).correct).toBe(true);
  });
});

describe('AI-written drills', async () => {
  const { finalizeResponse } = await import('../src/ai/response');
  const req = { id: 'r1', kind: 'dojo.drills', createdAt: '2026-10-16T08:00:00Z', subject: 'theo', prompt: '…' } as const;
  const flat = {
    id: '',
    kind: 'choice',
    level: 'easy',
    topic: '',
    prompt: 'Q',
    explanation: '',
    options: [],
    correct: [],
    accept: [],
    answer: 0,
    tolerance: 0,
    unit: '',
    items: [],
    alphabet: [],
    referenceRegex: '',
    deterministic: false,
    minimal: false,
    solution: '',
  };

  it('keeps usable drills in the stored shape and skips broken ones', () => {
    const res = finalizeResponse(req, {
      drills: [
        { ...flat, id: 'Pick One', options: ['x', 'y'], correct: [1] },
        { ...flat, id: 're', kind: 'regex', alphabet: ['a', 'b'], referenceRegex: '(a|b)*abb' },
        { ...flat, id: 'broken', options: ['x', 'y'], correct: [5] },
      ],
    });
    expect(res.drills).toEqual([
      { id: 'pick-one', kind: 'choice', level: 'easy', prompt: 'Q', options: ['x', 'y'], correct: [1] },
      { id: 're', kind: 'regex', level: 'easy', prompt: 'Q', alphabet: ['a', 'b'], reference: { regex: '(a|b)*abb' } },
    ]);
    expect(res.summary).toMatch(/Skipped 1 broken exercise.*broken: correct index 5/);
  });

  it('fails when nothing is usable', () => {
    expect(() => finalizeResponse(req, { drills: [{ ...flat, id: 'x', options: ['a'], correct: [3] }] })).toThrow(/None of the exercises/);
  });
});
