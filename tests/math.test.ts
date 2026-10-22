import { describe, expect, it } from 'vitest';
import { splitMath, splitScripts } from '../src/ui/math';

const tex = (text: string) => splitMath(text).filter((p) => p.kind === 'tex');

describe('splitMath', () => {
  it('finds LaTeX in all four delimiters', () => {
    expect(splitMath('Projektion $\\pi_{a,b}(R)$ ist')).toEqual([
      { kind: 'text', text: 'Projektion ' },
      { kind: 'tex', tex: '\\pi_{a,b}(R)', display: false },
      { kind: 'text', text: ' ist' },
    ]);
    expect(tex('$$\\sum_{i=1}^n i$$')).toEqual([{ kind: 'tex', tex: '\\sum_{i=1}^n i', display: true }]);
    expect(tex('a \\(x^2\\) b \\[y\\]')).toEqual([
      { kind: 'tex', tex: 'x^2', display: false },
      { kind: 'tex', tex: 'y', display: true },
    ]);
    expect(tex('$2^n$ und $x$.')).toHaveLength(2);
  });

  it('leaves literal dollars alone', () => {
    for (const text of [
      'Was matchen ^ und $, und was ändert re.MULTILINE? Was findet ^.+$ mit MULTILINE?',
      "text = 'Here is 1$, here are 21 EUR, and there are 42 $.'",
      'Für Zahlen ohne folgendes $ benutzt das Skript [0-9]+(?![0-9]*\\s*\\$).',
      "- s3 + s6 = {c → 'x' • c : {'x','y','$'}, c → • 'x' c : {'x','y','$'}}",
      '- (ŝ → s • $) ∈ M → action(M, $) = accept',
      'Token $ und Regel ŝ → s $',
      'kostet $20 und $30',
    ]) {
      expect(tex(text), text).toEqual([]);
    }
  });
});

describe('splitScripts', () => {
  const render = (text: string) => splitScripts(text).map((p) => (p.kind === 'text' ? p.text : `<${p.kind}>${p.text}</${p.kind}>`)).join('');

  it('sets the notation cards already use', () => {
    expect(render('π_{a,b}(R)')).toBe('π<sub>a,b</sub>(R)');
    expect(render("π_lname(σ_ort='BONN'(P))")).toBe("π<sub>lname</sub>(σ<sub>ort='BONN'</sub>(P))");
    expect(render('Σ_ASCII')).toBe('Σ<sub>ASCII</sub>');
    expect(render('f_xxx und L_power')).toBe('f<sub>xxx</sub> und L<sub>power</sub>');
    expect(render('L_u und Σ^* und 2^Q, a_m.')).toBe('L<sub>u</sub> und Σ<sup>*</sup> und 2<sup>Q</sup>, a<sub>m</sub>.');
    expect(render('r^{(k)}(p_1, p_2)')).toBe('r<sup>(k)</sup>(p<sub>1</sub>, p<sub>2</sub>)');
  });

  it('keeps identifiers and lone carets as they are', () => {
    for (const text of ['CURRENT_DATE', 'chk_stunden', 'ltp_lnr_fkey', 'Was matchen ^ und $', '^.+$', 'a ^ b', '%ignore C_COMMENT', '@v_args(inline=True)', 'tree.x_y', 'Transformer mit v_args']) {
      expect(render(text)).toBe(text);
    }
    expect(render("f_x'")).toBe("f<sub>x</sub>'");
  });
});
