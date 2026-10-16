import { usePack } from '../state/context';
import { today } from '../lib/dates';
import { Calendar } from './Calendar';
import { SubjectBanner } from './SubjectBanner';

export function Dashboard() {
  const { loaded } = usePack();
  const on = today();
  return (
    <>
      <Calendar loaded={loaded} today={on} />
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
