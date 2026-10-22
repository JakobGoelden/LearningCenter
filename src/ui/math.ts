// Formulas in Markdown text. Two kinds:
//
// - LaTeX between $…$, $$…$$, \(…\) or \[…\], rendered with KaTeX. A single
//   $ only opens a formula when it is not glued to a word or quote before it
//   and not followed by a space or punctuation, and only closes when glued to
//   the formula and not to a word after it. That keeps literal dollars apart
//   (regex anchors, the end token $ in parser cards, '$', 42 $).
// - Plain notation that cards already use without delimiters: x_{ij}, x^{2},
//   π_{a,b}, σ_ort='BONN', L_u, 2^Q. These become sub- and superscripts.

export type MathPart = { kind: 'text'; text: string } | { kind: 'tex'; tex: string; display: boolean };

const TEX = /\$\$([^$]+?)\$\$|\\\((.+?)\\\)|\\\[(.+?)\\\]|(?<![\p{L}\p{N}'"`\\$])\$(?=[^\s$,.;:!?)\]}])([^$\n]*?[^\s$\\])\$(?![\p{L}\p{N}'"$])/gu;

/** Splits a text into plain parts and LaTeX formulas. */
export function splitMath(text: string): MathPart[] {
  const out: MathPart[] = [];
  let last = 0;
  TEX.lastIndex = 0;
  for (let m = TEX.exec(text); m; m = TEX.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    const tex = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
    out.push({ kind: 'tex', tex, display: m[1] !== undefined || m[3] !== undefined });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export type ScriptPart = { kind: 'text' | 'sub' | 'sup'; text: string };

// Base: one letter, digit, ) or } that does not continue a word, name or
// decorator (so snake_case, CURRENT_DATE and @v_args stay as they are).
// Script: {…}, or a run of letters, digits and ' = * + − (a trailing ' only
// when it closes a quote inside the script). A Latin letter followed by a
// word (C_COMMENT, v_args) is a name, not a subscript; f_xxx and L_power
// still are.
const SCRIPT = /(?<![\p{L}\p{N}_@.])([\p{L}\p{N})}])([_^])(?:\{([^{}\n]+)\}|([\p{L}\p{N}*+−'=]+))/gu;

/** Splits plain text into text, subscripts and superscripts. */
export function splitScripts(text: string): ScriptPart[] {
  const out: ScriptPart[] = [];
  let last = 0;
  SCRIPT.lastIndex = 0;
  for (let m = SCRIPT.exec(text); m; m = SCRIPT.exec(text)) {
    let script = m[3] ?? m[4];
    let end = m.index + m[0].length;
    // A quote that is not closed inside the script belongs to the text: f_x' stays f_x + '.
    if (m[4] && (script.match(/'/g)?.length ?? 0) % 2 === 1 && script.endsWith("'")) {
      script = script.slice(0, -1);
      end--;
    }
    const name = m[4] && ((/^[A-Za-z]$/.test(m[1]) && /^[A-Z]{3,}$/.test(script)) || (/^[a-z]$/.test(m[1]) && /^[a-z]{4,}$/.test(script)));
    if (!script || name) continue;
    out.push({ kind: 'text', text: text.slice(last, m.index) + m[1] });
    out.push({ kind: m[2] === '_' ? 'sub' : 'sup', text: script });
    last = end;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.filter((p) => p.text);
}
