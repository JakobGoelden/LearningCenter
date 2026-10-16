import { describe, expect, it } from 'vitest';
import { drillSymbols, symbolsFor, taskSymbols } from '../src/dojo/symbols';
import type { Dojo, Drill } from '../src/model/types';

const dojo: Dojo = { id: 'd', subject: 's', title: 'D', procedure: 'p', promptTemplate: 't' };

describe('formula symbols', () => {
  it('finds nothing in plain text', () => {
    expect(symbolsFor(['What is 3 + 4?'])).toEqual([]);
  });

  it('switches on a whole group from one trigger', () => {
    const s = symbolsFor(['Compute R ⋈ S']);
    expect(s).toEqual(expect.arrayContaining(['σ', 'π', 'ρ', '⋈', '∪']));
    expect(symbolsFor(['Is x ≤ 3?'])).toEqual(['≤', '≥', '≠', '≈', '≡']);
  });

  it('adds lone Greek letters, dojo extras and group names without duplicates', () => {
    expect(symbolsFor(['λ-calculus'])).toEqual(['λ']);
    expect(symbolsFor([''], [], ['numbers', 'ℝ', '∞'])).toEqual(['ℕ', 'ℤ', 'ℚ', 'ℝ', 'ℂ', '∞']);
  });

  it('offers AltGr characters only when the answer key uses them', () => {
    const d: Drill = { id: 'x', kind: 'input', prompt: '| a | b |\n|---|---|', accept: ['{q0,q1}'] };
    expect(drillSymbols(dojo, d)).toEqual(['{', '}']);
  });

  it('always offers ε and ∅ for regex drills and nothing for choice drills', () => {
    const r: Drill = { id: 'r', kind: 'regex', prompt: 'Words over a, b', alphabet: ['a', 'b'], reference: { regex: '(a|b)*' } };
    expect(drillSymbols(dojo, r).slice(0, 2)).toEqual(['ε', '∅']);
    const c: Drill = { id: 'c', kind: 'choice', prompt: 'x ∈ A?', options: ['yes', 'no'], correct: [0] };
    expect(drillSymbols(dojo, c)).toEqual([]);
  });

  it('uses the dojo symbols and task text for AI tasks', () => {
    expect(taskSymbols({ ...dojo, symbols: ['σ'] }, 'Show that x ∈ A')).toEqual(expect.arrayContaining(['σ', '∈', '∪']));
  });
});
