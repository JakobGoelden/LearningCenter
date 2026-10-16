// Formula symbols as buttons: hard-to-type characters a dojo task needs. They
// are found in the task text and the answer key, so an exercise with σ and ⋈
// gets a relational algebra keyboard and a plain number exercise gets none.

import type { Dojo, Drill } from '../model/types';

interface Group {
  name: string;
  symbols: string[];
  /** Characters that switch the whole group on; default: any of its symbols. */
  triggers?: string[];
}

/** Display order. A group appears as a whole once one of its triggers shows up. */
export const SYMBOL_GROUPS: Group[] = [
  { name: 'automata', symbols: ['ε', '∅', 'δ', 'Σ'], triggers: ['ε', 'δ'] },
  { name: 'sets', symbols: ['∈', '∉', '⊆', '⊂', '∪', '∩', '∖', '∅', '×', '℘'], triggers: ['∈', '∉', '⊆', '⊂', '∪', '∩', '∖', '℘'] },
  { name: 'numbers', symbols: ['ℕ', 'ℤ', 'ℚ', 'ℝ', 'ℂ'] },
  { name: 'logic', symbols: ['¬', '∧', '∨', '→', '↔', '⇒', '⇔', '∀', '∃', '⊕'], triggers: ['¬', '∧', '∨', '↔', '⇒', '⇔', '∀', '∃', '⊕'] },
  { name: 'relational-algebra', symbols: ['σ', 'π', 'ρ', '⋈', '⟕', '⟖', '⟗', '∪', '∩', '−', '×', '÷', 'γ'], triggers: ['⋈', '⟕', '⟖', '⟗'] },
  { name: 'compare', symbols: ['≤', '≥', '≠', '≈', '≡'] },
  { name: 'calculus', symbols: ['±', '·', '√', '∞', '∑', '∏', '∫', '∂', '∇', 'Δ'], triggers: ['±', '√', '∞', '∑', '∏', '∫', '∂', '∇'] },
  { name: 'powers', symbols: ['²', '³', 'ⁿ', '⁻', '¹', '₀', '₁', '₂'], triggers: ['²', '³', 'ⁿ', '⁻', '¹', '₀', '₁', '₂'] },
  { name: 'arrows', symbols: ['→', '←', '↦', '⇒'], triggers: ['←', '↦'] },
  { name: 'greek', symbols: ['α', 'β', 'γ', 'δ', 'ε', 'η', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ω', 'Δ', 'Σ', 'Ω'], triggers: [] },
  { name: 'brackets', symbols: ['⌈', '⌉', '⌊', '⌋', '⟨', '⟩'] },
];

/** Single Greek letters that show up on their own (μ in a unit, λ in a formula). */
const LONE = new Set(SYMBOL_GROUPS.find((g) => g.name === 'greek')!.symbols);
/** ASCII characters behind AltGr on many keyboards; offered when the answer key uses them. */
const ALTGR = ['{', '}', '[', ']', '|', '\\', '^', '~'];
const KIND_SYMBOLS: Partial<Record<Drill['kind'], string[]>> = { regex: ['ε', '∅', '|', '*'] };

/**
 * Buttons for a set of texts: whole groups whose triggers appear, lone Greek
 * letters, `extra` entries (characters or group names, from dojo.symbols) and,
 * from `answers`, AltGr characters the expected answer uses.
 */
export function symbolsFor(texts: string[], answers: string[] = [], extra: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  };
  for (const e of extra) {
    const g = SYMBOL_GROUPS.find((x) => x.name === e);
    if (g) g.symbols.forEach(add);
    else add(e);
  }
  const all = [...texts, ...answers].join('\n');
  for (const g of SYMBOL_GROUPS) if ((g.triggers ?? g.symbols).some((c) => all.includes(c))) g.symbols.forEach(add);
  for (const c of all) if (LONE.has(c)) add(c);
  const ans = answers.join('\n');
  for (const c of ALTGR) if (ans.includes(c)) add(c);
  return out;
}

/** The answer key of a drill as text, for spotting the characters it needs. */
function answerTexts(d: Drill): string[] {
  switch (d.kind) {
    case 'input':
      return d.accept;
    case 'number':
      return d.unit ? [d.unit] : [];
    case 'regex':
    case 'automaton':
      return d.reference.regex !== undefined ? [d.reference.regex] : d.reference.automaton!.states;
    case 'self':
      return [d.solution];
    default:
      return [];
  }
}

/** Buttons for one prepared drill. Choice and order drills need none. */
export function drillSymbols(dojo: Dojo, d: Drill): string[] {
  if (d.kind === 'choice' || d.kind === 'order') return [];
  const extra = [...(KIND_SYMBOLS[d.kind] ?? []), ...(d.kind === 'number' ? [] : (dojo.symbols ?? []))];
  // The prompt's Markdown tables use | as a separator, so only the answer key counts for AltGr characters.
  return symbolsFor([d.prompt], answerTexts(d), extra);
}

/** Buttons for a free AI task in a dojo: its own symbols plus what the task text uses. */
export function taskSymbols(dojo: Dojo, task: string): string[] {
  return symbolsFor([task, dojo.procedure, dojo.answerFormat ?? '', dojo.description ?? ''], [], dojo.symbols ?? []);
}
