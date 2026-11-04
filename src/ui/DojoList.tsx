import { useEffect, useMemo, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { listSessions, loadSession } from '../storage/repo';
import { diffDays, today } from '../lib/dates';
import { dojoMastery, drillHistory, practiceNeed, type DrillHistory, type Mastery } from '../dojo/mastery';
import { examDrills, PRACTICE_EXAM } from '../dojo/exam';
import { LEVEL_LABEL } from '../ai/requests';
import type { Dojo, Level, Session, Subject } from '../model/types';
import { href } from './router';
import { Torii } from './Emblem';

/** Drill rounds of a subject from sessions/, read again whenever `again` changes. Null while loading. */
export function useDrillHistory(subjectId: string, dojos: Dojo[], again: unknown): DrillHistory | null {
  const { fs } = usePack();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const ids = (await listSessions(fs).catch(() => [])).filter((id) => id.endsWith(`-drill-${subjectId}`));
      const read = await Promise.all(ids.map((id) => loadSession(fs, id).catch(() => null)));
      if (live) setSessions(read.filter((x): x is Session => !!x));
    })();
    return () => {
      live = false;
    };
  }, [fs, subjectId, again]);
  return useMemo(() => (sessions ? drillHistory(sessions, dojos) : null), [sessions, dojos]);
}

/** Starred dojos, kept in pack.json so they follow the learner to every device. */
export function useFavorites() {
  const { loaded, updatePack, setNotice } = usePack();
  const favorites = loaded.pack.settings?.favoriteDojos ?? [];
  const toggle = (id: string) => {
    const on = !favorites.includes(id);
    updatePack(
      (p) => {
        const current = p.settings?.favoriteDojos ?? [];
        const next = on ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id);
        const { favoriteDojos: _old, ...rest } = p.settings ?? {};
        return { ...p, settings: next.length ? { ...rest, favoriteDojos: next } : rest };
      },
      { type: 'dojo.favorite', ref: id, data: { favorite: on } },
    ).catch((e: unknown) => setNotice(`Could not save the favorite: ${(e as Error).message}`));
  };
  return { favorites, toggle };
}

export function StarButton({ on, onToggle, class: cls = '' }: { on: boolean; onToggle: () => void; class?: string }) {
  return (
    <button
      type="button"
      class={`star${on ? ' on' : ''} ${cls}`}
      aria-pressed={on}
      title={on ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const ago = (date: string | undefined, on: string) => {
  if (!date) return 'never practiced';
  const d = diffDays(date, on);
  return d === 0 ? 'practiced today' : d === 1 ? 'practiced yesterday' : `practiced ${d} days ago`;
};

/** Mastery as a bar with the numbers behind it. */
export function MasteryBar({ m, on, compact = false }: { m: Mastery; on: string; compact?: boolean }) {
  const tone = m.score >= 0.8 ? 'good' : m.score >= 0.5 ? 'mid' : 'low';
  return (
    <div class={`mastery ${tone}`} title="Mastery: recent scores of every exercise, exam level counts most, fades without practice">
      <div class="mastery-head">
        <strong>{pct(m.score)}</strong>
        <span class="small">
          mastery · {m.tried}/{m.total} tried{compact ? '' : ` · ${ago(m.last, on)}`}
        </span>
      </div>
      <div class="mastery-track">
        <div class="mastery-fill" style={{ width: pct(m.score).replace(' ', '') }} />
      </div>
      {!compact && Object.keys(m.levels).length > 1 && (
        <div class="mastery-levels small">
          {(['easy', 'medium', 'exam'] as Level[])
            .filter((l) => m.levels[l] !== undefined)
            .map((l) => (
              <span>
                {LEVEL_LABEL[l]} {pct(m.levels[l]!)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

type Order = 'need' | 'course';
const ORDER_KEY = 'lc.dojoOrder';
const readOrder = (): Order => {
  try {
    return localStorage.getItem(ORDER_KEY) === 'course' ? 'course' : 'need';
  } catch {
    return 'need';
  }
};

/** How many dojos get the "practice next" mark. */
const NEXT_COUNT = 3;

export function DojoList({ subject: s, dojos, examMinutes }: { subject: Subject; dojos: Dojo[]; examMinutes: number }) {
  const on = today();
  const history = useDrillHistory(s.id, dojos, null);
  const { favorites, toggle } = useFavorites();
  const [order, setOrderState] = useState<Order>(readOrder);
  const setOrder = (o: Order) => {
    setOrderState(o);
    try {
      localStorage.setItem(ORDER_KEY, o);
    } catch {
      // private window: the choice just isn't remembered
    }
  };

  const rows = useMemo(() => {
    const out = dojos.map((d, i) => {
      const m = history ? dojoMastery(d, history, on) : null;
      return { d, i, m, need: m ? practiceNeed(d, m, dojos) : 0, fav: favorites.includes(d.id) };
    });
    const next = new Set(
      [...out]
        .filter((r) => r.m && r.m.score < 0.9 && r.d.drills?.length)
        .sort((a, b) => b.need - a.need)
        .slice(0, NEXT_COUNT)
        .map((r) => r.d.id),
    );
    out.sort((a, b) => Number(b.fav) - Number(a.fav) || (order === 'need' && history ? b.need - a.need : 0) || a.i - b.i);
    return out.map((r) => ({ ...r, next: next.has(r.d.id) }));
  }, [dojos, history, favorites, order, on]);

  return (
    <>
      <div class="row dojo-list-bar">
        <span class="small muted">
          {history ? 'Mastery = recent scores of all exercises, exam level counts most; it fades without practice.' : 'Reading your rounds…'}
        </span>
        <span class="spacer" style="flex:1" />
        <div class="segmented" role="group" aria-label="Order">
          <button class={order === 'need' ? 'primary' : ''} onClick={() => setOrder('need')}>
            Practice next
          </button>
          <button class={order === 'course' ? 'primary' : ''} onClick={() => setOrder('course')}>
            Course order
          </button>
        </div>
      </div>
      <div class="cards">
        {dojos.some((d) => examDrills(d).length) && (
          <a class="dojo-card exam-card" style={{ '--c': s.color }} href={href({ name: 'dojo', subject: s.id, dojo: PRACTICE_EXAM })}>
            <Torii class="dojo-card-torii" />
            <h2>Practice exam</h2>
            <span class="dojo-card-count">{dojos.reduce((n, d) => n + examDrills(d).length, 0)} exam tasks</span>
            <div class="small muted">Exam-level tasks from all dojos, mixed like the real exam, {examMinutes} minutes.</div>
          </a>
        )}
        {rows.map(({ d, m, fav, next }) => (
          <div class={`dojo-card${fav ? ' fav' : ''}`} style={{ '--c': s.color }}>
            <Torii class="dojo-card-torii" />
            <h2 class="dojo-card-title">
              <StarButton on={fav} onToggle={() => toggle(d.id)} class="dojo-card-star" />
              <a class="dojo-card-link" href={href({ name: 'dojo', subject: s.id, dojo: d.id })}>
                {d.title}
              </a>
            </h2>
            <span class="dojo-card-tags">
              {d.drills?.length ? <span class="dojo-card-count">{d.drills.length} exercises</span> : null}
              {next && <span class="dojo-card-next">Practice next</span>}
            </span>
            {m && d.drills?.length ? <MasteryBar m={m} on={on} /> : null}
            <div class="small muted">{d.procedure}</div>
            {d.description && <div class="small">{d.description}</div>}
            {d.aids?.length ? <div class="small muted">Aids: {d.aids.join(', ')}</div> : null}
          </div>
        ))}
      </div>
    </>
  );
}
