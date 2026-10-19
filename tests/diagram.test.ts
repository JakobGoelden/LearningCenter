import { describe, expect, it } from 'vitest';
import type { Automaton } from '../src/dojo/automata';
import { freestAngle, layoutAutomaton } from '../src/dojo/diagram';

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

const node = (d: ReturnType<typeof layoutAutomaton>, id: string) => d.nodes.find((n) => n.id === id)!;

describe('layoutAutomaton', () => {
  it('puts states in columns by distance from the start state', () => {
    const d = layoutAutomaton(endsAb);
    expect(node(d, '0').x).toBeLessThan(node(d, '1').x);
    expect(node(d, '1').x).toBeLessThan(node(d, '2').x);
    expect(node(d, '0').start).toBe(true);
    expect(node(d, '2').final).toBe(true);
    expect(d.startArrow!.x2).toBeCloseTo(node(d, '0').x - node(d, '0').r);
  });

  it('draws one arrow per pair of states with all its symbols', () => {
    const a: Automaton = { states: ['p', 'q'], start: 'p', final: [], transitions: [['p', 'a', 'q'], ['p', 'b', 'q'], ['p', 'a', 'q']] };
    const d = layoutAutomaton(a);
    expect(d.edges).toHaveLength(1);
    expect(d.edges[0].label).toBe('a, b');
  });

  it('bends arrows in both directions apart and keeps a single one straight', () => {
    const d = layoutAutomaton(endsAb);
    const edge = (from: string, to: string) => d.edges.find((e) => e.from === from && e.to === to)!;
    expect(edge('0', '1').path).toMatch(/^M[\d.,-]+ L/);
    expect(edge('1', '2').path).toContain('Q');
    expect(edge('2', '1').path).toContain('Q');
  });

  it('bends around a state in the way', () => {
    // 0 → 1 → 2 in one row, plus 2 → 0 straight through 1.
    const a: Automaton = { states: ['0', '1', '2'], start: '0', final: [], transitions: [['0', 'a', '1'], ['1', 'a', '2'], ['2', 'b', '0']] };
    const d = layoutAutomaton(a);
    expect(d.edges.find((e) => e.from === '2')!.path).toContain('Q');
  });

  it('keeps everything inside the picture', () => {
    const d = layoutAutomaton(endsAb);
    for (const n of d.nodes) {
      expect(n.x - n.r).toBeGreaterThanOrEqual(0);
      expect(n.y - n.r).toBeGreaterThanOrEqual(0);
      expect(n.x + n.r).toBeLessThanOrEqual(d.width);
      expect(n.y + n.r).toBeLessThanOrEqual(d.height);
    }
    for (const e of d.edges) {
      for (const [, x, y] of e.path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
        expect(Number(x)).toBeGreaterThanOrEqual(0);
        expect(Number(y)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(d.startArrow!.x1).toBeGreaterThanOrEqual(0);
  });

  it('copes with half-typed input', () => {
    const a: Automaton = { states: ['q0', '', 'q0'], start: 'q0', final: [], transitions: [['q0', 'a', 'q9'], ['', 'b', 'q0']] };
    const d = layoutAutomaton(a);
    expect(d.nodes.map((n) => [n.id, n.known])).toEqual([
      ['q0', true],
      ['q9', false],
    ]);
    expect(d.edges).toHaveLength(1);
    expect(layoutAutomaton({ states: [], start: '', final: [], transitions: [] }).nodes).toEqual([]);
  });

  it('shows ε for every spelling of it', () => {
    const a: Automaton = { states: ['0', '1'], start: '0', final: ['1'], transitions: [['0', 'eps', '1'], ['0', '', '1']] };
    expect(layoutAutomaton(a).edges[0].label).toBe('ε');
  });

  it('shrinks the font for long state names', () => {
    const a: Automaton = { states: ['{q0,q1,q2}', 'q0'], start: 'q0', final: [], transitions: [] };
    const d = layoutAutomaton(a);
    expect(node(d, '{q0,q1,q2}').font).toBeLessThan(node(d, 'q0').font);
  });
});

describe('freestAngle', () => {
  it('points up when nothing else leaves the state', () => {
    expect(freestAngle([])).toBeCloseTo(-Math.PI / 2);
  });

  it('avoids the directions that are taken', () => {
    // Lines leave up and to the right: the loop goes down-left.
    const a = freestAngle([-Math.PI / 2, 0]);
    expect(Math.cos(a)).toBeLessThan(0);
    expect(Math.sin(a)).toBeGreaterThan(0);
  });
});
