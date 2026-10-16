import { useMemo, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { formatShort, nowIso, today } from '../lib/dates';
import { applyReview, averageScore, pickQuizTopics } from '../scheduling/scheduler';
import { quizGradeRequest, quizStartRequest } from '../ai/requests';
import { saveSession } from '../storage/repo';
import type { Score, Session, SessionItem, Topic } from '../model/types';
import { Cancelled, useAi } from './AiPanel';
import { href } from './router';
import { SCORE_LABEL, TOPIC_STATUS } from './labels';

type Phase = 'setup' | 'answer' | 'results';

const KIND_LABEL: Record<string, string> = { why: 'Why', 'what-if': 'What if', explain: 'Explain', apply: 'Apply' };

export function sessionId(type: string, subject: string): string {
  return `${nowIso().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${type}-${subject}`;
}

export function QuizView({ subjectId }: { subjectId: string }) {
  const pack = usePack();
  const { fs, loaded, log, updateSubject, setNotice } = pack;
  const s = pack.subject(subjectId);
  const { run, busy, panel } = useAi();
  const on = today();
  const defaultCount = loaded.pack.settings?.questionsPerQuiz ?? 5;
  const [count, setCount] = useState(defaultCount);
  const candidates = useMemo(() => (s ? pickQuizTopics(s.topics, on, 30) : []), [s, on]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('setup');
  const [session, setSession] = useState<Session | null>(null);
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!s) return <div class="error">This pack has no subject "{subjectId}".</div>;
  const chosen = candidates.filter((t) => !excluded.has(t.id)).slice(0, count);
  const topicById = new Map(s.topics.map((t) => [t.id, t]));

  const persist = async (next: Session) => {
    setSession(next);
    try {
      await saveSession(fs, next);
    } catch (e) {
      setNotice(`Could not save the session: ${(e as Error).message}`);
    }
  };

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof Cancelled)) setError((e as Error).message);
    }
  };

  const start = () =>
    guard(async () => {
      const id = sessionId('quiz', s.id);
      const res = await run(quizStartRequest(loaded.pack, s, chosen, id));
      const items: SessionItem[] = res.questions!.map((q, i) => ({
        n: i + 1,
        ...(q.topicId && topicById.has(q.topicId) ? { topicId: q.topicId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        prompt: q.prompt,
      }));
      const next: Session = { id, type: 'quiz', subject: s.id, adapter: pack.ai.adapter, startedAt: nowIso(), items };
      await persist(next);
      await log({ type: 'quiz.start', subject: s.id, ref: id, data: { topics: items.map((i) => i.topicId ?? null) } });
      setIdx(0);
      setPhase('answer');
    });

  const setAnswer = (answer: string) => {
    if (!session) return;
    setSession({ ...session, items: session.items.map((it, i) => (i === idx ? { ...it, answer } : it)) });
  };

  const go = (to: number) =>
    guard(async () => {
      if (!session) return;
      await persist(session);
      const it = session.items[idx];
      await log({ type: 'quiz.answer', subject: s.id, ref: session.id, data: { n: it.n, topicId: it.topicId ?? null, chars: it.answer?.length ?? 0 } });
      setIdx(to);
    });

  const grade = () =>
    guard(async () => {
      if (!session) return;
      await persist(session);
      const res = await run(quizGradeRequest(loaded.pack, s, session.items, session.id));
      const byN = new Map(res.grades!.map((g) => [g.n, g]));
      const next: Session = {
        ...session,
        finishedAt: nowIso(),
        ...(res.summary ? { summary: res.summary } : {}),
        items: session.items.map((it) => {
          const g = byN.get(it.n);
          return g ? { ...it, score: g.score, feedback: g.feedback, ...(g.gaps?.length ? { gaps: g.gaps } : {}) } : it;
        }),
      };
      await persist(next);
      await log({ type: 'quiz.graded', subject: s.id, ref: session.id, actor: 'ai', data: { scores: next.items.map((i) => i.score ?? null) } });
      setPhase('results');
    });

  const apply = () =>
    guard(async () => {
      if (!session) return;
      const perTopic = new Map<string, Score[]>();
      for (const it of session.items) {
        if (it.topicId && it.score !== undefined) perTopic.set(it.topicId, [...(perTopic.get(it.topicId) ?? []), it.score]);
      }
      const scores = Object.fromEntries([...perTopic].map(([id, sc]) => [id, averageScore(sc)]));
      await updateSubject(
        s.id,
        (subj) => ({
          ...subj,
          topics: subj.topics.map((t) =>
            t.id in scores
              ? applyReview(t, { date: on, score: scores[t.id] as Score, source: 'quiz', sessionId: session.id }, loaded.pack.settings)
              : t,
          ),
        }),
        { type: 'quiz.applied', ref: session.id, data: { scores } },
      );
      await persist({ ...session, applied: true });
    });

  const item = session?.items[idx];
  const N = session?.items.length ?? 0;

  return (
    <div class="stack">
      <div class="page-head">
        <a href={href({ name: 'dashboard' })}>← Dashboard</a>
        <h1>Quiz: {s.name}</h1>
        <span class="spacer" />
        <a class="btn small" href={href({ name: 'topics', subject: s.id })}>
          Topics
        </a>
      </div>
      {error && <div class="error">{error}</div>}
      {panel}

      {phase === 'setup' && !busy && (
        <div class="panel stack">
          <div class="row">
            <label class="row">
              Number of questions
              <input type="number" min={1} max={30} value={count} style="width:70px" onInput={(e) => setCount(Math.max(1, Number(e.currentTarget.value) || 1))} />
            </label>
          </div>
          {candidates.length === 0 ? (
            <div class="muted">
              No topics to quiz. Add some under <a href={href({ name: 'topics', subject: s.id })}>Topics</a>.
            </div>
          ) : (
            <>
              <div class="small muted">Due and shaky topics first. Untick what you want to leave out today:</div>
              <ul class="list">
                {candidates.slice(0, count + excluded.size).map((t: Topic) => (
                  <li>
                    <label class="row grow" style="gap:6px">
                      <input
                        type="checkbox"
                        checked={!excluded.has(t.id)}
                        onChange={(e) => {
                          const next = new Set(excluded);
                          if (e.currentTarget.checked) next.delete(t.id);
                          else next.add(t.id);
                          setExcluded(next);
                        }}
                      />
                      {t.title}
                    </label>
                    <span class="small muted">
                      {TOPIC_STATUS[t.status]}
                      {t.due && ` · ${t.due < on ? 'overdue' : t.due === on ? 'today' : formatShort(t.due)}`}
                    </span>
                  </li>
                ))}
              </ul>
              <div>
                <button class="primary" disabled={chosen.length === 0} onClick={start}>
                  Start quiz with {chosen.length} {chosen.length === 1 ? 'question' : 'questions'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'answer' && item && !busy && (
        <div class="panel stack">
          <div class="row small">
            <span class="qnum">
              Question {item.n}/{N}
            </span>
            {item.topicId && <span class="badge">{topicById.get(item.topicId)?.title}</span>}
            {item.kind && <span class="badge">{KIND_LABEL[item.kind] ?? item.kind}</span>}
          </div>
          <div class="prompt">{item.prompt}</div>
          <textarea
            value={item.answer ?? ''}
            onInput={(e) => setAnswer(e.currentTarget.value)}
            placeholder="Your answer, in your own words …"
            aria-label={`Answer to question ${item.n}`}
            autoFocus
          />
          <div class="row">
            <button disabled={idx === 0} onClick={() => go(idx - 1)}>
              Back
            </button>
            <span class="spacer" style="flex:1" />
            {idx < N - 1 ? (
              <button class="primary" onClick={() => go(idx + 1)}>
                Next
              </button>
            ) : (
              <button class="primary" onClick={grade}>
                Submit and grade
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'results' && session && (
        <div class="stack">
          {session.summary && <div class="panel">{session.summary}</div>}
          {session.items.map((it) => (
            <div class="panel stack">
              <div class="row small">
                <span class="qnum">
                  Question {it.n}/{N}
                </span>
                {it.topicId && <span class="badge">{topicById.get(it.topicId)?.title}</span>}
                {it.score !== undefined && (
                  <span class={`score score-${it.score}`}>
                    {it.score}/5 · {SCORE_LABEL[it.score]}
                  </span>
                )}
              </div>
              <div>
                <strong>{it.prompt}</strong>
              </div>
              <div class="small muted" style="white-space:pre-wrap">
                {it.answer || '(no answer)'}
              </div>
              {it.feedback && <div>{it.feedback}</div>}
              {it.gaps && (
                <ul class="small">
                  {it.gaps.map((g) => (
                    <li>{g}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div class="panel row">
            {session.applied ? (
              <span>
                Saved. Next reviews:{' '}
                {[...new Set(session.items.map((i) => i.topicId).filter(Boolean))]
                  .map((id) => s.topics.find((t) => t.id === id))
                  .filter(Boolean)
                  .map((t) => `${t!.title} ${t!.due ? formatShort(t!.due) : '–'}`)
                  .join(' · ')}
              </span>
            ) : (
              <button class="primary" onClick={apply}>
                Save to progress
              </button>
            )}
            <span style="flex:1" />
            <a class="btn" href={href({ name: 'dashboard' })}>
              Back to dashboard
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
