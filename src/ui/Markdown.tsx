import type { JSX } from 'preact';
import { parseAutomatonBlock } from '../dojo/automatonBlock';
import { AutomatonDiagram } from './AutomatonDiagram';

// Small, safe Markdown subset for AI output: paragraphs, headings, lists,
// fenced code, pipe tables, **bold**, *italic* and `code`. No raw HTML.
// A ```automaton block is drawn as a state diagram (see dojo/automatonBlock).

function inline(text: string): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong>{t.slice(2, -2)}</strong>);
    else out.push(<em>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
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
