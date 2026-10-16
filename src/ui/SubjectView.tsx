import { useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { overview } from '../model/derive';
import { diffDays, formatShort, relative, today } from '../lib/dates';
import { uniqueId } from '../lib/download';
import { CHECK_KIND, CLASS_KIND, EXAM_FORMAT, SHEET_STATUS, WEEKDAY_LABEL } from './labels';
import type { Weekday } from '../model/types';
import { href } from './router';
import { StatusBar } from './StatusBar';

/** Full detail page for one subject, opened from its dashboard banner. */
export function SubjectView({ subjectId }: { subjectId: string }) {
  const { updateSubject, loaded, subject } = usePack();
  const [newItem, setNewItem] = useState('');
  const s = subject(subjectId);
  if (!s) return <div class="error">This pack has no subject "{subjectId}".</div>;
  const on = today();
  const o = overview(s, on);
  const dojoCount = loaded.dojos.filter((d) => d.subject === s.id).length;
  const exam = s.exam;
  const countdown =
    o.examInDays === null ? null : o.examInDays < 0 ? 'over' : o.examInDays === 0 ? 'today' : `in ${o.examInDays} days`;

  const DAYS = Object.keys(WEEKDAY_LABEL) as Weekday[];
  const schedule = [...(s.schedule ?? [])].sort(
    (a, b) => DAYS.indexOf(a.weekday) - DAYS.indexOf(b.weekday) || a.start.localeCompare(b.start),
  );

  const toggleItem = (id: string, done: boolean) =>
    updateSubject(
      s.id,
      (subj) => ({
        ...subj,
        openItems: subj.openItems?.map((i) => {
          if (i.id !== id) return i;
          const { doneAt: _, ...rest } = i;
          return done ? { ...rest, doneAt: on } : rest;
        }),
      }),
      { type: done ? 'openItem.done' : 'openItem.reopen', ref: id },
    );

  const addItem = (e: Event) => {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    const id = uniqueId(text, (s.openItems ?? []).map((i) => i.id));
    setNewItem('');
    void updateSubject(s.id, (subj) => ({ ...subj, openItems: [...(subj.openItems ?? []), { id, text, createdAt: on }] }), {
      type: 'openItem.add',
      ref: id,
      data: { text },
    });
  };

  const markChecked = (id: string) =>
    updateSubject(
      s.id,
      (subj) => ({ ...subj, checks: subj.checks?.map((c) => (c.id === id ? { ...c, lastChecked: on } : c)) }),
      { type: 'check.done', ref: id },
    );

  // Items ticked off today stay visible so a mis-click can be undone.
  const openItems = (s.openItems ?? []).filter((i) => !i.doneAt || i.doneAt === on);

  return (
    <div class="stack">
      <div class="page-head">
        <a href={href({ name: 'dashboard' })}>← Dashboard</a>
        <h1 style={{ borderLeft: `6px solid ${s.color ?? 'var(--accent)'}`, paddingLeft: '10px' }}>{s.name}</h1>
        <span class="spacer" />
        <a class="btn primary" href={href({ name: 'quiz', subject: s.id })}>
          Quiz
        </a>
        <a class="btn" href={href({ name: 'dojo', subject: s.id })}>
          Dojo{dojoCount ? ` (${dojoCount})` : ''}
        </a>
        <a class="btn" href={href({ name: 'topics', subject: s.id })}>
          Topics
        </a>
      </div>

      <div class="subject-grid">
        <section class="panel">
          <h3>Exam</h3>
          <div class="row">
            <strong>{EXAM_FORMAT[exam.format]}</strong>
            {countdown && (
              <span class={`badge countdown ${o.examInDays !== null && o.examInDays >= 0 && o.examInDays <= 14 ? 'danger' : ''}`}>
                {countdown}
              </span>
            )}
          </div>
          <div class="small">
            {exam.date ? (
              <>
                {formatShort(exam.date)}
                {exam.time && ` ${exam.time}`}
                {exam.durationMinutes && ` · ${exam.durationMinutes} min`}
                {exam.location && ` · ${exam.location}`}
              </>
            ) : (
              <span class="muted">Date not set yet</span>
            )}
          </div>
          {exam.aids && exam.aids.length > 0 && <div class="small">Allowed aids: {exam.aids.join(', ')}</div>}
          {exam.notes && <div class="small muted">{exam.notes}</div>}
        </section>

        <section class="panel">
          <h3>Progress</h3>
          <StatusBar counts={o.statusCounts} legend />
          {o.due.length > 0 ? (
            <ul class="list small">
              {o.due.map((t) => (
                <li>
                  <span class="grow">{t.title}</span>
                  <span class={t.due! < on ? 'overdue' : ''}>{t.due! < on ? `overdue (${relative(t.due!, on)})` : 'today'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div class="small muted">No reviews due.</div>
          )}
          {o.upcoming.length > 0 && (
            <div class="small muted">Next up: {o.upcoming.map((t) => `${t.title} (${formatShort(t.due!)})`).join(' · ')}</div>
          )}
        </section>

        <section class="panel">
          <h3>Exercise sheets</h3>
          {(s.sheets?.length ?? 0) > 0 ? (
            <>
              <div class="chips">
                {s.sheets!.map((sh) => {
                  const late = sh.status === 'open' && sh.due && diffDays(on, sh.due) < 0;
                  return (
                    <a
                      class={`chip ${sh.status}${late ? ' late' : ''}`}
                      title={`${sh.label}: ${SHEET_STATUS[sh.status]}${sh.due ? `, due ${formatShort(sh.due)}` : ''}`}
                      href={href({ name: 'sheet', subject: s.id, sheet: sh.id })}
                    >
                      {sh.label}
                    </a>
                  );
                })}
              </div>
              <span class="small muted">Click a sheet to open and solve it. Grey = open, amber = done, green = checked.</span>
            </>
          ) : (
            <div class="small muted">No sheets.</div>
          )}
        </section>

        <section class="panel">
          <h3>Open tasks</h3>
          {openItems.length > 0 && (
            <ul class="list small">
              {openItems.map((i) => (
                <li>
                  <label class="row grow" style="gap:6px;align-items:baseline">
                    <input type="checkbox" checked={!!i.doneAt} onChange={(e) => toggleItem(i.id, e.currentTarget.checked)} />
                    <span style={i.doneAt ? 'text-decoration:line-through' : ''}>{i.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <form class="row" onSubmit={addItem}>
            <input
              class="small"
              style="flex:1;min-width:0"
              placeholder="New task …"
              value={newItem}
              onInput={(e) => setNewItem(e.currentTarget.value)}
              aria-label={`New open task for ${s.name}`}
            />
          </form>
        </section>

        {schedule.length > 0 && (
          <section class="panel">
            <h3>Timetable</h3>
            <ul class="list small">
              {schedule.map((c) => (
                <li>
                  <span style="min-width:2.5em">{WEEKDAY_LABEL[c.weekday]}</span>
                  <span style="min-width:6.5em">
                    {c.start}–{c.end}
                  </span>
                  <span class="grow">
                    {CLASS_KIND[c.kind]}
                    {c.location && <span class="muted"> · {c.location}</span>}
                    {c.notes && <span class="muted"> · {c.notes}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(s.checks?.length ?? 0) > 0 && (
          <section class="panel">
            <h3>Last checks</h3>
            <ul class="list small">
              {s.checks!.map((c) => {
                const stale = o.staleChecks.includes(c);
                return (
                  <li>
                    <span class="grow">
                      {c.url && /^https?:\/\//.test(c.url) ? (
                        <a href={c.url} target="_blank" rel="noreferrer">
                          {c.label}
                        </a>
                      ) : (
                        <span title={c.url}>{c.label}</span>
                      )}
                      {c.version && <span class="muted"> {c.version}</span>}
                      <span class="muted"> · {CHECK_KIND[c.kind]}</span>
                    </span>
                    <span class={stale ? 'overdue' : 'muted'}>{c.lastChecked ? relative(c.lastChecked, on) : 'never'}</span>
                    <button class="ghost small" title="Checked now" aria-label={`Mark ${c.label} as checked`} onClick={() => markChecked(c.id)}>
                      ✓
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
