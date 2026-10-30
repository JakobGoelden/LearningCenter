// Practice exam: exam-level drills from all (active) dojos of a subject, mixed
// in the ratio the real exams have (dojo.exam.points, taken from old exams)
// and filled up to the exam's length.

import type { Dojo, Drill } from '../model/types';
import { secondsFor, type DrillResult } from './drills';

export const DEFAULT_EXAM_MINUTES = 90;

export interface ExamPart {
  dojo: Dojo;
  /** Share of the exam time, 0–1. */
  share: number;
  /** Planned minutes for this part. */
  minutes: number;
  drills: Drill[];
}

export interface PracticeExam {
  parts: ExamPart[];
  /** All drills in exam order, ids prefixed with their dojo so they stay unique. */
  drills: Drill[];
  /** True when every part has a weight from old exams; else equal weights were used. */
  fromBlueprint: boolean;
  /** Dojos without exam-level drills (left out). */
  missing: Dojo[];
  minutes: number;
}

const shuffle = <T>(xs: T[], random: () => number): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** The exam-level drills of a dojo. */
export const examDrills = (dojo: Dojo) => (dojo.drills ?? []).filter((d) => d.level === 'exam');

/**
 * Picks a practice exam. Each dojo gets its share of the time (by
 * `exam.points`; equal shares if a dojo has none) and is filled with random
 * exam-level drills until its time is used, at least one per dojo.
 */
export function practiceExam(dojos: Dojo[], minutes = DEFAULT_EXAM_MINUTES, random: () => number = Math.random): PracticeExam {
  const usable = dojos.filter((d) => examDrills(d).length > 0);
  const fromBlueprint = usable.length > 0 && usable.every((d) => d.exam?.points);
  // With a blueprint a dojo without a weight is plain training, not a gap in the exam.
  const missing = dojos.filter((d) => examDrills(d).length === 0 && (d.drills?.length ?? 0) > 0 && (!fromBlueprint || d.exam?.points));
  const weight = (d: Dojo) => (fromBlueprint ? d.exam!.points : 1);
  const total = usable.reduce((s, d) => s + weight(d), 0);
  const parts: ExamPart[] = usable.map((dojo) => {
    const share = weight(dojo) / total;
    const budget = share * minutes * 60;
    const picked: Drill[] = [];
    let used = 0;
    for (const d of shuffle(examDrills(dojo), random)) {
      const t = secondsFor(d);
      if (picked.length && used + t > budget) continue;
      picked.push({ ...d, id: `${dojo.id}.${d.id}` });
      used += t;
    }
    return { dojo, share, minutes: Math.round(used / 60), drills: picked };
  });
  return {
    parts,
    drills: parts.flatMap((p) => p.drills),
    fromBlueprint,
    missing,
    minutes: parts.reduce((s, p) => s + p.minutes, 0),
  };
}

/** How much of a task counts as earned: its share if graded in parts, else right 1, partly ½. */
const credit = (r: DrillResult) => r.share ?? (r.correct ? 1 : r.score >= 3 ? 0.5 : 0);

export interface ExamScore {
  earned: number;
  max: number;
  /** Earned and maximum points per owning dojo id, in exam order. */
  parts: { id: string; earned: number; max: number }[];
}

/**
 * The result in real exam points (`drill.points`), per dojo. Null while a task
 * has no points, because then a total would mean nothing.
 */
export function examScore(outcomes: { drill: Drill; result: DrillResult }[], ownerOf: (drillId: string) => string): ExamScore | null {
  if (!outcomes.length || outcomes.some((o) => !o.drill.points)) return null;
  const parts: ExamScore['parts'] = [];
  for (const { drill, result } of outcomes) {
    const id = ownerOf(drill.id);
    let part = parts.find((p) => p.id === id);
    if (!part) parts.push((part = { id, earned: 0, max: 0 }));
    part.earned += drill.points! * credit(result);
    part.max += drill.points!;
  }
  const tidy = (n: number) => Math.round(n * 10) / 10;
  for (const p of parts) p.earned = tidy(p.earned);
  return { earned: tidy(parts.reduce((s, p) => s + p.earned, 0)), max: parts.reduce((s, p) => s + p.max, 0), parts };
}

/** The dojo a drill of the practice exam came from (their ids are `<dojo>.<drill>`). */
export const ownerDojo = (dojos: Dojo[], drillId: string) => dojos.find((d) => drillId.startsWith(`${d.id}.`));

/** Route id of the practice exam in the dojo pages. */
export const PRACTICE_EXAM = 'practice-exam';

/** A stand-in dojo holding every exam-level drill of the subject, for the practice exam page. */
export function practiceExamDojo(subjectId: string, dojos: Dojo[]): Dojo {
  return {
    id: PRACTICE_EXAM,
    subject: subjectId,
    title: 'Practice exam',
    procedure: 'Exam-level tasks from all dojos, mixed like the real exam',
    promptTemplate: '',
    levels: ['exam'],
    topics: [...new Set(dojos.flatMap((d) => d.topics ?? []))],
    drills: dojos.flatMap((d) => examDrills(d).map((x) => ({ ...x, id: `${d.id}.${x.id}` }))),
  };
}
