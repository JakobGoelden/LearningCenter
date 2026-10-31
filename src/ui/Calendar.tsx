import { useMemo } from 'preact/hooks';
import { addDays, diffDays, formatShort } from '../lib/dates';
import { longTermWeeks } from '../model/calendar';
import type { ISODate, LoadedPack, Subject } from '../model/types';
import { href } from './router';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayOfMonth = (d: ISODate) => Number(d.slice(8, 10));
const monthOf = (d: ISODate) => MONTHS[Number(d.slice(5, 7)) - 1];
const label = (s: Subject) => s.short ?? s.name;

/** Dashboard calendar: the semester as a timeline, with every exam date. */
export function Calendar({ loaded, today }: { loaded: LoadedPack; today: ISODate }) {
  const weeks = useMemo(() => longTermWeeks(loaded, today), [loaded, today]);
  const first = weeks[0].start;
  const days = weeks.length * 7;
  /** Horizontal position of a date, in % of the timeline. */
  const x = (d: ISODate) => (diffDays(first, d) / days) * 100;
  const sem = loaded.pack.semester;
  const lectureEnd = sem?.end && sem.end >= first && x(sem.end) < 100 ? addDays(sem.end, 1) : null;
  const months = weeks
    .flatMap((w) => Array.from({ length: 7 }, (_, i) => addDays(w.start, i)))
    .filter((d, i) => i === 0 || dayOfMonth(d) === 1);
  const exams = loaded.subjects
    .map((s) => ({ s, date: s.exam.date }))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  const weeksLeft = sem?.end ? Math.max(0, Math.ceil(diffDays(today, sem.end) / 7)) : null;

  return (
    <section class="panel cal-long" aria-label="Long term">
      <div class="cal-head">
        <h2>Long term</h2>
        <span class="muted small">
          {sem?.label ?? 'Semester'}
          {sem?.end && weeksLeft !== null
            ? ` · lectures end ${formatShort(sem.end)}${weeksLeft ? `, ${weeksLeft} ${weeksLeft === 1 ? 'week' : 'weeks'} left` : ''}`
            : ''}
        </span>
      </div>
      <div class="tl-scroll">
        <div class="tl" style={{ '--weeks': weeks.length }}>
          <div class="tl-labels">
            <span class="tl-axis-label" />
            {loaded.subjects.map((s) => (
              <a class="tl-label" style={{ '--c': s.color }} href={href({ name: 'subject', subject: s.id })} title={s.name}>
                {label(s)}
              </a>
            ))}
          </div>
          <div class="tl-body">
            <div class="tl-axis" aria-hidden="true">
              {months.map((d) => (
                <span class="tl-month" style={{ left: `${x(d)}%` }}>
                  {monthOf(d)}
                </span>
              ))}
              {weeks.map((w) => (
                <span class="tl-tick" style={{ left: `${x(w.start)}%` }}>
                  {dayOfMonth(w.start)}
                </span>
              ))}
            </div>
            <div class="tl-rows">
              {lectureEnd && (
                <div class="tl-free" style={{ left: `${x(lectureEnd)}%` }}>
                  <span>lecture-free</span>
                </div>
              )}
              {loaded.subjects.map((s) => (
                <div class="tl-row" style={{ '--c': s.color }}>
                  {weeks.map((w) =>
                    w.reviewsBy[s.id] ? (
                      <span
                        class="tl-load"
                        style={{ left: `${x(w.start)}%`, '--a': Math.min(1, 0.25 + w.reviewsBy[s.id] * 0.2) }}
                        title={`${s.name}: ${w.reviewsBy[s.id]} ${w.reviewsBy[s.id] === 1 ? 'card' : 'cards'} due in week ${w.week}`}
                      >
                        {w.reviewsBy[s.id]}
                      </span>
                    ) : null,
                  )}
                  {weeks.flatMap((w) =>
                    w.sheets
                      .filter((e) => e.subject.id === s.id)
                      .map((e) => (
                        <a
                          class="tl-sheet"
                          style={{ left: `${x(e.date)}%` }}
                          href={href({ name: 'sheet', subject: s.id, sheet: e.sheet! })}
                          title={`${s.name}: ${e.text} due ${formatShort(e.date)}`}
                        >
                          ✎
                        </a>
                      )),
                  )}
                  {s.exam.date && s.exam.date >= first && x(s.exam.date) < 100 && (
                    <a
                      class={`tl-exam${x(s.exam.date) > 80 ? ' end' : ''}`}
                      style={{ left: `${x(s.exam.date)}%` }}
                      href={href({ name: 'subject', subject: s.id })}
                      title={`${s.name} exam ${formatShort(s.exam.date)}${s.exam.time ? ` ${s.exam.time}` : ''}`}
                    >
                      ★ {dayOfMonth(s.exam.date)} {monthOf(s.exam.date)}
                    </a>
                  )}
                </div>
              ))}
              <span class="tl-today" style={{ left: `${x(today)}%` }} title="Today" />
            </div>
          </div>
        </div>
      </div>
      <div class="lt-legend small muted">
        <span>
          <i class="tl-swatch" /> cards due
        </span>
        <span>✎ sheet deadline</span>
        <span>★ exam</span>
        <span>
          <i class="tl-swatch-now" /> today
        </span>
      </div>
      {exams.length > 0 && (
        <div class="cal-todo">
          {exams.map(({ s, date }) => (
            <a class="cal-chip exam" style={{ '--c': s.color }} href={href({ name: 'subject', subject: s.id })}>
              ★ <b>{label(s)}</b>{' '}
              {date
                ? `${formatShort(date)}${s.exam.time ? ` ${s.exam.time}` : ''} · ${date >= today ? `in ${diffDays(today, date)} days` : 'done'}`
                : 'exam date unknown'}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
