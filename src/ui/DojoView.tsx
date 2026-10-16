import { useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { nowIso, today } from '../lib/dates';
import { applyReview } from '../scheduling/scheduler';
import { dojoCheckRequest, dojoHintRequest, dojoSolutionRequest, dojoTaskRequest, LEVEL_LABEL } from '../ai/requests';
import { saveSession } from '../storage/repo';
import type { Level, Session, SessionItem } from '../model/types';
import { Cancelled, useAi } from './AiPanel';
import { Markdown } from './Markdown';
import { href } from './router';
import { sessionId } from './QuizView';
import { SCORE_LABEL } from './labels';

const ALL_LEVELS: Level[] = ['easy', 'medium', 'exam'];

export function DojoView({ subjectId, dojoId }: { subjectId: string; dojoId?: string }) {
  const pack = usePack();
  const { fs, loaded, log, updateSubject, setNotice } = pack;
  const s = pack.subject(subjectId);
  const dojos = loaded.dojos.filter((d) => d.subject === subjectId);
  const dojo = dojos.find((d) => d.id === dojoId);
  const { run, busy, panel } = useAi();
  const levels = dojo?.levels?.length ? dojo.levels : ALL_LEVELS;
  const [level, setLevel] = useState<Level>(levels[Math.min(1, levels.length - 1)]);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!s) return <div class="error">Fach „{subjectId}“ gibt es in diesem Pack nicht.</div>;

  const head = (title: string) => (
    <div class="page-head">
      <a href={dojo ? href({ name: 'dojo', subject: s.id }) : href({ name: 'dashboard' })}>← {dojo ? 'Alle Dojos' : 'Dashboard'}</a>
      <h1>{title}</h1>
    </div>
  );

  if (!dojo) {
    return (
      <div class="stack">
        {head(`Dojos: ${s.name}`)}
        {dojoId && <div class="error">Dojo „{dojoId}“ gibt es nicht.</div>}
        {dojos.length === 0 ? (
          <div class="panel muted">
            Für dieses Fach gibt es noch keine Dojos. Lege eine Datei unter <code>dojos/</code> an (Vorlagen in{' '}
            <code>packs/dojo-library</code>) und trage die ID in <code>pack.json</code> ein.
          </div>
        ) : (
          <div class="cards">
            {dojos.map((d) => (
              <a class="panel card-link" href={href({ name: 'dojo', subject: s.id, dojo: d.id })}>
                <h2>{d.title}</h2>
                <div class="small muted">{d.procedure}</div>
                {d.description && <div class="small">{d.description}</div>}
                {d.aids?.length ? <div class="small muted">Hilfsmittel: {d.aids.join(', ')}</div> : null}
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
      setNotice(`Sitzung konnte nicht gespeichert werden: ${(e as Error).message}`);
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

  return (
    <div class="stack">
      {head(dojo.title)}
      <div class="panel stack">
        <div class="small muted">
          {s.name} · {dojo.procedure}
          {dojo.aids?.length ? ` · Hilfsmittel: ${dojo.aids.join(', ')}` : ''}
        </div>
        {dojo.description && <div>{dojo.description}</div>}
        <div class="row">
          <span class="small">Niveau</span>
          {levels.map((l) => (
            <button class={`small ${l === level ? 'primary' : ''}`} onClick={() => setLevel(l)} disabled={busy}>
              {LEVEL_LABEL[l]}
            </button>
          ))}
          <span style="flex:1" />
          <button class={session ? '' : 'primary'} onClick={newTask} disabled={busy}>
            {session ? 'Neue Aufgabe' : 'Aufgabe erzeugen'}
          </button>
        </div>
      </div>

      {error && <div class="error">{error}</div>}
      {panel}

      {item && (
        <>
          <div class="panel stack">
            <div class="row small">
              <h3 style="flex:1">Aufgabe</h3>
              <span class="badge">{LEVEL_LABEL[session!.level ?? level]}</span>
            </div>
            <Markdown text={item.prompt} />
          </div>
          <div class="panel stack">
            <h3>Deine Lösung</h3>
            {dojo.answerFormat && <div class="small muted">Format: {dojo.answerFormat}</div>}
            <textarea
              class="mono"
              style="min-height:180px"
              value={item.answer ?? ''}
              onInput={(e) => setSession(patchItem({ answer: e.currentTarget.value }))}
              aria-label="Deine Lösung"
            />
            <div class="row">
              <button class="primary" onClick={check} disabled={busy || !item.answer?.trim()}>
                Prüfen
              </button>
              <button onClick={hint} disabled={busy}>
                Tipp
              </button>
              <button onClick={solution} disabled={busy}>
                Musterlösung
              </button>
            </div>
          </div>

          {item.hints?.length ? (
            <div class="panel stack">
              <h3>Tipps</h3>
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
                <h3 style="flex:1">Prüfung</h3>
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
                  <div class="small muted">In den Lernstand übernommen.</div>
                ) : (
                  <div>
                    <button class="small" onClick={apply}>
                      In Lernstand übernehmen ({dojo.topics.map((id) => s.topics.find((t) => t.id === id)?.title ?? id).join(', ')})
                    </button>
                  </div>
                )
              ) : null}
            </div>
          )}

          {item.solution && (
            <div class="panel stack">
              <h3>Musterlösung</h3>
              <Markdown text={item.solution} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
