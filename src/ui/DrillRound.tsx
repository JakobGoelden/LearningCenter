import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Dojo, Drill, Level } from '../model/types';
import {
  answerText,
  gradeDrill,
  pickRound,
  roundScore,
  secondsFor,
  selfResult,
  shuffledOrder,
  type DrillAnswer,
  type DrillResult,
} from '../dojo/drills';
import { LEVEL_LABEL } from '../ai/requests';
import { AutomatonEditor, AutomatonTable, emptyTable, tableToAutomaton, type TableState } from './AutomatonEditor';
import { Markdown } from './Markdown';
import { SCORE_LABEL } from './labels';

export interface DrillOutcome {
  drill: Drill;
  answer: string;
  result: DrillResult;
  seconds: number;
}

export interface RoundSummary {
  level: Level | 'all';
  timed: boolean;
  outcomes: DrillOutcome[];
  score: ReturnType<typeof roundScore>;
}

const COUNTS = [5, 10, 20];
const KIND_HINT: Record<Drill['kind'], string> = {
  choice: 'Multiple choice',
  input: 'Short answer',
  number: 'Number',
  order: 'Put in order',
  automaton: 'Build the automaton',
  regex: 'Regular expression',
  self: 'Open task',
};

/**
 * Practice round over the dojo's prepared drills: pick level, count and timer,
 * answer one drill after another with instant feedback, see the result.
 */
export function DrillPractice({
  dojo,
  onStart,
  onFinish,
  onApply,
}: {
  dojo: Dojo;
  onStart: (round: Drill[], level: Level | 'all') => void;
  onFinish: (summary: RoundSummary) => Promise<void>;
  onApply?: (summary: RoundSummary) => Promise<void>;
}) {
  const drills = dojo.drills ?? [];
  const levels = useMemo(() => (['easy', 'medium', 'exam'] as Level[]).filter((l) => drills.some((d) => (d.level ?? 'medium') === l)), [drills]);
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [count, setCount] = useState(5);
  const [timed, setTimed] = useState(true);
  const [round, setRound] = useState<Drill[] | null>(null);
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [applied, setApplied] = useState(false);
  const available = drills.filter((d) => level === 'all' || (d.level ?? 'medium') === level).length;

  const start = (pick: Drill[]) => {
    setSummary(null);
    setApplied(false);
    setRound(pick);
    onStart(pick, level);
  };

  if (round && !summary) {
    return (
      <DrillRun
        key={round.map((d) => d.id).join()}
        drills={round}
        timed={timed}
        onDone={async (outcomes) => {
          const s: RoundSummary = { level, timed, outcomes, score: roundScore(outcomes.map((o) => o.result)) };
          setSummary(s);
          await onFinish(s);
        }}
        onCancel={() => setRound(null)}
      />
    );
  }

  if (summary) {
    const right = summary.outcomes.filter((o) => o.result.correct).length;
    const total = summary.outcomes.reduce((s, o) => s + o.seconds, 0);
    const mistakes = summary.outcomes.filter((o) => !o.result.correct).map((o) => o.drill);
    return (
      <section class="panel stack">
        <div class="row">
          <h3 style="flex:1">Round finished</h3>
          <span class={`score score-${summary.score}`}>
            {right}/{summary.outcomes.length} right · {summary.score}/5 {SCORE_LABEL[summary.score]}
          </span>
        </div>
        <div class="small muted">
          Time: {fmt(total)}
          {summary.timed ? '' : ' (untimed)'}
        </div>
        <ul class="steps">
          {summary.outcomes.map((o) => (
            <li>
              <span style={{ color: o.result.correct ? 'var(--ok)' : o.result.score >= 3 ? 'var(--warn)' : 'var(--danger)' }}>
                {o.result.correct ? '✓' : o.result.score >= 3 ? '½' : '✗'}
              </span>
              <span class="small">
                {firstLine(o.drill.prompt)}
                {o.result.feedback && <span class="muted"> · {o.result.feedback}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div class="row">
          {mistakes.length > 0 && (
            <button class="primary" onClick={() => start(mistakes)}>
              Retry {mistakes.length} {mistakes.length === 1 ? 'mistake' : 'mistakes'}
            </button>
          )}
          <button class={mistakes.length ? '' : 'primary'} onClick={() => start(pickRound(drills, level, count))}>
            New round
          </button>
          <button onClick={() => (setRound(null), setSummary(null))}>Done</button>
          <span style="flex:1" />
          {onApply &&
            (applied ? (
              <span class="small muted">Saved to progress.</span>
            ) : (
              <button
                class="small"
                onClick={async () => {
                  await onApply(summary);
                  setApplied(true);
                }}
              >
                Save to progress
              </button>
            ))}
        </div>
      </section>
    );
  }

  return (
    <section class="panel stack">
      <div class="row">
        <h3 style="flex:1">Practice round</h3>
        <span class="small muted">{drills.length} prepared exercises · graded instantly</span>
      </div>
      <div class="row small">
        <span>Level</span>
        <div class="segmented">
          {(['all', ...levels] as (Level | 'all')[]).map((l) => (
            <button class={`small${level === l ? ' primary' : ''}`} aria-pressed={level === l} onClick={() => setLevel(l)}>
              {l === 'all' ? 'mixed' : LEVEL_LABEL[l]}
            </button>
          ))}
        </div>
        <span>Exercises</span>
        <div class="segmented">
          {COUNTS.filter((c, i) => i === 0 || c <= available || COUNTS[i - 1] < available).map((c) => (
            <button class={`small${count === c ? ' primary' : ''}`} aria-pressed={count === c} onClick={() => setCount(c)}>
              {Math.min(c, available)}
            </button>
          ))}
        </div>
        <label class="row" style="gap:4px">
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.currentTarget.checked)} /> Timer
        </label>
      </div>
      <div>
        <button class="primary" disabled={!available} onClick={() => start(pickRound(drills, level, count))}>
          Start
        </button>
      </div>
    </section>
  );
}

function DrillRun({
  drills,
  timed,
  onDone,
  onCancel,
}: {
  drills: Drill[];
  timed: boolean;
  onDone: (outcomes: DrillOutcome[]) => void;
  onCancel: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [outcomes, setOutcomes] = useState<DrillOutcome[]>([]);
  const drill = drills[idx];
  const done = outcomes.length > idx;
  const limit = secondsFor(drill);
  // Set during render so the first frame of a new exercise already uses it.
  const startedAt = useMemo(() => Date.now(), [idx]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (done) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [idx, done]);

  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const left = Math.max(0, limit - elapsed);

  const finish = (answer: string, result: DrillResult) => {
    if (done) return;
    setOutcomes([...outcomes, { drill, answer, result, seconds: Math.round((Date.now() - startedAt) / 1000) }]);
  };

  useEffect(() => {
    if (timed && !done && left <= 0) finish('', { correct: false, score: 0, feedback: 'Time is up.' });
  }, [left <= 0, done]);

  const next = () => (idx + 1 < drills.length ? setIdx(idx + 1) : onDone(outcomes));
  const outcome = outcomes[idx];

  return (
    <section class="panel stack drill">
      <div class="row small">
        <span class="qnum">
          Exercise {idx + 1}/{drills.length}
        </span>
        <span class="badge">{KIND_HINT[drill.kind]}</span>
        {drill.level && <span class="badge">{LEVEL_LABEL[drill.level]}</span>}
        <span style="flex:1" />
        <span class={`timer mono${timed && left < 10 && !done ? ' urgent' : ''}`} aria-live="off">
          {timed ? fmt(done ? Math.max(0, limit - outcome.seconds) : left) : fmt(done ? outcome.seconds : elapsed)}
        </span>
        <button class="ghost small" onClick={onCancel}>
          Stop
        </button>
      </div>
      {timed && (
        <div class="timebar" aria-hidden="true">
          <div style={{ width: `${(100 * (done ? Math.max(0, limit - outcome.seconds) : left)) / limit}%` }} />
        </div>
      )}
      <div class="prompt">
        <Markdown text={drill.prompt} />
      </div>
      {(drill.kind === 'automaton' || drill.kind === 'regex') && drill.given && (
        <AutomatonTable automaton={drill.given} alphabet={drill.alphabet} />
      )}
      <DrillInput key={drill.id + idx} drill={drill} locked={done} outcome={outcome} onSubmit={finish} />
      {done && (
        <div class="stack">
          <div class={`verdict ${outcome.result.correct ? 'ok' : outcome.result.score >= 3 ? 'partly' : 'wrong'}`}>
            <strong>{outcome.result.correct ? 'Right!' : outcome.result.score >= 3 ? 'Almost.' : 'Not quite.'}</strong>{' '}
            {outcome.result.feedback}
          </div>
          {drill.explanation && <Markdown text={drill.explanation} />}
          <div>
            <button class="primary" onClick={next} autoFocus>
              {idx + 1 < drills.length ? 'Next' : 'See result'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function DrillInput({
  drill,
  locked,
  outcome,
  onSubmit,
}: {
  drill: Drill;
  locked: boolean;
  outcome?: DrillOutcome;
  onSubmit: (answer: string, result: DrillResult) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const [text, setText] = useState('');
  const [order, setOrder] = useState<number[]>(() => (drill.kind === 'order' ? shuffledOrder(drill.items.length) : []));
  const [table, setTable] = useState<TableState>(emptyTable);
  const [revealed, setRevealed] = useState(false);

  const submit = (a: DrillAnswer) => onSubmit(answerText(drill, a), gradeDrill(drill, a));
  const onEnter = (e: KeyboardEvent, a: () => DrillAnswer) => {
    if (e.key === 'Enter' && !locked) {
      e.preventDefault();
      submit(a());
    }
  };
  const check = (a: () => DrillAnswer, disabled = false) =>
    !locked && (
      <div>
        <button class="primary" disabled={disabled} onClick={() => submit(a())}>
          Check
        </button>
      </div>
    );

  switch (drill.kind) {
    case 'choice': {
      const multi = drill.correct.length > 1;
      return (
        <div class="stack">
          {multi && <div class="small muted">Pick all that apply.</div>}
          <div class="options" role={multi ? 'group' : 'radiogroup'}>
            {drill.options.map((o, i) => {
              const isPicked = picked.includes(i);
              const mark = locked ? (drill.correct.includes(i) ? ' right' : isPicked ? ' wrong' : '') : '';
              return (
                <label class={`option${isPicked ? ' picked' : ''}${mark}`}>
                  <input
                    type={multi ? 'checkbox' : 'radio'}
                    name="choice"
                    checked={isPicked}
                    disabled={locked}
                    onChange={() => setPicked(multi ? (isPicked ? picked.filter((p) => p !== i) : [...picked, i]) : [i])}
                  />
                  <Markdown text={o} />
                </label>
              );
            })}
          </div>
          {check(() => ({ kind: 'choice', picked }), !picked.length)}
        </div>
      );
    }
    case 'input':
    case 'number':
    case 'regex': {
      const a = (): DrillAnswer => ({ kind: drill.kind, text });
      return (
        <div class="stack">
          <div class="row">
            <input
              class={drill.kind === 'regex' ? 'mono' : ''}
              style="flex:1;min-width:0"
              value={text}
              disabled={locked}
              inputMode={drill.kind === 'number' ? 'decimal' : undefined}
              placeholder={drill.kind === 'regex' ? `e.g. (${drill.alphabet.join('|')})*${drill.alphabet[0]}` : 'Your answer'}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => onEnter(e, a)}
              aria-label="Your answer"
              autoFocus
            />
            {drill.kind === 'number' && drill.unit && <span>{drill.unit}</span>}
          </div>
          {drill.kind === 'regex' && !locked && (
            <div class="small muted">
              Alphabet {'{'}
              {drill.alphabet.join(', ')}
              {'}'}. Use | for or, * + ? after a symbol or group, parentheses, eps for ε.
            </div>
          )}
          {check(a)}
        </div>
      );
    }
    case 'order': {
      const move = (i: number, d: number) => {
        const next = [...order];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        setOrder(next);
      };
      return (
        <div class="stack">
          <ol class="order-list">
            {order.map((item, i) => (
              <li class={locked ? (item === i ? 'right' : 'wrong') : ''}>
                <span class="muted mono">{i + 1}.</span>
                <span class="grow">{drill.items[item]}</span>
                {!locked && (
                  <>
                    <button class="ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button class="ghost small" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                      ↓
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
          {locked && outcome && !outcome.result.correct && (
            <div class="small">
              Right order: {drill.items.map((it, i) => `${i + 1}. ${it}`).join('  ')}
            </div>
          )}
          {check(() => ({ kind: 'order', order }))}
        </div>
      );
    }
    case 'automaton':
      return (
        <div class="stack">
          <AutomatonEditor
            value={table}
            onChange={setTable}
            alphabet={drill.alphabet}
            allowEps={!drill.deterministic}
            disabled={locked}
          />
          {drill.deterministic && !locked && (
            <div class="small muted">
              A DFA: one target per cell. Name states as you like, e.g. {'{q0,q1}'}.{drill.minimal ? ' It must be minimal.' : ''}
            </div>
          )}
          {check(() => ({ kind: 'automaton', automaton: tableToAutomaton(table, drill.deterministic ? drill.alphabet : [...drill.alphabet, 'ε']) }))}
        </div>
      );
    case 'self':
      return (
        <div class="stack">
          <textarea
            value={text}
            disabled={locked}
            onInput={(e) => setText(e.currentTarget.value)}
            placeholder="Your answer …"
            aria-label="Your answer"
          />
          {!revealed && !locked && (
            <div>
              <button class="primary" onClick={() => setRevealed(true)}>
                Show solution
              </button>
            </div>
          )}
          {(revealed || locked) && (
            <div class="panel-inset stack">
              <strong class="small">Solution</strong>
              <Markdown text={drill.solution} />
            </div>
          )}
          {revealed && !locked && (
            <div class="row">
              <span class="small">How did you do?</span>
              <button onClick={() => onSubmit(text, selfResult('right'))}>Right</button>
              <button onClick={() => onSubmit(text, selfResult('partly'))}>Partly</button>
              <button onClick={() => onSubmit(text, selfResult('wrong'))}>Wrong</button>
            </div>
          )}
        </div>
      );
  }
}

function fmt(seconds: number): string {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function firstLine(md: string): string {
  const line = md.split('\n').find((l) => l.trim()) ?? '';
  const plain = line.replace(/[*`#>]/g, '').trim();
  return plain.length > 90 ? `${plain.slice(0, 88)}…` : plain;
}
