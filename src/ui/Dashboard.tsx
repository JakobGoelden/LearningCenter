import { useEffect, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { readEvents } from '../storage/repo';
import { formatShort, today } from '../lib/dates';
import { Calendar } from './Calendar';
import { SubjectBanner } from './SubjectBanner';
import { StudyCta } from './StudyView';
import { ChatStart } from './ChatStart';
import { pendingResults, type PendingResults as PendingResultsData } from '../model/sync';
import { syncPrompt } from '../ai/chat';

export function Dashboard() {
  const { loaded } = usePack();
  const on = today();
  return (
    <>
      {loaded.subjects.length > 0 && <StudyCta />}
      <PendingResults />
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

/**
 * Results the AI has not processed yet (since its last ai.sync), with a prompt
 * to copy. The AI appends ai.sync when done, and the banner goes away.
 */
function PendingResults() {
  const { fs, loaded } = usePack();
  const [p, setP] = useState<PendingResultsData | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      readEvents(fs, 5000)
        .then((events) => alive && setP(pendingResults(events)))
        .catch(() => alive && setP(null));
    void check();
    // The AI writes ai.sync while the app is open; look again now and then and when the tab comes back.
    const t = window.setInterval(check, 8000);
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener('focus', check);
    };
  }, [fs, loaded]);
  if (!p?.total) return null;
  const parts = [
    p.quizzes && `${p.quizzes} ${p.quizzes === 1 ? 'quiz' : 'quizzes'}`,
    p.dojo && `${p.dojo} dojo ${p.dojo === 1 ? 'round' : 'rounds'}`,
    p.sheets && `${p.sheets} ${p.sheets === 1 ? 'sheet' : 'sheets'}`,
    p.toGrade && `${p.toGrade} ${p.toGrade === 1 ? 'quiz' : 'quizzes'} to grade`,
  ].filter(Boolean) as string[];
  return (
    <div class="panel pending-results" role="status">
      <span class="pending-results-dot" aria-hidden="true" />
      <div class="pending-results-text">
        <strong>New results for your AI</strong>
        <span class="small">
          {parts.join(' · ')}
          {p.lastSync ? ` since its last look on ${formatShort(p.lastSync.slice(0, 10))}` : ''}. Copy the prompt into your AI chat: it grades what is open,
          updates your learning state and then hides this banner.
        </span>
      </div>
      <ChatStart label="Copy prompt" prompt={() => syncPrompt(fs)} />
    </div>
  );
}
