// How well the learner masters a dojo, from the drill rounds in sessions/.
// Every drill counts with its last few scores, newer ones weigh more, and a
// drill not practiced for a while fades. Drills never tried count as 0, so
// the number covers both "not practiced yet" and "keeps going wrong". Exam
// level drills weigh most, because they are what the exam asks.

import { diffDays } from '../lib/dates';
import type { Dojo, ISODate, Level, Session } from '../model/types';
import { ownerDojo, PRACTICE_EXAM } from './exam';

export interface DrillAttempt {
  date: ISODate;
  /** 0–5, as in the session. */
  score: number;
}

/** Attempts per dojo id, then per drill id, oldest first. */
export type DrillHistory = Map<string, Map<string, DrillAttempt[]>>;

export interface Mastery {
  /** 0–1: 1 = every drill solved recently, 0 = nothing tried or all wrong. */
  score: number;
  /** Drills tried at least once, of all drills. */
  tried: number;
  total: number;
  /** Day of the last attempt at any drill of the dojo. */
  last?: ISODate;
  /** Mastery per level, for levels the dojo has. */
  levels: Partial<Record<Level, number>>;
}

/** How many of a drill's last attempts count. */
export const RECENT_ATTEMPTS = 3;
/** Days without practice before a drill starts to fade, and how fast it fades. */
export const FADE_AFTER_DAYS = 7;
export const FADE_HALF_LIFE_DAYS = 30;
export const LEVEL_WEIGHT: Record<Level, number> = { easy: 1, medium: 2, exam: 3 };

/**
 * Collects drill attempts from the sessions of a subject. Practice exam drills
 * (ids `<dojo>.<drill>`) count for their dojo; a session of a dojo that no
 * longer exists counts for the dojo that now has the drill.
 */
export function drillHistory(sessions: Session[], dojos: Dojo[]): DrillHistory {
  const out: DrillHistory = new Map();
  const byId = new Map(dojos.map((d) => [d.id, d]));
  const has = (d: Dojo, id: string) => (d.drills ?? []).some((x) => x.id === id);
  for (const s of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    if (s.type !== 'dojo') continue;
    const date = (s.finishedAt ?? s.startedAt).slice(0, 10);
    for (const it of s.items) {
      if (it.kind !== 'drill' || !it.drill || it.score === undefined) continue;
      let dojo: Dojo | undefined;
      let drill = it.drill;
      if (s.dojo === PRACTICE_EXAM) {
        dojo = ownerDojo(dojos, it.drill);
        if (dojo) drill = it.drill.slice(dojo.id.length + 1);
      } else {
        const own = s.dojo ? byId.get(s.dojo) : undefined;
        dojo = own && has(own, drill) ? own : dojos.find((d) => has(d, drill));
      }
      if (!dojo || !has(dojo, drill)) continue;
      const perDrill = out.get(dojo.id) ?? new Map<string, DrillAttempt[]>();
      perDrill.set(drill, [...(perDrill.get(drill) ?? []), { date, score: it.score }]);
      out.set(dojo.id, perDrill);
    }
  }
  return out;
}

/** 0–1 for one drill: recent scores (newer weigh more), faded by the time since the last try. */
export function drillMastery(attempts: DrillAttempt[] | undefined, on: ISODate): number {
  if (!attempts?.length) return 0;
  const recent = attempts.slice(-RECENT_ATTEMPTS);
  let sum = 0;
  let weights = 0;
  recent.forEach((a, i) => {
    sum += (a.score / 5) * (i + 1);
    weights += i + 1;
  });
  const idle = Math.max(0, diffDays(recent[recent.length - 1].date, on) - FADE_AFTER_DAYS);
  return (sum / weights) * 0.5 ** (idle / FADE_HALF_LIFE_DAYS);
}

export function dojoMastery(dojo: Dojo, history: DrillHistory, on: ISODate): Mastery {
  const drills = dojo.drills ?? [];
  const perDrill = history.get(dojo.id);
  let sum = 0;
  let weights = 0;
  let tried = 0;
  let last: ISODate | undefined;
  const lv: Partial<Record<Level, { sum: number; n: number }>> = {};
  for (const d of drills) {
    const attempts = perDrill?.get(d.id);
    const level = d.level ?? 'medium';
    const m = drillMastery(attempts, on);
    sum += m * LEVEL_WEIGHT[level];
    weights += LEVEL_WEIGHT[level];
    const l = (lv[level] ??= { sum: 0, n: 0 });
    l.sum += m;
    l.n++;
    if (attempts?.length) {
      tried++;
      const date = attempts[attempts.length - 1].date;
      if (!last || date > last) last = date;
    }
  }
  const levels: Partial<Record<Level, number>> = {};
  for (const [k, v] of Object.entries(lv)) levels[k as Level] = v.sum / v.n;
  return { score: weights ? sum / weights : 0, tried, total: drills.length, ...(last ? { last } : {}), levels };
}

/**
 * What to practice next: the gap to full mastery, weighted by the dojo's share
 * of the exam (equal shares while no dojo has exam points). Higher = more urgent.
 */
export function practiceNeed(dojo: Dojo, mastery: Mastery, dojos: Dojo[]): number {
  const points = dojos.map((d) => d.exam?.points ?? 0);
  const total = points.reduce((a, b) => a + b, 0);
  const shares = points.filter((p) => p > 0).map((p) => p / total);
  // A dojo without exam points next to weighted ones still counts, at half the smallest share.
  const share = !total ? 1 / Math.max(1, dojos.length) : dojo.exam?.points ? dojo.exam.points / total : Math.min(...shares) / 2;
  return (1 - mastery.score) * share;
}
