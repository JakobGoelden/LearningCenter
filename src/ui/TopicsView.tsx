import { useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { formatShort, today } from '../lib/dates';
import { uniqueId } from '../lib/download';
import { applyReview, ladderIndex, ladderOf, withTopicDue } from '../scheduling/scheduler';
import type { Score, Topic, TopicStatus } from '../model/types';
import { SCORE_LABEL, TOPIC_STATUS } from './labels';
import { href } from './router';
import { BackLink } from './BackLink';

export function TopicsView({ subjectId }: { subjectId: string }) {
  const { subject, updateSubject, loaded } = usePack();
  const s = subject(subjectId);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  if (!s) return <div class="error">This pack has no subject "{subjectId}".</div>;
  const on = today();
  const settings = loaded.pack.settings;

  const patch = (id: string, change: Partial<Topic>, type: string, data?: Record<string, unknown>) =>
    updateSubject(
      s.id,
      (subj) => ({
        ...subj,
        topics: subj.topics.map((t) => {
          if (t.id !== id) return t;
          const next: Topic = { ...t, ...change };
          for (const k of Object.keys(next) as (keyof Topic)[]) if (next[k] === undefined) delete next[k];
          return next;
        }),
      }),
      { type, ref: id, data: data ?? (change as Record<string, unknown>) },
    );

  const setStatus = (t: Topic, status: TopicStatus) =>
    patch(t.id, status === 'skip' ? { status, due: undefined, intervalDays: undefined } : { status }, 'topic.status', { from: t.status, to: status });

  // A date set by hand applies to the topic and all its cards ("not before Thursday").
  const setDue = (t: Topic, due: string) =>
    updateSubject(
      s.id,
      (subj) => ({ ...subj, topics: subj.topics.map((x) => (x.id === t.id ? withTopicDue(x, due || undefined) : x)) }),
      { type: 'topic.due', ref: t.id, data: { from: t.due ?? null, to: due || null } },
    );

  const rate = (t: Topic, score: Score) =>
    updateSubject(
      s.id,
      (subj) => ({
        ...subj,
        topics: subj.topics.map((x) => (x.id === t.id ? applyReview(x, { date: on, score, source: 'manual' }, settings) : x)),
      }),
      { type: 'topic.review', ref: t.id, data: { score, source: 'manual' } },
    );

  const remove = (t: Topic) => {
    if (!confirm(`Delete topic "${t.title}" and its history?`)) return;
    void updateSubject(s.id, (subj) => ({ ...subj, topics: subj.topics.filter((x) => x.id !== t.id) }), {
      type: 'topic.remove',
      ref: t.id,
      data: { title: t.title },
    });
  };

  const add = (e: Event) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const id = uniqueId(t, s.topics.map((x) => x.id));
    const topic: Topic = { id, title: t, status: 'new', ...(notes.trim() ? { notes: notes.trim() } : {}) };
    setTitle('');
    setNotes('');
    void updateSubject(s.id, (subj) => ({ ...subj, topics: [...subj.topics, topic] }), {
      type: 'topic.add',
      ref: id,
      data: { title: t },
    });
  };

  const ladder = ladderOf(settings);

  return (
    <div class="stack">
      <div class="page-head subject-head" style={{ '--c': s.color }}>
        <BackLink href={href({ name: 'dashboard' })} label="Dashboard" />
        <h1>Topics: {s.name}</h1>
        <span class="spacer" />
        <a class="btn primary small" href={href({ name: 'quiz', subject: s.id })}>
          Start quiz
        </a>
      </div>
      <div class="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Topic</th>
              <th>Status</th>
              <th>Next review</th>
              <th>History</th>
              <th>Rate yourself</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.topics.map((t) => {
              const step = ladderIndex(ladder, t.intervalDays);
              return (
                <>
                  <tr key={t.id}>
                    <td>
                      <button
                        class="ghost small"
                        style="padding:0;text-align:left"
                        title="Show and edit notes"
                        aria-expanded={open === t.id}
                        onClick={() => setOpen(open === t.id ? null : t.id)}
                      >
                        <span class="muted">{open === t.id ? '▾' : '▸'}</span> <strong style="color:var(--text)">{t.title}</strong>
                      </button>
                    </td>
                    <td>
                      <select
                        value={t.status}
                        onChange={(e) => setStatus(t, e.currentTarget.value as TopicStatus)}
                        aria-label={`Status of ${t.title}`}
                      >
                        {(Object.keys(TOPIC_STATUS) as TopicStatus[]).map((st) => (
                          <option value={st}>{TOPIC_STATUS[st]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="date"
                        value={t.due ?? ''}
                        disabled={t.status === 'skip'}
                        onChange={(e) => setDue(t, e.currentTarget.value)}
                        aria-label={`Next review for ${t.title}`}
                        class={t.due && t.due < on ? 'overdue' : ''}
                      />
                      {t.intervalDays !== undefined && (
                        <div class="small muted">
                          Interval {t.intervalDays} d (step {step + 1}/{ladder.length})
                        </div>
                      )}
                    </td>
                    <td class="small">
                      {(t.history ?? []).slice(-5).map((h) => (
                        <span class={`score score-${h.score}`} title={`${formatShort(h.date)} · ${h.source}`} style="margin-right:3px">
                          {h.score}
                        </span>
                      ))}
                    </td>
                    <td>
                      <select
                        value=""
                        disabled={t.status === 'skip'}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          if (v !== '') void rate(t, Number(v) as Score);
                          e.currentTarget.value = '';
                        }}
                        aria-label={`Rate ${t.title} yourself`}
                      >
                        <option value="">–</option>
                        {SCORE_LABEL.map((l, i) => (
                          <option value={i}>
                            {i} · {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button class="ghost small danger" onClick={() => remove(t)} title="Delete topic">
                        ✕
                      </button>
                    </td>
                  </tr>
                  {open === t.id && (
                    <tr>
                      <td colSpan={6}>
                        <label class="field">
                          <span>Notes (help the AI ask good questions)</span>
                          <textarea
                            style="min-height:70px"
                            value={t.notes ?? ''}
                            onChange={(e) => patch(t.id, { notes: e.currentTarget.value || undefined }, 'topic.notes', {})}
                          />
                        </label>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      <form class="panel stack" onSubmit={add}>
        <h3>Add topic</h3>
        <div class="row">
          <input placeholder="Title" value={title} onInput={(e) => setTitle(e.currentTarget.value)} style="flex:1" aria-label="Title" />
          <input placeholder="Notes (optional)" value={notes} onInput={(e) => setNotes(e.currentTarget.value)} style="flex:2" aria-label="Notes" />
          <button class="primary" type="submit">
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
