import { usePack } from '../state/context';
import { todayItems } from '../model/derive';
import { today } from '../lib/dates';
import { href, type Route } from './router';
import { SubjectTile } from './SubjectTile';
import type { TodayItem } from '../model/derive';

function targetOf(item: TodayItem): Route {
  if (item.kind === 'reviews') return { name: 'quiz', subject: item.subject.id };
  return { name: 'topics', subject: item.subject.id };
}

export function Dashboard() {
  const { loaded } = usePack();
  const on = today();
  const items = todayItems(loaded, on);
  return (
    <>
      <div class="panel today" aria-label="Heute dran">
        <span class="label">Heute dran</span>
        {items.length === 0 && <span class="muted">Heute ist nichts fällig.</span>}
        {items.map((i) => (
          <a class={`today-item${i.urgent ? ' urgent' : ''}`} href={href(targetOf(i))}>
            <span class="tag" style={{ '--c': i.subject.color }}>
              {i.subject.short ?? i.subject.name}
            </span>
            {i.text}
          </a>
        ))}
      </div>
      {loaded.subjects.length === 0 ? (
        <div class="panel muted">
          Dieses Pack hat noch keine Fächer. Lege Dateien unter <code>subjects/</code> an und trage ihre IDs in{' '}
          <code>pack.json</code> ein, oder lass das eine KI machen (siehe CLAUDE.md).
        </div>
      ) : (
        <div class="grid">
          {loaded.subjects.map((s) => (
            <SubjectTile key={s.id} subject={s} on={on} />
          ))}
        </div>
      )}
    </>
  );
}
