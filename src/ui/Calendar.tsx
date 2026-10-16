import { useMemo, useState } from 'preact/hooks';
import { addDays, diffDays, formatShort, weekday } from '../lib/dates';
import { entriesOn, isoWeek, longTermWeeks, weekStart, type CalendarEntry, type CalendarWeek } from '../model/calendar';
import { EXAM_SOON_DAYS, isCheckStale } from '../model/derive';
import type { ISODate, LoadedPack, Subject } from '../model/types';
import { href, type Route } from './router';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dayOfMonth = (d: ISODate) => Number(d.slice(8, 10));
const monthOf = (d: ISODate) => MONTHS[Number(d.slice(5, 7)) - 1];
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
const label = (s: Subject) => s.short ?? s.name;

function targetOf(e: CalendarEntry, today: ISODate): Route {
  if (e.kind === 'reviews') return { name: 'quiz', subject: e.subject.id, ahead: e.date > today ? e.date : undefined };
  if (e.kind === 'sheet') return { name: 'sheet', subject: e.subject.id, sheet: e.sheet! };
  return { name: 'subject', subject: e.subject.id };
}

function entryTitle(e: CalendarEntry, today: ISODate): string {
  if (e.kind === 'reviews') return e.date > today ? 'Review ahead: start a quiz with these topics now' : 'Start a quiz';
  if (e.kind === 'sheet') return 'Open the sheet';
  return `Open ${e.subject.name}`;
}

/** A small coloured chip for all-day things (exam, reviews, sheet deadline). */
function Chip({ e, today }: { e: CalendarEntry; today: ISODate }) {
  const icon = e.kind === 'exam' ? '★ ' : e.kind === 'sheet' ? '✎ ' : '↻ ';
  return (
    <a
      class={`cal-chip ${e.kind}${e.urgent ? ' urgent' : ''}`}
      style={{ '--c': e.subject.color }}
      href={href(targetOf(e, today))}
      title={entryTitle(e, today)}
    >
      {icon}
      <b>{label(e.subject)}</b> {e.kind === 'exam' ? `Exam${e.time ? ` ${e.time}` : ''}` : e.text}
    </a>
  );
}

// ---------------------------------------------------------------------------

function TodayPanel({ loaded, today }: { loaded: LoadedPack; today: ISODate }) {
  const entries = entriesOn(loaded, today, today);
  const timed = entries.filter((e) => e.kind === 'class' || (e.kind === 'exam' && e.time));
  const todo = entries.filter((e) => !timed.includes(e));
  const soon = loaded.subjects
    .filter((s) => s.exam.date && s.exam.date > today && diffDays(today, s.exam.date) <= EXAM_SOON_DAYS)
    .map((s) => ({ s, days: diffDays(today, s.exam.date!) }));
  const stale = loaded.subjects.flatMap((s) => (s.checks ?? []).filter((c) => isCheckStale(c, today)).map((c) => ({ s, c })));
  const empty = !timed.length && !todo.length && !soon.length && !stale.length;

  return (
    <section class="panel cal-today" aria-label="Today">
      <div class="cal-head">
        <h2>Today</h2>
        <span class="muted small">
          {LONG_DAYS[weekday(today)]}, {dayOfMonth(today)} {monthOf(today)}
        </span>
      </div>
      {empty && <div class="muted small">Nothing planned. A good day to review ahead or practise in a dojo.</div>}
      {timed.length > 0 && (
        <ul class="cal-agenda">
          {timed.map((e) => (
            <li>
              <span class="time mono">
                {e.time}
                {e.end ? `–${e.end}` : ''}
              </span>
              <a class={`cal-slot ${e.kind}`} style={{ '--c': e.subject.color }} href={href(targetOf(e, today))}>
                <b>{label(e.subject)}</b> {e.kind === 'exam' ? 'Exam' : e.text}
              </a>
            </li>
          ))}
        </ul>
      )}
      {(todo.length > 0 || soon.length > 0 || stale.length > 0) && (
        <div class="cal-todo">
          {todo.map((e) => (
            <Chip e={e} today={today} />
          ))}
          {soon.map(({ s, days }) => (
            <a class={`cal-chip exam${days <= 3 ? ' urgent' : ''}`} style={{ '--c': s.color }} href={href({ name: 'subject', subject: s.id })}>
              ★ <b>{label(s)}</b> exam {days === 1 ? 'tomorrow' : `in ${days} days`}
            </a>
          ))}
          {stale.map(({ s, c }) => (
            <a class="cal-chip check" style={{ '--c': s.color }} href={href({ name: 'subject', subject: s.id })} title="This check is overdue">
              ⟳ <b>{label(s)}</b> check {c.label}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function WeekPanel({
  loaded,
  today,
  start,
  setStart,
}: {
  loaded: LoadedPack;
  today: ISODate;
  start: ISODate;
  setStart: (d: ISODate) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = days.map((d) => entriesOn(loaded, d, today));
  const current = weekStart(today);
  const timed = byDay.flat().filter((e) => e.kind === 'class' || (e.kind === 'exam' && e.time));
  // Visible hours: 8–18 at least, widened to fit every class.
  const from = Math.min(8 * 60, ...timed.map((e) => Math.floor(minutes(e.time!) / 60) * 60));
  const to = Math.max(18 * 60, ...timed.map((e) => Math.ceil(minutes(e.end ?? e.time!) / 60 + (e.end ? 0 : 1)) * 60));
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from / 60 + i);
  const pct = (m: number) => `${((m - from) / (to - from)) * 100}%`;
  const weekend = (d: ISODate) => weekday(d) === 0 || weekday(d) === 6;
  const title =
    start === current ? 'This week' : start === addDays(current, 7) ? 'Next week' : start === addDays(current, -7) ? 'Last week' : `Week ${isoWeek(start)}`;

  return (
    <section class="panel cal-week" aria-label={title}>
      <div class="cal-head">
        <h2>{title}</h2>
        <span class="muted small">
          {dayOfMonth(start)} {monthOf(start)} – {dayOfMonth(days[6])} {monthOf(days[6])} · week {isoWeek(start)}
        </span>
        <span class="cal-nav">
          {start !== current && (
            <button class="small" onClick={() => setStart(current)}>
              Today
            </button>
          )}
          <button class="small" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
            ‹
          </button>
          <button class="small" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
            ›
          </button>
        </span>
      </div>

      {/* Wide screens: a time grid, so free time is easy to spot. */}
      <div class="week-grid" style={{ '--hours': hours.length }}>
        <div class="wg-corner" />
        {days.map((d) => (
          <div class={`wg-day${d === today ? ' today' : ''}${d < today ? ' past' : ''}${weekend(d) ? ' weekend' : ''}`}>
            <span>{DAY_NAMES[weekday(d)]}</span> <b>{dayOfMonth(d)}</b>
          </div>
        ))}
        <div class="wg-corner" />
        {byDay.map((list, i) => (
          <div class={`wg-allday${days[i] < today ? ' past' : ''}`}>
            {list
              .filter((e) => e.kind !== 'class')
              .map((e) => (
                <Chip e={e} today={today} />
              ))}
          </div>
        ))}
        <div class="wg-hours">
          {hours.map((h) => (
            <span style={{ top: pct(h * 60) }}>{String(h).padStart(2, '0')}</span>
          ))}
        </div>
        {byDay.map((list, i) => (
          <div class={`wg-col${days[i] === today ? ' today' : ''}${days[i] < today ? ' past' : ''}${weekend(days[i]) ? ' weekend' : ''}`}>
            {hours.map((h) => (
              <span class="wg-line" style={{ top: pct(h * 60) }} />
            ))}
            {list
              .filter((e) => e.kind === 'class')
              .map((e) => (
                <a
                  class="wg-event"
                  style={{
                    '--c': e.subject.color,
                    top: pct(minutes(e.time!)),
                    height: `calc(${pct(minutes(e.end ?? e.time!) + (e.end ? 0 : 60))} - ${pct(minutes(e.time!))})`,
                  }}
                  href={href(targetOf(e, today))}
                  title={`${e.subject.name}: ${e.text}, ${e.time}–${e.end}`}
                >
                  <b>{label(e.subject)}</b>
                  <span>{e.text.split(' · ')[0]}</span>
                  <span class="t">
                    {e.time}–{e.end}
                  </span>
                </a>
              ))}
            {days[i] === today && <NowLine from={from} to={to} />}
          </div>
        ))}
      </div>

      {/* Narrow screens: one line per day. */}
      <ul class="week-list">
        {days.map((d, i) => (
          <li class={`${d === today ? 'today' : ''}${d < today ? ' past' : ''}`}>
            <div class="wl-day">
              <span>{DAY_NAMES[weekday(d)]}</span> <b>{dayOfMonth(d)}</b>
            </div>
            <div class="wl-entries">
              {byDay[i].length === 0 && <span class="muted small">{d < today ? '' : 'free'}</span>}
              {byDay[i].map((e) =>
                e.kind === 'class' ? (
                  <a class="cal-slot class" style={{ '--c': e.subject.color }} href={href(targetOf(e, today))}>
                    <span class="mono">{e.time}</span> <b>{label(e.subject)}</b> {e.text.split(' · ')[0]}
                  </a>
                ) : (
                  <Chip e={e} today={today} />
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NowLine({ from, to }: { from: number; to: number }) {
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  if (m < from || m > to) return null;
  return <span class="wg-now" style={{ top: `${((m - from) / (to - from)) * 100}%` }} />;
}

// ---------------------------------------------------------------------------

function LongTermPanel({
  loaded,
  today,
  selected,
  onPick,
}: {
  loaded: LoadedPack;
  today: ISODate;
  selected: ISODate;
  onPick: (start: ISODate) => void;
}) {
  const weeks = useMemo(() => longTermWeeks(loaded, today), [loaded, today]);
  const maxReviews = Math.max(1, ...weeks.map((w) => w.reviews));
  const exams = loaded.subjects
    .map((s) => ({ s, date: s.exam.date }))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  const sem = loaded.pack.semester;

  return (
    <section class="panel cal-long" aria-label="Long term">
      <div class="cal-head">
        <h2>Long term</h2>
        <span class="muted small">
          {sem?.label ?? 'Semester'}
          {sem?.end ? ` · lectures end ${formatShort(sem.end)} (${Math.max(0, Math.ceil(diffDays(today, sem.end) / 7))} weeks)` : ''}
        </span>
      </div>
      <div class="lt-weeks" role="list">
        {weeks.map((w, i) => (
          <WeekCell w={w} first={i === 0 || monthOf(w.start) !== monthOf(weeks[i - 1].start)} max={maxReviews} selected={w.start === selected} onPick={onPick} />
        ))}
      </div>
      <div class="lt-legend small muted">
        <span>
          <i class="lt-swatch reviews" /> reviews due
        </span>
        <span>✎ sheet deadline</span>
        <span>★ exam</span>
        <span>Click a week to see it above.</span>
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

function WeekCell({
  w,
  first,
  max,
  selected,
  onPick,
}: {
  w: CalendarWeek;
  first: boolean;
  max: number;
  selected: boolean;
  onPick: (start: ISODate) => void;
}) {
  const parts = [`Week ${w.week} from ${formatShort(w.start)}`];
  if (w.reviews) parts.push(`${w.reviews} reviews due`);
  for (const s of w.sheets) parts.push(`${s.subject.short ?? s.subject.name}: ${s.text} due ${formatShort(s.date)}`);
  for (const e of w.exams) parts.push(`${e.subject.name} exam ${formatShort(e.date)}`);
  return (
    <button
      role="listitem"
      class={`lt-week${selected ? ' selected' : ''}${w.outside ? ' outside' : ''}${w.exams.length ? ' has-exam' : ''}`}
      style={w.exams[0] ? { '--c': w.exams[0].subject.color } : undefined}
      onClick={() => onPick(w.start)}
      title={parts.join('\n')}
      aria-label={parts.join(', ')}
    >
      <span class="lt-month">{first ? monthOf(w.start) : ''}</span>
      <span class="lt-date">{dayOfMonth(w.start)}</span>
      <span class="lt-bar">
        <span style={{ height: `${(w.reviews / max) * 100}%` }} />
      </span>
      <span class="lt-marks">
        {w.sheets.map((s) => (
          <span class="lt-sheet" style={{ color: s.subject.color }}>
            ✎
          </span>
        ))}
        {w.exams.map((e) => (
          <span class="lt-exam" style={{ background: e.subject.color }}>
            ★{e.subject.short ?? ''}
          </span>
        ))}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

/** Dashboard calendar: today (top left), this week (top right), long term (below). */
export function Calendar({ loaded, today }: { loaded: LoadedPack; today: ISODate }) {
  const [start, setStart] = useState(() => weekStart(today));
  return (
    <div class="calendar">
      <TodayPanel loaded={loaded} today={today} />
      <WeekPanel loaded={loaded} today={today} start={start} setStart={setStart} />
      <LongTermPanel loaded={loaded} today={today} selected={start} onPick={setStart} />
    </div>
  );
}
