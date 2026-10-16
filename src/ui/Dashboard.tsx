import { useEffect, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { readEvents } from '../storage/repo';
import { today } from '../lib/dates';
import { Calendar } from './Calendar';
import { SubjectBanner } from './SubjectBanner';
import { StudyCta } from './StudyView';

export function Dashboard() {
  const { loaded } = usePack();
  const on = today();
  return (
    <>
      {loaded.subjects.length > 0 && <StudyCta />}
      <PendingGrades />
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

/** Quizzes saved with "Let the AI grade later" that the AI has not graded yet. */
function PendingGrades() {
  const { fs, loaded } = usePack();
  const [open, setOpen] = useState(0);
  useEffect(() => {
    readEvents(fs, 2000)
      .then((events) => {
        const pending = new Set<string>();
        for (const e of events) {
          if (!e.ref) continue;
          if (e.type === 'quiz.gradeLater') pending.add(e.ref);
          if (e.type === 'quiz.applied') pending.delete(e.ref);
        }
        setOpen(pending.size);
      })
      .catch(() => setOpen(0));
  }, [fs, loaded]);
  if (!open) return null;
  return (
    <div class="panel pending-grades">
      <strong>
        {open} {open === 1 ? 'quiz is' : 'quizzes are'} waiting for grading.
      </strong>{' '}
      <span class="muted">
        Tell your AI <em>"Grade my open quizzes"</em>. It grades your answers and updates your progress.
      </span>
    </div>
  );
}
