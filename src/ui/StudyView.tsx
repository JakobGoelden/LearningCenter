import { useMemo, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { diffDays, today } from '../lib/dates';
import { mastery, studyPlan, type StudyBlock } from '../scheduling/scheduler';
import type { ISODate, Topic } from '../model/types';
import { QuizView } from './QuizView';
import { href, navigate } from './router';

/** Why a topic made it into today's study round, as short chips. */
function reasons(t: Topic, on: ISODate, exam?: ISODate): string[] {
  const out: string[] = [];
  if (t.due && t.due < on) out.push(`overdue ${diffDays(t.due, on)} d`);
  else if (t.due === on) out.push('due today');
  else if (t.status === 'new') out.push('new');
  else if (t.status === 'shaky') out.push('shaky');
  if (t.history?.length && mastery(t) < 0.6) out.push('weak');
  if (exam && exam >= on && diffDays(on, exam) <= 21) out.push(`exam in ${diffDays(on, exam)} d`);
  return out;
}

/**
 * One button, no decisions: the most pressing topics across all subjects,
 * quizzed subject by subject.
 */
export function StudyView() {
  const { loaded } = usePack();
  const on = today();
  const [count, setCount] = useState(loaded.pack.settings?.questionsPerQuiz ?? 5);
  // The plan is fixed once the round starts, so saving progress does not reshuffle it.
  const [plan, setPlan] = useState<StudyBlock[] | null>(null);
  const [step, setStep] = useState(0);
  const preview = useMemo(() => studyPlan(loaded.subjects, on, count), [loaded, on, count]);

  if (plan) {
    const block = plan[step];
    if (!block) {
      return (
        <div class="panel stack study-done">
          <div class="study-done-mark" aria-hidden="true">
            ✓
          </div>
          <h2>Round complete</h2>
          <p class="muted">Everything from this round is saved. Come back when the next reviews are due.</p>
          <div class="row">
            <a class="btn primary" href={href({ name: 'dashboard' })}>
              Back to dashboard
            </a>
            <button
              onClick={() => {
                setPlan(null);
                setStep(0);
              }}
            >
              Another round
            </button>
          </div>
        </div>
      );
    }
    const following = plan[step + 1];
    return (
      <QuizView
        key={step}
        subjectId={block.subject.id}
        topics={block.topics.map((t) => t.id)}
        head={
          <div class="page-head subject-head" style={{ '--c': block.subject.color }}>
            <a href={href({ name: 'dashboard' })}>← Dashboard</a>
            <h1>Study: {block.subject.name}</h1>
            {plan.length > 1 && (
              <span class="badge">
                Part {step + 1} of {plan.length}
              </span>
            )}
          </div>
        }
        next={{
          label: following ? `Continue with ${following.subject.name} →` : 'Finish round',
          go: () => setStep(step + 1),
        }}
      />
    );
  }

  const total = preview.reduce((n, b) => n + b.topics.length, 0);
  return (
    <div class="stack">
      <div class="page-head subject-head">
        <a href={href({ name: 'dashboard' })}>← Dashboard</a>
        <h1>Study</h1>
      </div>
      {total === 0 ? (
        <div class="panel stack">
          <strong>Nothing to study right now.</strong>
          <span class="muted">No reviews are due and there are no new or shaky topics. Enjoy the break.</span>
        </div>
      ) : (
        <div class="panel stack study-plan">
          <div class="row">
            <span class="muted">Picked for you: due topics first, weak ones and upcoming exams weigh more.</span>
            <span class="spacer" style="flex:1" />
            <label class="row small">
              Questions
              <input
                type="number"
                min={1}
                max={30}
                value={count}
                style="width:64px"
                onInput={(e) => setCount(Math.max(1, Math.min(30, Number(e.currentTarget.value) || 1)))}
              />
            </label>
          </div>
          {preview.map((b) => (
            <div class="study-block" style={{ '--c': b.subject.color }}>
              <h3>{b.subject.name}</h3>
              <ul class="list">
                {b.topics.map((t) => (
                  <li>
                    <span class="grow">{t.title}</span>
                    <span class="chips">
                      {reasons(t, on, b.subject.exam.date).map((r) => (
                        <span class={`chip${r.startsWith('overdue') || r === 'weak' ? ' hot' : ''}`}>{r}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <button
              class="primary study-go"
              onClick={() => {
                setPlan(preview);
                setStep(0);
              }}
            >
              Start studying · {total} {total === 1 ? 'question' : 'questions'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dashboard call to action: how much is waiting, one click to start. */
export function StudyCta() {
  const { loaded } = usePack();
  const on = today();
  const plan = useMemo(() => studyPlan(loaded.subjects, on, loaded.pack.settings?.questionsPerQuiz ?? 5), [loaded, on]);
  const due = loaded.subjects.reduce((n, s) => n + s.topics.filter((t) => t.status !== 'skip' && t.due && t.due <= on).length, 0);
  const first = plan[0];
  return (
    <button class={`study-cta${plan.length ? '' : ' calm'}`} onClick={() => navigate({ name: 'study' })}>
      <span class="study-cta-play" aria-hidden="true">
        ▶
      </span>
      <span class="study-cta-text">
        <strong>Study</strong>
        <span class="small">
          {plan.length
            ? `${due ? `${due} ${due === 1 ? 'review' : 'reviews'} due` : 'Nothing due, new and shaky topics waiting'}${first ? ` · ${first.subject.name} first` : ''}`
            : 'All caught up'}
        </span>
      </span>
    </button>
  );
}
