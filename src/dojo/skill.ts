// How good the learner is at a dojo, from the drill rounds in sessions/.
// Only the first attempt at each drill counts: a drill seen before tests memory
// of that answer, not the skill. Newer first attempts weigh more, so the number
// follows the learner's progress as they meet new drills, and exam-level drills
// weigh most. With little evidence the estimate stays low until enough unseen
// drills went well; when no unseen drills are left, new ones are needed to
// measure further.

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

export interface Skill {
  /** 0–1: share of unseen drills the learner solves, weighted; 0 without evidence. */
  score: number;
  /** Drills already met (their first attempt is the evidence). */
  tried: number;
  /** Drills never seen: what is left to measure the skill with. */
  unseen: number;
  total: number;
  /** Day of the last attempt at any drill of the dojo. */
  last?: ISODate;
  /** Skill per level, for levels with at least one first attempt. */
  levels: Partial<Record<Level, number>>;
}

/** First attempts lose half their weight after this many days. */
export const EVIDENCE_HALF_LIFE_DAYS = 30;
/** Weight of the prior "not shown yet": about two medium drills' worth of evidence. */
export const PRIOR_WEIGHT = 4;
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

/** How much a first attempt from `date` still says about the skill on `on`. */
export const evidenceWeight = (date: ISODate, on: ISODate) => 0.5 ** (Math.max(0, diffDays(date, on)) / EVIDENCE_HALF_LIFE_DAYS);

export function dojoSkill(dojo: Dojo, history: DrillHistory, on: ISODate): Skill {
  const drills = dojo.drills ?? [];
  const perDrill = history.get(dojo.id);
  let sum = 0;
  let weights = 0;
  let tried = 0;
  let last: ISODate | undefined;
  const lv: Partial<Record<Level, { sum: number; w: number }>> = {};
  for (const d of drills) {
    const attempts = perDrill?.get(d.id);
    if (!attempts?.length) continue;
    tried++;
    const first = attempts[0];
    const level = d.level ?? 'medium';
    const w = LEVEL_WEIGHT[level] * evidenceWeight(first.date, on);
    sum += (first.score / 5) * w;
    weights += w;
    const l = (lv[level] ??= { sum: 0, w: 0 });
    l.sum += (first.score / 5) * w;
    l.w += w;
    const date = attempts[attempts.length - 1].date;
    if (!last || date > last) last = date;
  }
  const levels: Partial<Record<Level, number>> = {};
  for (const [k, v] of Object.entries(lv)) if (v.w > 0) levels[k as Level] = v.sum / v.w;
  return { score: sum / (weights + PRIOR_WEIGHT), tried, unseen: drills.length - tried, total: drills.length, ...(last ? { last } : {}), levels };
}

/**
 * What to practice next: the gap to full skill, weighted by the dojo's share
 * of the exam (equal shares while no dojo has exam points). Higher = more urgent.
 */
export function practiceNeed(dojo: Dojo, skill: Skill, dojos: Dojo[]): number {
  const points = dojos.map((d) => d.exam?.points ?? 0);
  const total = points.reduce((a, b) => a + b, 0);
  const shares = points.filter((p) => p > 0).map((p) => p / total);
  // A dojo without exam points next to weighted ones still counts, at half the smallest share.
  const share = !total ? 1 / Math.max(1, dojos.length) : dojo.exam?.points ? dojo.exam.points / total : Math.min(...shares) / 2;
  return (1 - skill.score) * share;
}
