import { useMemo, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { diffDays, today } from '../lib/dates';
import { cardDue, cardMastery, dueCount, newCards, studyCandidates, studyCount, studyPlan, type StudyBlock } from '../scheduling/scheduler';
import { cardKey, cardLine, type Card } from '../scheduling/cards';
import type { ISODate } from '../model/types';
import { QuizView } from './QuizView';
import { href, navigate } from './router';
import { Stepper } from './Stepper';
import { ChatStart } from './ChatStart';
import { quizChatPrompt } from '../ai/chat';
import { BackLink } from './BackLink';

/** Why a card made it into today's study round, as short chips. */
function reasons(c: Card, on: ISODate, exam?: ISODate): string[] {
  const out: string[] = [];
  const due = cardDue(c.topic, c.question);
  if (!due) out.push('new');
  else if (due < on) out.push(`overdue ${diffDays(due, on)} d`);
  else if (due === on) out.push('due today');
  else out.push('ahead');
  if (c.question.stats?.recent.length && cardMastery(c) < 0.6) out.push('weak');
  if (exam && exam >= on && diffDays(on, exam) <= 21) out.push(`exam in ${diffDays(on, exam)} d`);
  return out;
}

/**
 * One button, no decisions: the most pressing topics across all subjects,
 * quizzed subject by subject.
 */
export function StudyView() {
  const { fs, loaded } = usePack();
  const on = today();
  const settings = loaded.pack.settings;
  const due = dueCount(loaded.subjects, on) + newCards(loaded.subjects, on, settings).length;
  const most = Math.max(1, studyCandidates(loaded.subjects, on, settings));
  // Everything due plus today's new cards by default; the stepper only matters when you want less (or more).
  const [count, setCount] = useState(Math.min(most, studyCount(loaded.subjects, on, settings?.questionsPerQuiz ?? 5, settings)));
  // The plan is fixed once the round starts, so saving progress does not reshuffle it.
  const [plan, setPlan] = useState<StudyBlock[] | null>(null);
  const [step, setStep] = useState(0);
  const preview = useMemo(() => studyPlan(loaded.subjects, on, count, settings), [loaded, on, count]);

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
        cards={block.cards.map(cardKey)}
        head={
          <div class="page-head subject-head" style={{ '--c': block.subject.color }}>
            <BackLink href={href({ name: 'dashboard' })} label="Dashboard" />
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

  const total = preview.reduce((n, b) => n + b.cards.length, 0);
  return (
    <div class="stack">
      <div class="page-head subject-head">
        <BackLink href={href({ name: 'dashboard' })} label="Dashboard" />
        <h1>Study</h1>
      </div>
      {total === 0 ? (
        <div class="panel stack">
          <strong>Nothing to study right now.</strong>
          <span class="muted">No cards are due and today's new cards are done. Enjoy the break.</span>
        </div>
      ) : (
        <div class="panel stack study-plan">
          <div class="row">
            <span class="muted">
              {due && count >= due
                ? `Everything that is due and today's new cards${count > due ? ', plus cards ahead of their date' : ''}. Weak cards and upcoming exams come first.`
                : 'Picked for you: due cards first, weak ones and upcoming exams weigh more.'}
            </span>
            <span class="spacer" style="flex:1" />
            <span class="small">Cards</span>
            <Stepper value={count} onChange={setCount} min={1} max={Math.max(most, 1)} label="Cards" />
            {due > 0 && count !== due && (
              <button class="small all-due" onClick={() => setCount(due)}>
                All for today ({due})
              </button>
            )}
          </div>
          {preview.map((b) => (
            <div class="study-block" style={{ '--c': b.subject.color }}>
              <h3>{b.subject.name}</h3>
              <ul class="list">
                {b.cards.map((c) => (
                  <li>
                    <span class="grow stack" style="gap:0">
                      <span class="small muted">{c.topic.title}</span>
                      <span class="card-line">{cardLine(c)}</span>
                    </span>
                    <span class="chips">
                      {reasons(c, on, b.subject.exam.date).map((r) => (
                        <span class={`chip${r.startsWith('overdue') || r === 'weak' ? ' hot' : ''}`}>{r}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div class="start-row">
            <button
              class="primary study-go"
              onClick={() => {
                setPlan(preview);
                setStep(0);
              }}
            >
              Start here · {total} {total === 1 ? 'card' : 'cards'}
            </button>
            <ChatStart prompt={() => quizChatPrompt({ fs, pack: loaded.pack, blocks: preview })} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Dashboard call to action: how much is waiting, one click to start. */
export function StudyCta() {
  const { fs, loaded } = usePack();
  const on = today();
  const settings = loaded.pack.settings;
  const due = useMemo(() => dueCount(loaded.subjects, on), [loaded, on]);
  const fresh = useMemo(() => newCards(loaded.subjects, on, settings).length, [loaded, on]);
  // Only what today asks for: no round is offered once due and new cards are done.
  const plan = useMemo(() => (due + fresh ? studyPlan(loaded.subjects, on, due + fresh, settings) : []), [loaded, on, due, fresh]);
  const first = plan[0];
  return (
    <div class={`study-cta${plan.length ? '' : ' calm'}`}>
      <button class="study-cta-main" onClick={() => navigate({ name: 'study' })}>
        <span class="study-cta-play" aria-hidden="true">
          ▶
        </span>
        <span class="study-cta-text">
          <strong>Study</strong>
          <span class="small">
            {plan.length
              ? `${[due && `${due} ${due === 1 ? 'card' : 'cards'} due`, fresh && `${fresh} new`].filter(Boolean).join(' · ')}${first ? ` · ${first.subject.name} first` : ''}`
              : 'All caught up'}
          </span>
        </span>
      </button>
      {plan.length > 0 && (
        <ChatStart class="study-cta-chat" label="Study in chat" prompt={() => quizChatPrompt({ fs, pack: loaded.pack, blocks: plan })} />
      )}
    </div>
  );
}
