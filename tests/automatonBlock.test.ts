import { describe, expect, it } from 'vitest';
import { automatonBlockProblems, parseAutomatonBlock } from '../src/dojo/automatonBlock';

describe('parseAutomatonBlock', () => {
  it('reads the text format with arrows, symbol lists and ε', () => {
    const r = parseAutomatonBlock('# ends with ab\nstart: q0\nfinal: q2\nq0 -a,b-> q0\nq0 -a-> q1\nq1 --b--> q2\nq2 eps q0');
    expect(r).toEqual({
      automaton: {
        states: ['q0', 'q1', 'q2'],
        start: 'q0',
        final: ['q2'],
        transitions: [
          ['q0', 'a', 'q0'],
          ['q0', 'b', 'q0'],
          ['q0', 'a', 'q1'],
          ['q1', 'b', 'q2'],
          ['q2', 'ε', 'q0'],
        ],
      },
    });
  });

  it('keeps explicit states and a final state without transitions', () => {
    const r = parseAutomatonBlock('states: s, t, u\nstart: s\nfinal: u\ns a t');
    expect('automaton' in r && r.automaton.states).toEqual(['s', 't', 'u']);
    const r2 = parseAutomatonBlock('start: s\nfinal: s, x\ns a s');
    expect('automaton' in r2 && r2.automaton.states).toEqual(['s', 'x']);
  });

  it('reads the JSON format of drill files', () => {
    const r = parseAutomatonBlock('{"start": "0", "final": ["1"], "transitions": [["0", "a", "1"]]}');
    expect('automaton' in r && r.automaton.states).toEqual(['0', '1']);
  });

  it('reports what is wrong', () => {
    expect(parseAutomatonBlock('q0 -a-> q1')).toEqual({ error: expect.stringContaining('start') });
    expect(parseAutomatonBlock('start: q0\nq0 goes to q1 now')).toEqual({ error: expect.stringContaining('Cannot read') });
    expect(parseAutomatonBlock('states: q0\nstart: q0\nq0 a q1')).toEqual({ error: expect.stringContaining('q1') });
  });
});

describe('automatonBlockProblems', () => {
  it('checks only automaton blocks', () => {
    const md = 'Text\n\n```automaton\nstart: a\na x b\n```\n\n```\nnot an automaton\n```\n\n```automaton\nb x c\n```';
    expect(automatonBlockProblems(md)).toHaveLength(1);
  });
});
