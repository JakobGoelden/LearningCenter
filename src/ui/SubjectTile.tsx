import { useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { overview } from '../model/derive';
import { diffDays, formatShort, relative } from '../lib/dates';
import { uniqueId } from '../lib/download';
import type { ISODate, Subject, TopicStatus } from '../model/types';
import { CHECK_KIND, EXAM_FORMAT, NEXT_SHEET_STATUS, SHEET_STATUS, TOPIC_STATUS } from './labels';
import { href } from './router';

const STATUS_ORDER: TopicStatus[] = ['solid', 'shaky', 'new', 'skip'];

export function SubjectTile({ subject: s, on }: { subject: Subject; on: ISODate }) {
  const { updateSubject, loaded } = usePack();
  const o = overview(s, on);
  const total = s.topics.length || 1;
  const dojoCount = loaded.dojos.filter((d) => d.subject === s.id).length;
  const [newItem, setNewItem] = useState('');

  const exam = s.exam;
  const countdown =
    o.examInDays === null ? null : o.examInDays < 0 ? 'vorbei' : o.examInDays === 0 ? 'heute' : `in ${o.examInDays} Tagen`;

  const cycleSheet = (id: string) =>
    updateSubject(
      s.id,
      (subj) => ({
        ...subj,
        sheets: subj.sheets?.map((sh) => (sh.id === id ? { ...sh, status: NEXT_SHEET_STATUS[sh.status] } : sh)),
      }),
      {
        type: 'sheet.status',
        ref: id,
        data: { to: NEXT_SHEET_STATUS[s.sheets!.find((x) => x.id === id)!.status] },
      },
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

  const openItems = (s.openItems ?? []).filter((i) => !i.doneAt || i.doneAt === on);

  return (
    <article class="panel tile" style={{ '--c': s.color }}>
      <header>
        <div class="title">
          <h2>{s.name}</h2>
          <span class="badge">{EXAM_FORMAT[exam.format]}</span>
        </div>
        <div class="row small">
          {exam.date ? (
            <>
              <span>
                {formatShort(exam.date)}
                {exam.time && ` ${exam.time}`}
                {exam.location && ` · ${exam.location}`}
              </span>
              <span class={`badge countdown ${o.examInDays !== null && o.examInDays <= 14 ? 'danger' : ''}`}>{countdown}</span>
            </>
          ) : (
            <span class="muted">Termin noch offen</span>
          )}
        </div>
        {exam.aids && exam.aids.length > 0 && <div class="small muted">Hilfsmittel: {exam.aids.join(', ')}</div>}
        {exam.notes && <div class="small muted">{exam.notes}</div>}
      </header>

      <section>
        <h3>Lernstand</h3>
        <div class="statusbar" role="img" aria-label="Themen nach Status">
          {STATUS_ORDER.map((st) => (
            <span class={`st-${st}`} style={{ width: `${(o.statusCounts[st] / total) * 100}%` }} />
          ))}
        </div>
        <div class="legend">
          {STATUS_ORDER.map((st) =>
            o.statusCounts[st] ? (
              <span>
                <span class={`dot st-${st}`} />
                {o.statusCounts[st]} {TOPIC_STATUS[st]}
              </span>
            ) : null,
          )}
        </div>
        {o.due.length > 0 && (
          <ul class="list small">
            {o.due.map((t) => (
              <li>
                <span class="grow">{t.title}</span>
                <span class={t.due! < on ? 'overdue' : ''}>{t.due! < on ? `überfällig (${relative(t.due!, on)})` : 'heute'}</span>
              </li>
            ))}
          </ul>
        )}
        {o.upcoming.length > 0 && (
          <div class="small muted">
            Als Nächstes: {o.upcoming.map((t) => `${t.title} (${formatShort(t.due!)})`).join(' · ')}
          </div>
        )}
      </section>

      {(s.sheets?.length ?? 0) > 0 && (
        <section>
          <h3>Übungsblätter</h3>
          <span class="small muted">Klick schaltet weiter: offen → bearbeitet → geprüft</span>
          <div class="chips">
            {s.sheets!.map((sh) => {
              const late = sh.status === 'open' && sh.due && diffDays(on, sh.due) < 0;
              return (
                <button
                  class={`chip ${sh.status}${late ? ' late' : ''}`}
                  title={`${sh.label}: ${SHEET_STATUS[sh.status]}${sh.due ? `, fällig ${formatShort(sh.due)}` : ''} (klicken zum Weiterschalten)`}
                  onClick={() => cycleSheet(sh.id)}
                >
                  {sh.label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h3>Offene Punkte</h3>
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
            placeholder="Neuer Punkt …"
            value={newItem}
            onInput={(e) => setNewItem(e.currentTarget.value)}
            aria-label={`Neuer offener Punkt für ${s.name}`}
          />
        </form>
      </section>

      {(s.checks?.length ?? 0) > 0 && (
        <section>
          <h3>Letzte Checks</h3>
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
                  <span class={stale ? 'overdue' : 'muted'}>{c.lastChecked ? relative(c.lastChecked, on) : 'nie'}</span>
                  <button class="ghost small" title="Jetzt geprüft" onClick={() => markChecked(c.id)}>
                    ✓
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div class="actions">
        <a class="btn primary small" href={href({ name: 'quiz', subject: s.id })}>
          Abfrage
        </a>
        <a class="btn small" href={href({ name: 'dojo', subject: s.id })} aria-disabled={dojoCount === 0}>
          Dojo{dojoCount ? ` (${dojoCount})` : ''}
        </a>
        <a class="btn small" href={href({ name: 'topics', subject: s.id })}>
          Themen
        </a>
      </div>
    </article>
  );
}
