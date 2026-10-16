import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { formatShort, nowIso, today } from '../lib/dates';
import { applyReview, averageScore, isDue, pickQuizTopics } from '../scheduling/scheduler';
import { quizGradeRequest, quizStartRequest } from '../ai/requests';
import { saveSession } from '../storage/repo';
import type { Score, Session, SessionItem, Topic } from '../model/types';
import { questionFor, SELF_SCORE, type SelfRating } from '../model/quiz';
import { Markdown } from './Markdown';
import { Cancelled, useAi } from './AiPanel';
import { href } from './router';
import { SCORE_LABEL, TOPIC_STATUS } from './labels';
import { Stepper } from './Stepper';
import { ChatStart, copyText } from './ChatStart';
import { quizChatPrompt, quizGradeChatPrompt } from '../ai/chat';
import { BackLink } from './BackLink';

/** review: compare with the key points and grade yourself (quizzes run in the app). */
type Phase = 'setup' | 'answer' | 'review' | 'results';

const KIND_LABEL: Record<string, string> = { why: 'Why', 'what-if': 'What if', explain: 'Explain', apply: 'Apply' };

export function sessionId(type: string, subject: string): string {
  return `${nowIso()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}-${type}-${subject}`;
}

export interface QuizViewProps {
  subjectId: string;
  ahead?: string;
  /** Preset topic ids: skip the setup and start right away (Study mode). */
  topics?: string[];
  /** Replaces the page head (Study mode shows its own). */
  head?: ComponentChildren;
  /** Shown after saving instead of "Back to dashboard", e.g. the next Study block. */
  next?: { label: string; go: () => void };
}

export function QuizView({ subjectId, ahead, topics: preset, head, next: after }: QuizViewProps) {
  const pack = usePack();
  const { fs, loaded, log, updateSubject, setNotice } = pack;
  const s = pack.subject(subjectId);
  const { run, busy, panel } = useAi();
  const on = today();
  // Reviewing ahead: topics due by `ahead` are picked as if that day had come.
  const pickOn = ahead && ahead > on ? ahead : on;
  const candidates = useMemo(() => (s ? pickQuizTopics(s.topics, pickOn, s.topics.length) : []), [s, pickOn]);
  const due = candidates.filter((t) => isDue(t, pickOn)).length;
  // Everything due by default, else the usual quiz size.
  const [count, setCount] = useState(Math.max(1, Math.min(candidates.length, due || (loaded.pack.settings?.questionsPerQuiz ?? 5))));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('setup');
  const [session, setSession] = useState<Session | null>(null);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [cheer, setCheer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ratings, setRatings] = useState<Map<number, SelfRating>>(new Map());
  /** After the last answer: choose between checking yourself and checking in the chat. */
  const [checkMode, setCheckMode] = useState<'choose' | 'self'>('choose');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preset?.length && s) start();
  }, []);

  // Graded cards turn over one after another.
  useEffect(() => {
    if ((phase !== 'results' && phase !== 'review') || !session) return;
    const timers = session.items.map((it, i) => setTimeout(() => setFlipped((f) => new Set(f).add(it.n)), 350 + i * 220));
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  if (!s) return <div class="error">This pack has no subject "{subjectId}".</div>;
  const topicById = new Map(s.topics.map((t) => [t.id, t]));
  const chosen = preset
    ? preset.map((id) => topicById.get(id)).filter((t): t is Topic => !!t)
    : candidates.filter((t) => !excluded.has(t.id)).slice(0, count);

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

  /** Runs in the app with the topics' prepared questions, no AI needed. */
  const start = () =>
    guard(async () => {
      const id = sessionId('quiz', s.id);
      const items: SessionItem[] = chosen.map((t, i) => {
        const q = questionFor(t);
        return {
          n: i + 1,
          topicId: t.id,
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.id ? { question: q.id } : {}),
          prompt: q.prompt,
          ...(q.answer ? { solution: q.answer } : {}),
        };
      });
      const next: Session = { id, type: 'quiz', subject: s.id, adapter: 'app', startedAt: nowIso(), items };
      await persist(next);
      await log({
        type: 'quiz.start',
        subject: s.id,
        ref: id,
        data: { topics: items.map((i) => i.topicId ?? null), questions: 'prepared' },
      });
      setRatings(new Map());
      setCheckMode('choose');
      setIdx(0);
      setPhase('answer');
    });

  /** Lets the AI write fresh questions (needs the AI connection). */
  const startWithAi = () =>
    guard(async () => {
      const id = sessionId('quiz', s.id);
      const res = await run(quizStartRequest(loaded.pack, s, chosen, id));
      const items: SessionItem[] = res.questions!.map((q, i) => ({
        n: i + 1,
        ...(q.topicId && topicById.has(q.topicId) ? { topicId: q.topicId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        prompt: q.prompt,
      }));
      const next: Session = {
        id,
        type: 'quiz',
        subject: s.id,
        adapter: pack.ai.adapter,
        startedAt: nowIso(),
        items,
      };
      await persist(next);
      await log({
        type: 'quiz.start',
        subject: s.id,
        ref: id,
        data: { topics: items.map((i) => i.topicId ?? null) },
      });
      setIdx(0);
      setPhase('answer');
    });

  const setAnswer = (answer: string) => {
    if (!session) return;
    setSession({
      ...session,
      items: session.items.map((it, i) => (i === idx ? { ...it, answer } : it)),
    });
  };

  const go = (to: number) =>
    guard(async () => {
      if (!session) return;
      await persist(session);
      const it = session.items[idx];
      await log({
        type: 'quiz.answer',
        subject: s.id,
        ref: session.id,
        data: {
          n: it.n,
          topicId: it.topicId ?? null,
          chars: it.answer?.length ?? 0,
        },
      });
      setDir(to < idx ? 'back' : 'fwd');
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
      await log({
        type: 'quiz.graded',
        subject: s.id,
        ref: session.id,
        actor: 'ai',
        data: { scores: next.items.map((i) => i.score ?? null) },
      });
      setPhase('results');
    });

  const apply = (graded: Session | null = session) =>
    guard(async () => {
      const session = graded;
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
      if (averageScore(Object.values(scores) as Score[]) >= 4) setCheer(true);
    });

  const finish = () =>
    guard(async () => {
      if (!session) return;
      await persist({ ...session, finishedAt: nowIso() });
      setPhase('review');
    });

  const rate = (n: number, r: SelfRating) => setRatings(new Map(ratings).set(n, r));

  const saveSelf = () => {
    if (!session) return;
    const graded: Session = {
      ...session,
      items: session.items.map((it) => {
        const r = ratings.get(it.n);
        return r ? { ...it, score: SELF_SCORE[r] as Score } : it;
      }),
    };
    void log({
      type: 'quiz.graded',
      subject: s.id,
      ref: session.id,
      actor: 'user',
      data: { scores: graded.items.map((i) => i.score ?? null) },
    });
    return apply(graded);
  };

  const chatGradePrompt = () => (session ? quizGradeChatPrompt({ fs, pack: loaded.pack, session }) : '');
  /** Copies the prompt first (needs the click), then saves the quiz as waiting for the AI. */
  const gradeInChat = async () => {
    const ok = await copyText(chatGradePrompt());
    setCopied(ok);
    await gradeLater();
  };

  const gradeLater = () =>
    guard(async () => {
      if (!session) return;
      await persist({ ...session, finishedAt: nowIso(), gradeLater: true });
      await log({ type: 'quiz.gradeLater', subject: s.id, ref: session.id, data: { answers: session.items.length } });
    });

  const canAskAi = pack.ai.adapter !== 'copy-prompt';
  const local = session?.adapter === 'app';
  const settled = !!session && !!(session.applied || session.gradeLater);

  const doneRow = (sess: Session) => (
    <div class="panel row quiz-actions">
      {sess.applied ? (
        <span>
          Saved. Next reviews:{' '}
          {[...new Set(sess.items.map((i) => i.topicId).filter(Boolean))]
            .map((id) => s.topics.find((t) => t.id === id))
            .filter(Boolean)
            .map((t) => `${t!.title} ${t!.due ? formatShort(t!.due) : '–'}`)
            .join(' · ')}
        </span>
      ) : (
        <span class="stack" style="gap:6px">
          <span>
            {copied
              ? 'Saved. The prompt is copied: paste it into your AI chat and go through the answers together.'
              : 'Saved. Copy the prompt and paste it into your AI chat to go through the answers together.'}{' '}
            <span class="muted">If you do it later, the dashboard banner has the prompt too.</span>
          </span>
          {local && <ChatStart label={copied ? 'Copy prompt again' : 'Copy prompt'} prompt={chatGradePrompt} />}
        </span>
      )}
      {cheer && <Cheer />}
      <span style="flex:1" />
      {after ? (
        <button class="primary" onClick={after.go}>
          {after.label}
        </button>
      ) : (
        <a class="btn" href={href({ name: 'dashboard' })}>
          Back to dashboard
        </a>
      )}
    </div>
  );

  const item = session?.items[idx];
  const N = session?.items.length ?? 0;

  return (
    <div class="stack">
      {head ?? (
        <div class="page-head subject-head" style={{ '--c': s.color }}>
          <BackLink href={href({ name: 'dashboard' })} label="Dashboard" />
          <h1>Quiz: {s.name}</h1>
          <span class="spacer" />
          <a class="btn small" href={href({ name: 'topics', subject: s.id })}>
            Topics
          </a>
        </div>
      )}
      {error && <div class="error">{error}</div>}
      {panel}

      {phase === 'setup' && !busy && !preset && (
        <div class="panel stack">
          <div class="row">
            <span>Number of questions</span>
            <Stepper value={count} onChange={setCount} min={1} max={Math.max(1, candidates.length)} label="Questions" />
            {due > 0 && count !== due && (
              <button class="small all-due" onClick={() => setCount(due)}>
                All due ({due})
              </button>
            )}
          </div>
          {candidates.length === 0 ? (
            <div class="muted">
              No topics to quiz. Add some under <a href={href({ name: 'topics', subject: s.id })}>Topics</a>.
            </div>
          ) : (
            <>
              <div class="small muted">
                {pickOn > on
                  ? `Reviewing ahead: topics due by ${formatShort(pickOn)} come first. Untick what you want to leave out:`
                  : 'Due and shaky topics first. Untick what you want to leave out today:'}
              </div>
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
              <div class="start-row">
                <button class="primary" disabled={chosen.length === 0} onClick={start}>
                  Start here · {chosen.length} {chosen.length === 1 ? 'question' : 'questions'}
                </button>
                <ChatStart
                  disabled={chosen.length === 0}
                  prompt={() => quizChatPrompt({ fs, pack: loaded.pack, blocks: [{ subject: s, topics: chosen }] })}
                />
                {canAskAi && (
                  <button
                    class="ghost"
                    disabled={chosen.length === 0}
                    onClick={startWithAi}
                    title="The AI writes new questions for these topics"
                  >
                    or fresh questions from the AI
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'setup' && !busy && preset && error && (
        <div class="panel row">
          <button class="primary" onClick={start}>
            Try again
          </button>
        </div>
      )}

      {phase === 'answer' && item && session && !busy && (
        <div class={`quiz-deck left-${Math.min(N - idx - 1, 2)}`} style={{ '--c': s.color }}>
          <div class="quiz-dots" aria-hidden="true">
            {session.items.map((it, i) => (
              <span class={i === idx ? 'now' : it.answer?.trim() ? 'done' : ''} />
            ))}
          </div>
          <div key={idx} class={`panel stack quiz-card ${dir}`}>
            <div class="row small">
              <span class="qnum">
                Question {item.n}/{N}
              </span>
              {item.topicId && <span class="badge">{topicById.get(item.topicId)?.title}</span>}
              {item.kind && <span class="badge">{KIND_LABEL[item.kind] ?? item.kind}</span>}
            </div>
            <div class="prompt">
              <Markdown text={item.prompt} />
            </div>
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
                <button class="primary" onClick={local ? finish : grade}>
                  {local ? 'Finish' : 'Submit and grade'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'review' && session && (
        <div class="stack">
          {session.gradeLater && !session.applied && doneRow(session)}
          {!settled && checkMode === 'choose' ? (
            <div class="check-choice">
              <button class="check-option" onClick={() => setCheckMode('self')}>
                <span class="check-option-icon" aria-hidden="true">
                  ✓
                </span>
                <strong>Check myself</strong>
                <span class="small muted">Flip the cards, compare with the key points, rate each answer.</span>
              </button>
              <button class="check-option chat" onClick={gradeInChat}>
                <span class="check-option-icon" aria-hidden="true">
                  💬
                </span>
                <strong>Check in chat</strong>
                <span class="small muted">Copies a prompt. Your AI goes through the answers with you, voice included.</span>
              </button>
              {canAskAi && (
                <button class="ghost small check-ai-now" onClick={grade}>
                  or let the AI grade right now
                </button>
              )}
            </div>
          ) : (
            !settled && (
              <div class="panel small muted">
                Compare your answers with the key points and rate each one.{' '}
                <button class="link" onClick={() => setCheckMode('choose')}>
                  Check in chat instead
                </button>
              </div>
            )
          )}
          {(settled || checkMode === 'self') && (
            <div class="flip-grid">
              {session.items.map((it) => {
                const open = flipped.has(it.n);
                const r = ratings.get(it.n);
                const toggle = () => {
                  const f = new Set(flipped);
                  if (open) f.delete(it.n);
                  else f.add(it.n);
                  setFlipped(f);
                };
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    class={`flip-card${open ? ' open' : ''}`}
                    style={{ '--c': s.color }}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        toggle();
                      }
                    }}
                    aria-pressed={open}
                    aria-label={`Question ${it.n}: ${open ? 'show the question' : 'show the key points'}`}
                  >
                    <span class="flip-inner">
                      <span class="flip-face front panel">
                        <span class="row small">
                          <span class="qnum">
                            Question {it.n}/{N}
                          </span>
                          {it.topicId && <span class="badge">{topicById.get(it.topicId)?.title}</span>}
                        </span>
                        <Markdown text={it.prompt} />
                        <span class="small muted answer">{it.answer || '(no answer)'}</span>
                        <span class="flip-hint small muted">Tap to compare</span>
                      </span>
                      <span class={`flip-face back panel score-face-${r ? SELF_SCORE[r] : 'none'}`}>
                        <span class="row small">
                          <span class="qnum">
                            Question {it.n}/{N}
                          </span>
                          {it.topicId && <span class="badge">{topicById.get(it.topicId)?.title}</span>}
                        </span>
                        <span class="small muted answer">You: {it.answer || '(no answer)'}</span>
                        {it.solution ? (
                          <span class="key-points">
                            <strong class="small">Key points</strong>
                            <Markdown text={it.solution} />
                          </span>
                        ) : (
                          <span class="small muted">No key points for this question. Check it against your script or notes.</span>
                        )}
                        {!session.applied && !session.gradeLater && (
                          <span class="rate" onClick={(e) => e.stopPropagation()}>
                            {(['right', 'partly', 'wrong'] as SelfRating[]).map((k) => (
                              <button
                                type="button"
                                class={`rate-${k}${r === k ? ' on' : ''}`}
                                aria-pressed={r === k}
                                onClick={() => rate(it.n, k)}
                              >
                                {k === 'right' ? '✓ Right' : k === 'partly' ? '~ Partly' : '✗ Wrong'}
                              </button>
                            ))}
                          </span>
                        )}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {settled
            ? session.applied && doneRow(session)
            : checkMode === 'self' && (
                <div class="panel row quiz-actions">
                  <button class="primary" disabled={ratings.size < N} onClick={saveSelf}>
                    Save to progress{ratings.size < N ? ` (${ratings.size}/${N} graded)` : ''}
                  </button>
                </div>
              )}
        </div>
      )}

      {phase === 'results' && session && (
        <div class="stack">
          {session.summary && <div class="panel">{session.summary}</div>}
          <div class="flip-grid">
            {session.items.map((it) => {
              const open = flipped.has(it.n);
              const toggle = () => {
                const f = new Set(flipped);
                if (open) f.delete(it.n);
                else f.add(it.n);
                setFlipped(f);
              };
              return (
                <div
                  role="button"
                  tabIndex={0}
                  class={`flip-card${open ? ' open' : ''}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle();
                    }
                  }}
                  style={{ '--c': s.color }}
                  onClick={toggle}
                  aria-pressed={open}
                  aria-label={`Question ${it.n}: ${open ? 'show your answer' : 'show the grade'}`}
                >
                  <span class="flip-inner">
                    <span class="flip-face front panel">
                      <span class="row small">
                        <span class="qnum">
                          Question {it.n}/{N}
                        </span>
                        {it.topicId && <span class="badge">{topicById.get(it.topicId)?.title}</span>}
                      </span>
                      <strong>{it.prompt}</strong>
                      <span class="small muted answer">{it.answer || '(no answer)'}</span>
                      <span class="flip-hint small muted">Tap to see the grade</span>
                    </span>
                    <span class={`flip-face back panel score-face-${it.score ?? 'none'}`}>
                      <span class="row small">
                        <span class="qnum">
                          Question {it.n}/{N}
                        </span>
                        {it.score !== undefined && (
                          <span class={`score score-${it.score}`}>
                            {it.score}/5 · {SCORE_LABEL[it.score]}
                          </span>
                        )}
                      </span>
                      <span class="small muted">{it.prompt}</span>
                      {it.feedback && <span>{it.feedback}</span>}
                      {it.gaps && (
                        <ul class="small">
                          {it.gaps.map((g) => (
                            <li>{g}</li>
                          ))}
                        </ul>
                      )}
                      <span class="flip-hint small muted">Tap to see your answer</span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          {session.applied ? (
            doneRow(session)
          ) : (
            <div class="panel row quiz-actions">
              <button class="primary" onClick={() => apply()}>
                Save to progress
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A short burst of confetti after a good round. */
export function Cheer() {
  const colors = ['var(--accent)', 'var(--gold)', 'var(--vermilion)', 'var(--st-solid)', '#8b5cf6'];
  return (
    <span class="cheer" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i
          style={{
            '--a': `${i * 22.5 + (i % 2) * 9}deg`,
            '--d': `${38 + (i % 3) * 16}px`,
            background: colors[i % colors.length],
          }}
        />
      ))}
    </span>
  );
}
