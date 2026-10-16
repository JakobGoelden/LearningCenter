import { useRef, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { nowIso, today } from '../lib/dates';
import { applyReview } from '../scheduling/scheduler';
import { dojoCheckRequest, dojoDrillsRequest, dojoHintRequest, dojoSolutionRequest, dojoTaskRequest, LEVEL_LABEL } from '../ai/requests';
import { saveDojo, saveSession } from '../storage/repo';
import type { Level, Score, Session, SessionItem } from '../model/types';
import { Cancelled, useAi } from './AiPanel';
import { Markdown } from './Markdown';
import { href } from './router';
import { sessionId } from './QuizView';
import { SCORE_LABEL } from './labels';
import { DrillPractice, type RoundSummary } from './DrillRound';
import { roundScore } from '../dojo/drills';
import { Enso, Torii } from './Emblem';
import type { ComponentChildren } from 'preact';

const ALL_LEVELS: Level[] = ['easy', 'medium', 'exam'];

export function DojoView({ subjectId, dojoId }: { subjectId: string; dojoId?: string }) {
  const pack = usePack();
  const { fs, loaded, log, updateSubject, setNotice, reload } = pack;
  const s = pack.subject(subjectId);
  const dojos = loaded.dojos.filter((d) => d.subject === subjectId);
  const dojo = dojos.find((d) => d.id === dojoId);
  const { run, busy, panel } = useAi();
  const levels = dojo?.levels?.length ? dojo.levels : ALL_LEVELS;
  const [level, setLevel] = useState<Level>(levels[Math.min(1, levels.length - 1)]);
  const [session, setSession] = useState<Session | null>(null);
  /** Session file of the last practice round, linked from the topic reviews. */
  const drillSessionId = useRef('');
  const [error, setError] = useState<string | null>(null);

  if (!s) return <div class="error">This pack has no subject "{subjectId}".</div>;

  const back = (
    <a class="dojo-back" href={dojo ? href({ name: 'dojo', subject: s.id }) : href({ name: 'dashboard' })}>
      ← {dojo ? 'All dojos' : 'Dashboard'}
    </a>
  );
  const hero = (title: string, sub: ComponentChildren, extra?: ComponentChildren) => (
    <header class="dojo-hero" style={{ '--c': s.color }}>
      <Enso class="dojo-hero-enso" />
      <Torii class="dojo-hero-torii" />
      <span class="dojo-hero-kanji" aria-hidden="true">
        道場
      </span>
      <div class="dojo-hero-body">
        {back}
        <div class="dojo-hero-eyebrow">Dojo · {s.name}</div>
        <h1>{title}</h1>
        <div class="dojo-hero-sub">{sub}</div>
        {extra}
      </div>
    </header>
  );

  if (!dojo) {
    return (
      <div class="stack">
        {hero('Choose your training', `${dojos.length} ${dojos.length === 1 ? 'dojo' : 'dojos'} for ${s.name}`)}
        {dojoId && <div class="error">There is no dojo "{dojoId}".</div>}
        {dojos.length === 0 ? (
          <div class="panel muted">
            This subject has no dojos yet. Add a file under <code>dojos/</code> (templates in{' '}
            <code>packs/dojo-library</code>) and list its ID in <code>pack.json</code>.
          </div>
        ) : (
          <div class="cards">
            {dojos.map((d) => (
              <a class="dojo-card" style={{ '--c': s.color }} href={href({ name: 'dojo', subject: s.id, dojo: d.id })}>
                <Torii class="dojo-card-torii" />
                <h2>{d.title}</h2>
                {d.drills?.length ? <span class="dojo-card-count">{d.drills.length} exercises</span> : null}
                <div class="small muted">{d.procedure}</div>
                {d.description && <div class="small">{d.description}</div>}
                {d.aids?.length ? <div class="small muted">Aids: {d.aids.join(', ')}</div> : null}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  const base = { pack: loaded.pack, subject: s, dojo, level };
  const item: SessionItem | undefined = session?.items[0];

  const persist = async (next: Session) => {
    setSession(next);
    try {
      await saveSession(fs, next);
    } catch (e) {
      setNotice(`Could not save the session: ${(e as Error).message}`);
    }
  };
  const patchItem = (change: Partial<SessionItem>) =>
    session ? { ...session, items: [{ ...session.items[0], ...change }] } : session!;

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof Cancelled)) setError((e as Error).message);
    }
  };

  const newTask = () =>
    guard(async () => {
      const id = sessionId('dojo', s.id);
      const res = await run(dojoTaskRequest({ ...base, sessionId: id }));
      const next: Session = {
        id,
        type: 'dojo',
        subject: s.id,
        dojo: dojo.id,
        level,
        adapter: pack.ai.adapter,
        startedAt: nowIso(),
        items: [{ n: 1, kind: 'task', prompt: res.task! }],
      };
      await persist(next);
      await log({ type: 'dojo.task', subject: s.id, ref: id, data: { dojo: dojo.id, level } });
    });

  const hint = () =>
    guard(async () => {
      if (!session || !item) return;
      const res = await run(
        dojoHintRequest({ ...base, sessionId: session.id, task: item.prompt, answer: item.answer ?? '', previousHints: item.hints ?? [] }),
      );
      await persist(patchItem({ hints: [...(item.hints ?? []), res.hint!] }));
      await log({ type: 'dojo.hint', subject: s.id, ref: session.id, data: { n: (item.hints?.length ?? 0) + 1 } });
    });

  const check = () =>
    guard(async () => {
      if (!session || !item) return;
      await persist(session);
      await log({ type: 'dojo.answer', subject: s.id, ref: session.id, data: { chars: item.answer?.length ?? 0 } });
      const res = await run(
        dojoCheckRequest({ ...base, sessionId: session.id, task: item.prompt, answer: item.answer ?? '', hintsUsed: item.hints?.length ?? 0 }),
      );
      const c = res.check!;
      await persist({
        ...patchItem({ score: c.score, feedback: c.feedback, ...(c.steps?.length ? { steps: c.steps } : {}) }),
        finishedAt: nowIso(),
      });
      await log({ type: 'dojo.check', subject: s.id, ref: session.id, actor: 'ai', data: { score: c.score, correct: c.correct ?? null } });
    });

  const solution = () =>
    guard(async () => {
      if (!session || !item) return;
      const res = await run(dojoSolutionRequest({ ...base, sessionId: session.id, task: item.prompt }));
      await persist(patchItem({ solution: res.solution! }));
      await log({ type: 'dojo.solution', subject: s.id, ref: session.id });
    });

  const apply = () =>
    guard(async () => {
      if (!session || item?.score === undefined || !dojo.topics?.length) return;
      const score = item.score;
      const ids = new Set(dojo.topics);
      await updateSubject(
        s.id,
        (subj) => ({
          ...subj,
          topics: subj.topics.map((t) =>
            ids.has(t.id) ? applyReview(t, { date: today(), score, source: 'dojo', sessionId: session.id }, loaded.pack.settings) : t,
          ),
        }),
        { type: 'dojo.applied', ref: session.id, data: { topics: dojo.topics, score } },
      );
      await persist({ ...session, applied: true });
    });

  const saveRound = async (summary: RoundSummary) => {
    const id = sessionId('drill', s.id);
    drillSessionId.current = id;
    const next: Session = {
      id,
      type: 'dojo',
      subject: s.id,
      dojo: dojo.id,
      ...(summary.level !== 'all' ? { level: summary.level } : {}),
      startedAt: nowIso(),
      finishedAt: nowIso(),
      items: summary.outcomes.map((o, i) => ({
        n: i + 1,
        kind: 'drill',
        drill: o.drill.id,
        ...(o.drill.topic ? { topicId: o.drill.topic } : {}),
        prompt: o.drill.prompt,
        answer: o.answer,
        score: o.result.score,
        ...(o.result.feedback ? { feedback: o.result.feedback } : {}),
      })),
    };
    try {
      await saveSession(fs, next);
    } catch (e) {
      setNotice(`Could not save the session: ${(e as Error).message}`);
    }
    await log({
      type: 'dojo.drill.round',
      subject: s.id,
      ref: id,
      data: { dojo: dojo.id, score: summary.score, right: summary.outcomes.filter((o) => o.result.correct).length, of: summary.outcomes.length },
    });
  };

  /** One review per trained topic: the drills' own topics, else the dojo's. */
  const applyRound = async (summary: RoundSummary) => {
    const byTopic = new Map<string, number[]>();
    for (const o of summary.outcomes) {
      for (const t of o.drill.topic ? [o.drill.topic] : (dojo.topics ?? [])) {
        if (!byTopic.has(t)) byTopic.set(t, []);
        byTopic.get(t)!.push(o.result.score);
      }
    }
    const scores = Object.fromEntries(
      [...byTopic].map(([t, list]) => [t, roundScore(list.map((score) => ({ correct: score === 5, score: score as Score, feedback: '' })))]),
    );
    await updateSubject(
      s.id,
      (subj) => ({
        ...subj,
        topics: subj.topics.map((t) =>
          t.id in scores
            ? applyReview(t, { date: today(), score: scores[t.id], source: 'dojo', ...(drillSessionId.current ? { sessionId: drillSessionId.current } : {}) }, loaded.pack.settings)
            : t,
        ),
      }),
      { type: 'dojo.applied', ref: drillSessionId.current || dojo.id, data: { scores } },
    );
  };
  const NEW_DRILLS = 5;
  const writeDrills = () =>
    guard(async () => {
      const res = await run(dojoDrillsRequest({ ...base, sessionId: sessionId('drills', s.id), count: NEW_DRILLS }));
      const taken = new Set((dojo.drills ?? []).map((d) => d.id));
      const added = res.drills!.map((d) => {
        let id = d.id;
        for (let n = 2; taken.has(id); n++) id = `${d.id}-${n}`;
        taken.add(id);
        return { ...d, id };
      });
      await saveDojo(fs, { ...dojo, drills: [...(dojo.drills ?? []), ...added] });
      await log({ type: 'dojo.drills.add', subject: s.id, ref: dojo.id, actor: 'ai', data: { ids: added.map((d) => d.id) } });
      await reload();
      setNotice(`Added ${added.length} new exercises to "${dojo.title}".${res.summary ? ` ${res.summary}` : ''}`);
    });

  const trainsTopics = (dojo.drills ?? []).some((d) => d.topic && s.topics.some((t) => t.id === d.topic)) || !!dojo.topics?.length;

  return (
    <div class="stack">
      {hero(
        dojo.title,
        dojo.procedure,
        <>
          {dojo.description && <p class="dojo-hero-desc">{dojo.description}</p>}
          <div class="dojo-hero-tags">
            {dojo.drills?.length ? <span>{dojo.drills.length} exercises</span> : null}
            {(dojo.levels ?? []).map((l) => (
              <span>{LEVEL_LABEL[l]}</span>
            ))}
            {dojo.aids?.map((a) => (
              <span>Aid: {a}</span>
            ))}
          </div>
        </>,
      )}

      {dojo.drills?.length ? (
        <DrillPractice
          dojo={dojo}
          onStart={(round, lvl) => void log({ type: 'dojo.drill.start', subject: s.id, ref: dojo.id, data: { count: round.length, level: lvl } })}
          onFinish={saveRound}
          onApply={trainsTopics ? applyRound : undefined}
        />
      ) : (
        <div class="panel small muted">
          This dojo has no prepared exercises yet. Let the AI write some, or practise with AI-generated tasks below.
        </div>
      )}
      <div class="row small">
        <button class="small" onClick={writeDrills} disabled={busy}>
          + {NEW_DRILLS} new exercises with AI
        </button>
        <span class="muted">They are saved in the dojo, so the next rounds run without the AI.</span>
      </div>

      <div class="panel stack">
        <div class="row">
          <h3 style="flex:1">Free practice with AI</h3>
          <span class="small muted">The AI writes a fresh task and checks your solution step by step.</span>
        </div>
        <div class="row">
          <span class="small">Level</span>
          {levels.map((l) => (
            <button class={`small ${l === level ? 'primary' : ''}`} onClick={() => setLevel(l)} disabled={busy}>
              {LEVEL_LABEL[l]}
            </button>
          ))}
          <span style="flex:1" />
          <button class={session ? '' : 'primary'} onClick={newTask} disabled={busy}>
            {session ? 'New task' : 'Generate task'}
          </button>
        </div>
      </div>

      {error && <div class="error">{error}</div>}
      {panel}

      {item && (
        <>
          <div class="panel stack">
            <div class="row small">
              <h3 style="flex:1">Task</h3>
              <span class="badge">{LEVEL_LABEL[session!.level ?? level]}</span>
            </div>
            <Markdown text={item.prompt} />
          </div>
          <div class="panel stack">
            <h3>Your solution</h3>
            {dojo.answerFormat && <div class="small muted">Format: {dojo.answerFormat}</div>}
            <textarea
              class="mono"
              style="min-height:180px"
              value={item.answer ?? ''}
              onInput={(e) => setSession(patchItem({ answer: e.currentTarget.value }))}
              aria-label="Your solution"
            />
            <div class="row">
              <button class="primary" onClick={check} disabled={busy || !item.answer?.trim()}>
                Check
              </button>
              <button onClick={hint} disabled={busy}>
                Hint
              </button>
              <button onClick={solution} disabled={busy}>
                Show solution
              </button>
            </div>
          </div>

          {item.hints?.length ? (
            <div class="panel stack">
              <h3>Hints</h3>
              {item.hints.map((h, i) => (
                <div class="row" style="align-items:baseline">
                  <strong>{i + 1}.</strong>
                  <Markdown text={h} />
                </div>
              ))}
            </div>
          ) : null}

          {item.score !== undefined && (
            <div class="panel stack">
              <div class="row">
                <h3 style="flex:1">Check</h3>
                <span class={`score score-${item.score}`}>
                  {item.score}/5 · {SCORE_LABEL[item.score]}
                </span>
              </div>
              {item.steps && (
                <ul class="steps">
                  {item.steps.map((st) => (
                    <li>
                      <span style={{ color: st.ok ? 'var(--ok)' : 'var(--danger)' }}>{st.ok ? '✓' : '✗'}</span>
                      <span>
                        <strong>{st.label}</strong>
                        {st.comment && <span class="muted"> {st.comment}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {item.feedback && <div>{item.feedback}</div>}
              {dojo.topics?.length ? (
                session!.applied ? (
                  <div class="small muted">Saved to progress.</div>
                ) : (
                  <div>
                    <button class="small" onClick={apply}>
                      Save to progress ({dojo.topics.map((id) => s.topics.find((t) => t.id === id)?.title ?? id).join(', ')})
                    </button>
                  </div>
                )
              ) : null}
            </div>
          )}

          {item.solution && (
            <div class="panel stack">
              <h3>Model solution</h3>
              <Markdown text={item.solution} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
