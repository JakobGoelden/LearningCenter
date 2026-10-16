// Points for a drill round: a game layer on top of the 0–5 grades. They only
// feed the score counter, combo badge and best-round record in the app; the
// progress of topics still uses the grades.

import type { Level } from '../model/types';
import type { DrillResult } from './drills';

export const BASE_POINTS: Record<Level, number> = { easy: 10, medium: 20, exam: 40 };

export interface PointsInput {
  level?: Level;
  result: DrillResult;
  /** Seconds the drill allowed and how many were used. Speed only counts with a timer. */
  limit: number;
  seconds: number;
  timed: boolean;
}

export interface DrillPoints {
  /** Points for this drill, combo included. */
  points: number;
  base: number;
  speed: number;
  /** Multiplier from the streak of right answers before and including this one. */
  combo: number;
  /** Right answers in a row, including this one (0 if this one was not right). */
  streak: number;
}

/** ×1.5 from the 3rd right answer in a row, ×2 from the 5th. */
export function comboFor(streak: number): number {
  return streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1;
}

/**
 * Points for one drill. Right earns the level's base, partly half of it, wrong
 * nothing. A right answer under a timer earns up to +50% for time left. Combo
 * multiplies right answers only; a partly answer keeps no streak.
 */
export function drillPoints(input: PointsInput, streakBefore: number): DrillPoints {
  const levelBase = BASE_POINTS[input.level ?? 'medium'];
  const { correct, score } = input.result;
  const factor = correct ? 1 : score >= 3 ? 0.5 : 0;
  const base = Math.round(levelBase * factor);
  const leftShare = input.limit > 0 ? Math.max(0, Math.min(1, (input.limit - input.seconds) / input.limit)) : 0;
  const speed = correct && input.timed ? Math.round(levelBase * 0.5 * leftShare) : 0;
  const streak = correct ? streakBefore + 1 : 0;
  const combo = correct ? comboFor(streak) : 1;
  return { points: Math.round((base + speed) * combo), base, speed, combo, streak };
}

/** Points per drill and the total for a whole round, in order. */
export function roundPoints(inputs: PointsInput[]): { each: DrillPoints[]; total: number; bestStreak: number } {
  const each: DrillPoints[] = [];
  let streak = 0;
  let bestStreak = 0;
  for (const i of inputs) {
    const p = drillPoints(i, streak);
    streak = p.streak;
    bestStreak = Math.max(bestStreak, streak);
    each.push(p);
  }
  return { each, total: each.reduce((s, p) => s + p.points, 0), bestStreak };
}

const bestKey = (dojoId: string) => `lc.dojo.best.${dojoId}`;

/** Best round total for a dojo on this device (0 if none or storage is blocked). */
export function bestPoints(dojoId: string): number {
  try {
    return Number(localStorage.getItem(bestKey(dojoId))) || 0;
  } catch {
    return 0;
  }
}

/** Stores the total if it beats the record; returns whether it did. */
export function recordPoints(dojoId: string, total: number): boolean {
  const best = bestPoints(dojoId);
  if (total <= best) return false;
  try {
    localStorage.setItem(bestKey(dojoId), String(total));
  } catch {
    /* storage blocked: the record just is not kept */
  }
  return true;
}
