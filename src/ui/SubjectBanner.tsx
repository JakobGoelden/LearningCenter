import { overview } from '../model/derive';
import type { ISODate, Subject } from '../model/types';
import { href } from './router';
import { StatusBar } from './StatusBar';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One compact banner per subject: progress bar plus what needs attention. Opens the subject page. */
export function SubjectBanner({ subject: s, on }: { subject: Subject; on: ISODate }) {
  const o = overview(s, on);
  const pct = Math.round(o.progress * 100);
  const learnable = o.statusCounts.new + o.statusCounts.shaky + o.statusCounts.solid;

  const flags: { text: string; urgent: boolean }[] = [];
  if (o.due.length) {
    flags.push({
      text: `${plural(o.due.length, 'review', 'reviews')} due${o.overdue.length ? ` (${o.overdue.length} overdue)` : ''}`,
      urgent: o.overdue.length > 0,
    });
  }
  if (o.openSheets.length) {
    const late = o.openSheets.filter((sh) => sh.due && sh.due < on).length;
    flags.push({
      text: `${plural(o.openSheets.length, 'open sheet', 'open sheets')}${late ? ` (${late} overdue)` : ''}`,
      urgent: late > 0,
    });
  }
  if (o.openItems) flags.push({ text: plural(o.openItems, 'open task', 'open tasks'), urgent: false });

  return (
    <a class="panel banner" href={href({ name: 'subject', subject: s.id })} style={{ '--c': s.color }}>
      <div class="banner-head">
        <h2>{s.name}</h2>
        <span class="muted small">
          {learnable ? `${pct}% solid · ${o.statusCounts.solid}/${learnable} topics` : 'no topics yet'}
        </span>
        <span class="chevron" aria-hidden="true">
          ›
        </span>
      </div>
      <StatusBar counts={o.statusCounts} />
      <div class="flags">
        {flags.length ? (
          flags.map((f) => <span class={`flag${f.urgent ? ' urgent' : ''}`}>{f.text}</span>)
        ) : (
          <span class="flag ok">All caught up</span>
        )}
      </div>
    </a>
  );
}
