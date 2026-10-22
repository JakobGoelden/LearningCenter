import { overview } from '../model/derive';
import { diffDays, formatShort } from '../lib/dates';
import type { Dojo, ISODate, Subject } from '../model/types';
import { href } from './router';
import { StatusBar } from './StatusBar';
import { Torii } from './Emblem';

/** "today", "yesterday", "3 days ago", then a short date. */
function ago(date: ISODate, on: ISODate): string {
  const d = diffDays(date, on);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return `on ${formatShort(date)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One compact banner per subject: progress bar plus what needs attention. Opens the subject page.
 * Subjects with dojos get a Dojo button next to it (straight into the dojo when there is only one).
 */
export function SubjectBanner({
  subject: s,
  on,
  dojos = [],
  lastContent,
}: {
  subject: Subject;
  on: ISODate;
  dojos?: Dojo[];
  /** Time new content (topics, questions, sheets, material, drills) last arrived. */
  lastContent?: string;
}) {
  const o = overview(s, on);
  const pct = Math.round(o.progress * 100);
  const learnable = o.statusCounts.new + o.statusCounts.shaky + o.statusCounts.solid;

  const flags: { text: string; urgent: boolean }[] = [];
  if (o.dueCards) {
    flags.push({
      text: `${plural(o.dueCards, 'card', 'cards')} due${o.overdueCards ? ` (${o.overdueCards} overdue)` : ''}`,
      urgent: o.overdueCards > 0,
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

  const banner = (
    <a class="panel banner" href={href({ name: 'subject', subject: s.id })} style={{ '--c': s.color }}>
      <span class="banner-mark" aria-hidden="true">
        {s.short ?? s.name}
      </span>
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
        <span class="flag content" title="When new topics, questions, sheets, material or exercises last arrived">
          {lastContent ? `New content ${ago(lastContent.slice(0, 10), on)}` : 'No new content yet'}
        </span>
      </div>
    </a>
  );
  if (!dojos.length) return banner;
  const only = dojos.length === 1 ? dojos[0] : undefined;
  return (
    <div class="banner-row">
      {banner}
      <a
        class="panel dojo-tile"
        href={href({ name: 'dojo', subject: s.id, dojo: only?.id })}
        style={{ '--c': s.color }}
        title={dojos.map((d) => d.title).join(', ')}
        aria-label={`Dojo for ${s.name}: ${only ? only.title : `${dojos.length} dojos`}`}
      >
        <span class="dojo-kanji" aria-hidden="true">
          道場
        </span>
        <Torii class="dojo-torii" />
        <strong>Dojo</strong>
        <span class="dojo-sub">{only ? only.title : `${dojos.length} dojos`}</span>
      </a>
    </div>
  );
}
