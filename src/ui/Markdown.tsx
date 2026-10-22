import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { JSX } from 'preact';
import { parseAutomatonBlock } from '../dojo/automatonBlock';
import { AutomatonDiagram } from './AutomatonDiagram';
import { splitMath, splitScripts } from './math';

// Small, safe Markdown subset for AI output: paragraphs, headings, lists,
// fenced code, pipe tables, **bold**, *italic* and `code`. No raw HTML.
// A ```automaton block is drawn as a state diagram (see dojo/automatonBlock),
// LaTeX in $…$, $$…$$, \(…\) or \[…\] is rendered with KaTeX, and plain x_i,
// x^{2} become sub- and superscripts (see ./math).

function Tex({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex, { throwOnError: false, displayMode: display });
  return <span class={display ? 'tex tex-display' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />;
}

function scripts(text: string): (string | JSX.Element)[] {
  return splitScripts(text).map((p) => (p.kind === 'sub' ? <sub>{p.text}</sub> : p.kind === 'sup' ? <sup>{p.text}</sup> : p.text));
}

function emphasis(text: string): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(...scripts(text.slice(last, m.index)));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong>{scripts(t.slice(2, -2))}</strong>);
    else out.push(<em>{scripts(t.slice(1, -1))}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(...scripts(text.slice(last)));
  return out;
}

function inline(text: string): (string | JSX.Element)[] {
  // Code spans first: nothing inside them is touched.
  return text.split(/(`[^`]+`)/).flatMap((part, k) =>
    k % 2
      ? [<code>{part.slice(1, -1)}</code>]
      : splitMath(part).flatMap((p) => (p.kind === 'tex' ? [<Tex tex={p.tex} display={p.display} />] : emphasis(p.text))),
  );
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\$\$/.test(line)) {
      // Display formula over one or more lines: $$ … $$
      const body: string[] = [line.trim().slice(2)];
      let j = i;
      while (!body[body.length - 1].trimEnd().endsWith('$$') && ++j < lines.length) body.push(lines[j]);
      const tex = body.join('\n').trimEnd();
      if (tex.endsWith('$$') && tex.length > 2) {
        blocks.push(<div class="tex-block"><Tex tex={tex.slice(0, -2)} display /></div>);
        i = j + 1;
        continue;
      }
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      const block = lang === 'automaton' ? parseAutomatonBlock(body.join('\n')) : null;
      if (block && 'automaton' in block) blocks.push(<AutomatonDiagram automaton={block.automaton} label="Automaton" />);
      else if (block) {
        blocks.push(<pre>{body.join('\n')}</pre>);
        blocks.push(<p class="muted small">Cannot draw this automaton: {block.error}</p>);
      }
      else blocks.push(<pre>{body.join('\n')}</pre>);
    } else if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      blocks.push(
        <div class="table-wrap">
          <table>
            <thead>
              <tr>{head.map((h) => <th>{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr>{r.map((c) => <td>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<p><strong>{inline(line.replace(/^#+\s/, ''))}</strong></p>);
      i++;
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ''));
      const lis = items.map((t) => <li>{inline(t)}</li>);
      blocks.push(ordered ? <ol>{lis}</ol> : <ul>{lis}</ul>);
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i]);
      if (!para.length) para.push(lines[i++]);
      blocks.push(
        <p>
          {para.flatMap((p, k) => (k ? [<br />, ...inline(p)] : inline(p)))}
        </p>,
      );
    }
  }
  return <div class="md">{blocks}</div>;
}
