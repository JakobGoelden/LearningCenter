import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Dojo, Drill, Level } from '../model/types';
import {
  answerText,
  fieldRight,
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
import { AutomatonDiagram } from './AutomatonDiagram';
import { AutomatonEditor, AutomatonTable, emptyTable, tableToAutomaton, type TableState } from './AutomatonEditor';
import { Markdown } from './Markdown';
import { SCORE_LABEL } from './labels';
import { Belt, beltFor, TimerRing } from './Emblem';
import { bestPoints, drillPoints, recordPoints, roundPoints, type DrillPoints } from '../dojo/points';
import { examScore } from '../dojo/exam';
import { gradeSqlDrill, sqlEngine } from '../dojo/sql';
import { drillSymbols } from '../dojo/symbols';
import { SymbolBar } from './SymbolBar';
import { Cheer } from './QuizView';
import { ChatStart } from './ChatStart';

export interface DrillOutcome {
  drill: Drill;
  answer: string;
  result: DrillResult;
  seconds: number;
  points: DrillPoints;
}

export interface RoundSummary {
  level: Level | 'all';
  timed: boolean;
  outcomes: DrillOutcome[];
  score: ReturnType<typeof roundScore>;
  points: number;
  bestStreak: number;
  /** Best total on this device before this round. */
  bestBefore: number;
  record: boolean;
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
  fields: 'Fill in the blanks',
  sql: 'Write SQL',
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
  chatPrompt,
  ai,
  onRunning,
  fixed,
}: {
  dojo: Dojo;
  /** A fixed kind of round instead of level and count (the practice exam): its intro and how to pick it. */
  fixed?: {
    title: string;
    intro: ComponentChildren;
    pick: () => Drill[];
    startLabel: string;
    /** Which part of the exam a drill belongs to, and that part's name. */
    ownerOf: (drillId: string) => string;
    partTitle: (id: string) => string;
  };
  /** True while a round runs (not on the setup or the result). */
  onRunning?: (running: boolean) => void;
  /** Prompt for "Train in chat" at the chosen level. */
  chatPrompt?: (level: Level | 'all') => string;
  /** AI extras in the app: write more drills, or a fresh task checked step by step. */
  ai?: { busy: boolean; drillCount: number; moreDrills: () => void; freshTask: (level: Level | 'all') => void };
  onStart: (round: Drill[], level: Level | 'all') => void;
  onFinish: (summary: RoundSummary) => Promise<void>;
  onApply?: (summary: RoundSummary) => Promise<void>;
}) {
  const drills = dojo.drills ?? [];
  const levels = useMemo(
    () =>
      drills.length
        ? (['easy', 'medium', 'exam'] as Level[]).filter((l) => drills.some((d) => (d.level ?? 'medium') === l))
        : (dojo.levels ?? (['easy', 'medium', 'exam'] as Level[])),
    [drills, dojo.levels],
  );
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [count, setCount] = useState(5);
  const [timed, setTimed] = useState(true);
  const [round, setRound] = useState<Drill[] | null>(null);
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [applied, setApplied] = useState(false);
  const running = !!round && !summary;
  useEffect(() => {
    onRunning?.(running);
    if (running) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [running]);
  useEffect(() => () => onRunning?.(false), []);
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
        dojo={dojo}
        drills={round}
        timed={timed}
        exam={fixed}
        onDone={async (outcomes) => {
          const pts = roundPoints(outcomes.map((o) => ({ level: o.drill.level, result: o.result, limit: secondsFor(o.drill), seconds: o.seconds, timed })));
          const bestBefore = bestPoints(dojo.id);
          const s: RoundSummary = {
            level,
            timed,
            outcomes,
            score: roundScore(outcomes.map((o) => o.result)),
            points: pts.total,
            bestStreak: pts.bestStreak,
            bestBefore,
            record: pts.total > 0 && recordPoints(dojo.id, pts.total),
          };
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
    const exam = fixed ? examScore(summary.outcomes, fixed.ownerOf) : null;
    return (
      <section class="panel stack dojo-mat">
        {exam && fixed && (
          <div class="exam-result">
            <div class="dojo-eyebrow">Exam result</div>
            <div class="round-result-big">
              {exam.earned}/{exam.max} <span>points ({Math.round((100 * exam.earned) / exam.max)} %)</span>
            </div>
            <table class="exam-plan">
              <tbody>
                {exam.parts.map((p) => (
                  <tr>
                    <td>{fixed.partTitle(p.id)}</td>
                    <td class="exam-part-points">
                      {p.earned}/{p.max}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div class="round-result">
          <Belt score={summary.score} />
          <div class="round-points" style={exam ? { display: 'none' } : undefined}>
            <CountUp value={summary.points} duration={1200} />
            <span class="round-points-label">points</span>
            {summary.record ? (
              <span class="record-badge">
                New record!
                <Cheer />
              </span>
            ) : summary.bestBefore > 0 ? (
              <span class="small muted">Best {summary.bestBefore}</span>
            ) : null}
            {summary.bestStreak >= 3 && <span class="small muted">Longest combo {summary.bestStreak}</span>}
          </div>
          <div class="round-result-text">
            <div class="dojo-eyebrow">Round finished</div>
            <div class="round-result-big">
              {right}/{summary.outcomes.length} <span>right</span>
            </div>
            <div class="row small">
              <span class={`score score-${summary.score}`}>
                {summary.score}/5 {SCORE_LABEL[summary.score]}
              </span>
              <span class="belt-name">{beltFor(summary.score).name}</span>
              <span class="muted">
                Time {fmt(total)}
                {summary.timed ? '' : ' (untimed)'}
              </span>
            </div>
          </div>
        </div>
        <ul class="steps round-list">
          {summary.outcomes.map((o) => (
            <li>
              <span class="round-mark" style={{ color: o.result.correct ? 'var(--ok)' : o.result.score >= 3 ? 'var(--warn)' : 'var(--danger)' }}>
                {o.result.correct ? '✓' : o.result.score >= 3 ? '½' : '✗'}
              </span>
              <span class="small">
                {firstLine(o.drill.prompt)}
                {o.result.feedback && <span class="muted"> · {o.result.feedback}</span>}
              </span>
              <span class="round-pts">+{o.points.points}</span>
            </li>
          ))}
        </ul>
        <div class="row">
          {mistakes.length > 0 && (
            <button class="primary" onClick={() => start(mistakes)}>
              Retry {mistakes.length} {mistakes.length === 1 ? 'mistake' : 'mistakes'}
            </button>
          )}
          <button class={mistakes.length ? '' : 'primary'} onClick={() => start(fixed ? fixed.pick() : pickRound(drills, level, count))}>
            {fixed ? 'New practice exam' : 'New round'}
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

  if (fixed) {
    return (
      <section class="panel stack dojo-mat dojo-start">
        <div>
          <div class="dojo-eyebrow">Practice exam</div>
          <h2>{fixed.title}</h2>
        </div>
        {fixed.intro}
        <div class="row">
          <button class="primary dojo-go" disabled={!drills.length} onClick={() => start(fixed.pick())}>
            {fixed.startLabel}
          </button>
          <label class="row small" style="gap:4px">
            <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.currentTarget.checked)} /> Exam clock
          </label>
          {bestPoints(dojo.id) > 0 && <span class="small muted">Best {bestPoints(dojo.id)} points</span>}
        </div>
      </section>
    );
  }

  return (
    <section class="panel stack dojo-mat dojo-start">
      <div class="row">
        <div style="flex:1">
          <div class="dojo-eyebrow">Training</div>
          <h2>Step onto the mat</h2>
        </div>
        {bestPoints(dojo.id) > 0 && <span class="small muted">Best round {bestPoints(dojo.id)} points</span>}
      </div>
      <div class="dojo-ways">
        <div class="dojo-way app">
          <div class="dojo-way-head">
            <span class="dojo-way-icon" aria-hidden="true">
              ▶
            </span>
            <div>
              <strong>Here in the app</strong>
              <span class="small muted">
                {drills.length ? `${drills.length} prepared exercises, graded instantly, with points` : 'No prepared exercises yet'}
              </span>
            </div>
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
          </div>
          {drills.length > 0 && (
            <div class="row small">
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
          )}
          {drills.length > 0 && (
            <div>
              <button class="primary dojo-go" disabled={!available} onClick={() => start(pickRound(drills, level, count))}>
                Start training
              </button>
            </div>
          )}
          {ai && (
            <div class="dojo-way-more small">
              <span class="muted">With the AI:</span>
              <button class={`small${drills.length ? ' ghost' : ' primary'}`} onClick={ai.moreDrills} disabled={ai.busy}>
                + {ai.drillCount} new exercises
              </button>
              <button class="small ghost" onClick={() => ai.freshTask(level)} disabled={ai.busy} title="The AI writes a new task and checks your solution step by step">
                A fresh task, checked step by step
              </button>
            </div>
          )}
        </div>
        {chatPrompt && (
          <div class="dojo-way chat">
            <div class="dojo-way-head">
              <span class="dojo-way-icon" aria-hidden="true">
                💬
              </span>
              <div>
                <strong>In your AI chat</strong>
                <span class="small muted">Talk it through, voice included</span>
              </div>
            </div>
            <p class="small">
              Your AI sets one task at a time, checks every step and gives hints when you ask. It records the result in your pack.
            </p>
            <ChatStart label="Copy prompt for the chat" prompt={() => chatPrompt('all')} />
          </div>
        )}
      </div>
    </section>
  );
}

function DrillRun({
  dojo,
  drills,
  timed,
  exam,
  onDone,
  onCancel,
}: {
  dojo: Dojo;
  drills: Drill[];
  timed: boolean;
  /** Practice exam: one clock for the whole round instead of one per drill, and exam points. */
  exam?: { ownerOf: (drillId: string) => string };
  onDone: (outcomes: DrillOutcome[]) => void;
  onCancel: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [outcomes, setOutcomes] = useState<DrillOutcome[]>([]);
  const drill = drills[idx];
  const done = outcomes.length > idx;
  const drillLimit = secondsFor(drill);
  const limit = useMemo(() => (exam ? drills.reduce((s, d) => s + secondsFor(d), 0) : drillLimit), [exam, drills, drillLimit]);
  const roundStart = useMemo(() => Date.now(), []);
  // Set during render so the first frame of a new exercise already uses it.
  const startedAt = useMemo(() => Date.now(), [idx]);
  const [now, setNow] = useState(Date.now());
  const symbols = useMemo(() => drillSymbols(dojo, drill), [dojo, drill]);

  useEffect(() => {
    if (done && !exam) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [idx, done]);

  const elapsed = Math.max(0, (now - (exam ? roundStart : startedAt)) / 1000);
  const left = Math.max(0, limit - elapsed);
  const total = outcomes.reduce((s, o) => s + o.points.points, 0);
  const scored = exam ? examScore(outcomes, exam.ownerOf) : null;
  const clock = exam || !done ? left : Math.max(0, limit - outcomes[idx].seconds);
  const streak = outcomes.length ? outcomes[outcomes.length - 1].points.streak : 0;

  const finish = (answer: string, result: DrillResult) => {
    if (done) return;
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const points = drillPoints({ level: drill.level, result, limit: drillLimit, seconds, timed }, streak);
    setOutcomes([...outcomes, { drill, answer, result, seconds, points }]);
  };

  useEffect(() => {
    if (!timed || left > 0) return;
    if (exam) {
      // The exam clock ran out: everything not answered yet counts as blank.
      const blank = (d: Drill): DrillOutcome => {
        const result: DrillResult = { correct: false, score: 0, feedback: 'Time is up.' };
        return { drill: d, answer: '', result, seconds: 0, points: drillPoints({ level: d.level, result, limit: secondsFor(d), seconds: 0, timed }, 0) };
      };
      onDone([...outcomes, ...drills.slice(outcomes.length).map(blank)]);
    } else if (!done) finish('', { correct: false, score: 0, feedback: 'Time is up.' });
  }, [left <= 0, done]);

  const next = () => (idx + 1 < drills.length ? setIdx(idx + 1) : onDone(outcomes));
  const outcome = outcomes[idx];
  const mood = done ? (outcome.result.correct ? 'ok' : outcome.result.score >= 3 ? 'partly' : 'wrong') : '';

  return (
    <section class={`panel stack drill dojo-mat${done ? ` hit-${mood}` : ''}`} data-symbols>
      <div class="row small">
        <span class="qnum">
          Exercise {idx + 1}/{drills.length}
        </span>
        <span class="pips" aria-hidden="true">
          {drills.map((_, i) => (
            <i class={i < outcomes.length ? (outcomes[i].result.correct ? 'ok' : outcomes[i].result.score >= 3 ? 'partly' : 'wrong') : i === idx ? 'now' : ''} />
          ))}
        </span>
        <span class="badge">{KIND_HINT[drill.kind]}</span>
        {drill.level && <span class="badge">{LEVEL_LABEL[drill.level]}</span>}
        {drill.origin && (
          <span class={`badge origin-${drill.origin}`} title={drill.source ?? ''}>
            {drill.origin === 'exam' ? `Old exam${drill.source ? `: ${drill.source}` : ''}` : drill.origin === 'adapted' ? `Adapted from ${drill.source ?? 'an old exam'}` : 'Made up'}
          </span>
        )}
        <span style="flex:1" />
        {!exam && streak >= 2 && (
          <span class={`combo${streak >= 5 ? ' hot' : streak >= 3 ? ' warm' : ''}`} key={streak} title={`${streak} right in a row`}>
            <span class="combo-flame" aria-hidden="true">
              🔥
            </span>
            {streak}
            {streak >= 3 && <b>×{streak >= 5 ? 2 : 1.5}</b>}
          </span>
        )}
        {exam ? (
          drill.points !== undefined && <span class="badge">{drill.points} P</span>
        ) : (
          <span class="score-counter" aria-label={`${total} points`}>
            <CountUp value={total} />
            <small>pts</small>
            {done && outcome.points.points > 0 && (
              <span class="points-pop" aria-hidden="true">
                +{outcome.points.points}
              </span>
            )}
          </span>
        )}
        {scored && (
          <span class="badge">
            {scored.earned}/{scored.max} P
          </span>
        )}
        <TimerRing
          fraction={timed ? clock / limit : 1}
          label={timed ? fmt(clock) : fmt(done && !exam ? outcome.seconds : elapsed)}
          urgent={timed && left < 10 && (!done || !!exam)}
        />
        <button class="ghost small" onClick={onCancel}>
          Stop
        </button>
      </div>
      {timed && (
        <div class="timebar" aria-hidden="true">
          <div style={{ width: `${(100 * clock) / limit}%` }} />
        </div>
      )}
      <div class="prompt">
        <Markdown text={drill.prompt} />
      </div>
      {(drill.kind === 'automaton' || drill.kind === 'regex') && drill.given && (
        <div class="automaton-pair">
          <AutomatonTable automaton={drill.given} alphabet={drill.alphabet} />
          <AutomatonDiagram automaton={drill.given} label="Given automaton" />
        </div>
      )}
      <DrillInput key={drill.id + idx} drill={drill} locked={done} outcome={outcome} onSubmit={finish} />
      {!done && <SymbolBar symbols={symbols} />}
      {done && (
        <div class="stack">
          <div class={`verdict ${mood}`}>
            <span class={`stamp${mood === 'wrong' ? ' cross' : ''}`} aria-hidden="true">
              {outcome.result.correct ? '一本' : outcome.result.score >= 3 ? '技有' : '×'}
            </span>
            <span class="grow verdict-text">
              <strong>{outcome.result.correct ? 'Right!' : outcome.result.score >= 3 ? 'Almost.' : 'Not quite.'}</strong>{' '}
              {outcome.result.feedback}
            </span>
            {!exam && <PointsBreakdown p={outcome.points} />}
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

/** "+30 = 20 + 5 speed × 1.5 combo" next to the verdict. */
function PointsBreakdown({ p }: { p: DrillPoints }) {
  if (!p.points) return <span class="pts-breakdown muted">+0</span>;
  return (
    <span class="pts-breakdown">
      <b>+{p.points}</b>
      <small>
        {p.base}
        {p.speed > 0 && <> + {p.speed} speed</>}
        {p.combo > 1 && <> × {p.combo} combo</>}
      </small>
    </span>
  );
}

/** Counts from the previous value up to `value` with an ease-out. */
function CountUp({ value, duration = 600 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(duration > 600 ? 0 : value);
  const from = useRef(shown);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (a === value) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span class={`count-up${shown !== value ? ' counting' : ''}`}>{shown}</span>;
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
  const [values, setValues] = useState<string[]>([]);
  const setValue = (i: number, v: string) => setValues((old) => Object.assign([...old], { [i]: v }));
  const built = useMemo(
    () => (drill.kind === 'automaton' ? tableToAutomaton(table, drill.deterministic ? drill.alphabet : [...drill.alphabet, 'ε']) : null),
    [drill, table],
  );

  const submit = (a: DrillAnswer) => onSubmit(answerText(drill, a), gradeDrill(drill, a));
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (drill.kind === 'sql') void sqlEngine();
  }, [drill]);
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
    case 'order':
      return (
        <div class="stack">
          <OrderList items={drill.items} order={order} onChange={setOrder} locked={locked} />
          {!locked && <div class="small muted">Drag the steps into place, or focus one and use the arrow keys.</div>}
          {locked && outcome && !outcome.result.correct && (
            <div class="small">
              Right order: {drill.items.map((it, i) => `${i + 1}. ${it}`).join('  ')}
            </div>
          )}
          {check(() => ({ kind: 'order', order }))}
        </div>
      );
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
          {built && <AutomatonDiagram automaton={built} label="Your automaton" />}
          {drill.deterministic && !locked && (
            <div class="small muted">
              A DFA: one target per cell. Name states as you like, e.g. {'{q0,q1}'}.{drill.minimal ? ' It must be minimal.' : ''}
            </div>
          )}
          {check(() => ({ kind: 'automaton', automaton: built! }))}
        </div>
      );
    case 'fields':
      return (
        <div class="stack">
          <div class="drill-fields">
            {drill.fields.map((f, i) => {
              const value = values[i] ?? '';
              const right = locked && fieldRight(f, value);
              return (
                <div class={`drill-field${locked ? (right ? ' right' : ' wrong') : ''}`}>
                  <span class="drill-field-label">{f.label}</span>
                  {f.options ? (
                    <div class="segmented" role="radiogroup" aria-label={f.label}>
                      {f.options.map((o) => (
                        <button class={`small${value === o ? ' primary' : ''}`} aria-pressed={value === o} disabled={locked} onClick={() => setValue(i, o)}>
                          {o}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      class="mono"
                      value={value}
                      disabled={locked}
                      aria-label={f.label}
                      onInput={(e) => setValue(i, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const inputs = [...(e.currentTarget.closest('.drill-fields')?.querySelectorAll('input') ?? [])];
                        inputs[inputs.indexOf(e.currentTarget) + 1]?.focus();
                      }}
                    />
                  )}
                  {locked && !right && <span class="drill-field-want mono">{f.accept[0]}</span>}
                </div>
              );
            })}
          </div>
          {check(() => ({ kind: 'fields', values }))}
        </div>
      );
    case 'sql': {
      const run = async () => {
        setChecking(true);
        try {
          onSubmit(text, await gradeSqlDrill(drill, text));
        } catch (e) {
          onSubmit(text, { correct: false, score: 0, feedback: `The database could not start: ${(e as Error).message}` });
        }
        setChecking(false);
      };
      return (
        <div class="stack">
          <textarea
            class="mono sql-input"
            value={text}
            disabled={locked || checking}
            onInput={(e) => setText(e.currentTarget.value)}
            spellcheck={false}
            placeholder="Your SQL …"
            aria-label="Your SQL"
          />
          {!locked && (
            <div>
              <button class="primary" disabled={checking || !text.trim()} onClick={run}>
                {checking ? 'Running …' : 'Run and check'}
              </button>
            </div>
          )}
          {locked && (
            <div class="panel-inset stack">
              <strong class="small">Solution</strong>
              <pre class="mono sql-solution">{drill.solution}</pre>
            </div>
          )}
        </div>
      );
    }
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

interface Drag {
  from: number;
  over: number;
  dy: number;
  startY: number;
  pointer: number;
  /** Midpoints of all rows and the dragged row's height plus gap, measured at the start. */
  mids: number[];
  shift: number;
}

/**
 * Sortable list for order drills. Drag with mouse, pen or finger (the row
 * follows the pointer, the others make room), or focus a row and use ↑/↓.
 */
function OrderList({ items, order, onChange, locked }: { items: string[]; order: number[]; onChange: (o: number[]) => void; locked: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropped, setDropped] = useState<number | null>(null);
  const [settling, setSettling] = useState(false);
  const focusItem = useRef<number | null>(null);

  // Keep keyboard focus on the moved row after it changed place.
  useLayoutEffect(() => {
    if (focusItem.current === null) return;
    list.current?.querySelector<HTMLElement>(`[data-item="${focusItem.current}"]`)?.focus();
    focusItem.current = null;
  }, [order]);
  useEffect(() => {
    if (!settling) return;
    const r = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(r);
  }, [settling]);

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  const down = (i: number) => (e: PointerEvent) => {
    if (locked || e.button !== 0) return;
    const rows = [...(list.current?.children ?? [])].map((el) => el.getBoundingClientRect());
    const gap = rows.length > 1 ? rows[1].top - rows[0].bottom : 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDropped(null);
    setDrag({ from: i, over: i, dy: 0, startY: e.clientY, pointer: e.pointerId, mids: rows.map((r) => r.top + r.height / 2), shift: rows[i].height + gap });
  };
  const moveTo = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dy = e.clientY - drag.startY;
    const center = drag.mids[drag.from] + dy;
    const over = drag.mids.filter((m, j) => j !== drag.from && m < center).length;
    setDrag({ ...drag, dy, over });
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    setSettling(true);
    setDrag(null);
    setDropped(order[drag.from]);
    move(drag.from, drag.over);
  };
  const key = (i: number) => (e: KeyboardEvent) => {
    if (locked) return;
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : -1;
    if (to < 0 || to >= order.length || to === i) return;
    e.preventDefault();
    focusItem.current = order[i];
    setSettling(true);
    setDropped(order[i]);
    move(i, to);
  };

  const offset = (j: number) => {
    if (!drag) return 0;
    if (j === drag.from) return drag.dy;
    if (drag.from < j && j <= drag.over) return -drag.shift;
    if (drag.over <= j && j < drag.from) return drag.shift;
    return 0;
  };

  return (
    <ol class={`order-list${drag ? ' sorting' : ''}${settling ? ' settling' : ''}${locked ? '' : ' sortable'}`} ref={list} aria-label="Steps in your order">
      {order.map((item, i) => (
        <li
          key={item}
          data-item={item}
          class={[locked ? (item === i ? 'right' : 'wrong') : '', drag?.from === i ? 'dragging' : '', dropped === item && !drag ? 'dropped' : '']
            .filter(Boolean)
            .join(' ')}
          style={drag ? { transform: `translateY(${offset(i)}px)` } : undefined}
          tabIndex={locked ? undefined : 0}
          aria-label={locked ? undefined : `${i + 1}. ${items[item]}. Use arrow keys to move.`}
          onPointerDown={down(i)}
          onPointerMove={moveTo}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key(i)}
        >
          {!locked && (
            <span class="grip" aria-hidden="true">
              ⠿
            </span>
          )}
          <span class="order-num mono">{(drag ? (i === drag.from ? drag.over : i - (drag.from < i && i <= drag.over ? 1 : 0) + (drag.over <= i && i < drag.from ? 1 : 0)) : i) + 1}.</span>
          <span class="grow">{items[item]}</span>
        </li>
      ))}
    </ol>
  );
}

function fmt(seconds: number): string {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function firstLine(md: string): string {
  const line = md.split('\n').find((l) => l.trim() && !l.startsWith('```')) ?? '';
  const plain = line.replace(/[*`#>]/g, '').trim();
  return plain.length > 90 ? `${plain.slice(0, 88)}…` : plain;
}
