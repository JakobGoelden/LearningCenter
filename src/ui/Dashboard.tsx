import { usePack } from '../state/context';
import { todayItems, type TodayItem } from '../model/derive';
import { today } from '../lib/dates';
import { href, type Route } from './router';
import { SubjectBanner } from './SubjectBanner';

function targetOf(item: TodayItem): Route {
  if (item.kind === 'reviews') return { name: 'quiz', subject: item.subject.id };
  return { name: 'subject', subject: item.subject.id };
}

export function Dashboard() {
  const { loaded } = usePack();
  const on = today();
  const items = todayItems(loaded, on);
  return (
    <>
      <div class="panel today" aria-label="Today">
        <span class="label">Today</span>
        {items.length === 0 && <span class="muted">Nothing due today.</span>}
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
          This pack has no subjects yet. Add files under <code>subjects/</code> and list their ids in{' '}
          <code>pack.json</code>, or let an AI do it (see ONBOARDING.md).
        </div>
      ) : (
        <div class="banners">
          {loaded.subjects.map((s) => (
            <SubjectBanner key={s.id} subject={s} on={on} dojos={loaded.dojos.filter((d) => d.subject === s.id)} />
          ))}
        </div>
      )}
    </>
  );
}
