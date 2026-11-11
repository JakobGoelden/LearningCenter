// Read-only views of a learner's progress for an outside AI over HTTP
// (scripts/progress-api.ts, docs/API.md "Read-only HTTP API"). Compact JSON with
// learning state only: no notes, no open-task texts, no free-text answers, no
// login name. Pure functions, no file access.

import { activeDojos, activeTopics, chapterEnabled } from '../model/chapters';
import { diffDays } from '../lib/dates';
import { activeQuestions } from '../model/quiz';
import { drillHistory, dojoSkill, practiceNeed } from '../dojo/skill';
import type { Subject, Topic } from '../model/types';
import { progressReport, weakSpots, type Snapshot } from './insights';

/** How current the data is, added to every answer. */
export interface Freshness {
  /** When this answer was computed (the API reads the live pack, no cache). */
  generatedAt: string;
  /** Last time the app saved the learner's progress: newest change to the log, subjects or sessions. */
  lastSync: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pick = (subjects: Subject[], id?: string) => {
  if (id && !subjects.some((s) => s.id === id)) throw new NotFound(`Unknown subject "${id}". Known: ${subjects.map((s) => s.id).join(', ')}`);
  return subjects.filter((s) => !id || s.id === id);
};

export class NotFound extends Error {}

export function progressView(snap: Snapshot, subject?: string) {
  pick(snap.loaded.subjects, subject);
  const r = progressReport(snap, subject);
  return {
    date: r.date,
    subjects: r.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      exam: s.exam,
      cards: {
        total: s.cards.total,
        answered: s.cards.shaky + s.cards.solid,
        new: s.cards.new,
        shaky: s.cards.shaky,
        solid: s.cards.solid,
        /** Share of the cards answered at least once. */
        covered: s.cards.covered,
        /** Share of the cards that are solid (the dashboard's progress bar). */
        solidShare: s.progress,
        due: s.cards.due,
        overdue: s.cards.overdue,
        avgRecentScore: s.cards.avgRecentScore,
      },
      newCardsPerDayToExam: s.newCardsPerDayToExam,
      chaptersOff: s.chapters?.off.map((c) => c.id) ?? [],
      dojos: s.dojos,
      openSheets: s.openSheets.length,
    })),
    activity: r.activity,
    studyNext: r.studyNext.map((b) => ({ subject: b.subject, cards: b.cards })),
  };
}

const answered = (t: Topic) => activeQuestions(t).filter((q) => q.stats?.seen).length;

interface NeverAsked {
  subject: string;
  chapter?: string;
  topic?: string;
  title: string;
  switchedOn: boolean;
  topics?: number;
  cards: number;
}

/** Chapters (or, without chapters, topics) of which no card was ever answered. */
function neverAsked(s: Subject): NeverAsked[] {
  const topics = s.topics.filter((t) => t.status !== 'skip');
  if (s.chapters?.length) {
    return s.chapters
      .map((c) => {
        const inChapter = topics.filter((t) => t.chapter === c.id);
        const cards = inChapter.reduce((n, t) => n + activeQuestions(t).length, 0);
        const seen = inChapter.some((t) => answered(t) || t.history?.length);
        return seen || !inChapter.length ? null : { subject: s.id, chapter: c.id, title: c.title, switchedOn: c.enabled !== false, topics: inChapter.length, cards };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }
  return topics
    .filter((t) => !answered(t) && !t.history?.length && activeQuestions(t).length)
    .map((t) => ({ subject: s.id, topic: t.id, title: t.title, switchedOn: t.enabled !== false && chapterEnabled(s, t.chapter), cards: activeQuestions(t).length }));
}

export function weakSpotsView(snap: Snapshot, opts: { subject?: string; limit?: number } = {}) {
  const subjects = pick(snap.loaded.subjects, opts.subject);
  const limit = opts.limit ?? 10;
  const w = weakSpots(snap, { subject: opts.subject, limit });
  const dojos = subjects.flatMap((s) => {
    const own = activeDojos(s, snap.loaded.dojos).filter((d) => d.drills?.length);
    const history = drillHistory(snap.sessions.filter((x) => x.subject === s.id), own);
    return own.map((d) => {
      const skill = dojoSkill(d, history, snap.on);
      return {
        subject: s.id,
        dojo: d.id,
        title: d.title,
        skill: round(skill.score),
        tried: skill.tried,
        unseen: skill.unseen,
        lastPracticed: skill.last ?? null,
        /** Gap to full skill times the dojo's exam share: higher means practise first. */
        need: round(practiceNeed(d, skill, own)),
      };
    });
  });
  return {
    date: w.date,
    topics: w.spots.map((x) => ({
      subject: x.subject,
      topic: x.topic,
      title: x.title,
      chapter: x.chapter,
      priority: x.priority,
      avgScore: x.avgScore,
      due: x.due,
      reasons: x.reasons,
      weakCards: x.cards.map((c) => ({ id: c.id, prompt: c.prompt, recent: c.recent, avgScore: c.avgScore })),
      failingDrills: x.drills.map((d) => ({ dojo: d.dojo ?? null, drill: d.drill, tries: d.tries, avgScore: d.avgScore })),
    })),
    dojos: dojos.sort((a, b) => b.need - a.need).slice(0, limit),
    neverAsked: subjects.flatMap(neverAsked),
  };
}

export function recentActivityView(snap: Snapshot, opts: { subject?: string; limit?: number } = {}) {
  pick(snap.loaded.subjects, opts.subject);
  const sessions = snap.sessions
    .filter((s) => !opts.subject || s.subject === opts.subject)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, opts.limit ?? 10);
  const report = progressReport(snap, opts.subject);
  return {
    date: snap.on,
    lastActive: report.activity.lastActive,
    streakDays: report.activity.streakDays,
    weeks: report.activity.weeks,
    sessions: sessions.map((s) => {
      const scores = s.items.flatMap((i) => (i.score === undefined ? [] : [i.score]));
      const minutes = s.finishedAt ? Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000) : null;
      return {
        startedAt: s.startedAt,
        type: s.type,
        subject: s.subject,
        dojo: s.dojo ?? null,
        level: s.level ?? null,
        items: s.items.length,
        graded: scores.length,
        avgScore: scores.length ? round(mean(scores)!) : null,
        right: scores.filter((x) => x >= 4).length,
        partly: scores.filter((x) => x === 3 || x === 2).length,
        wrong: scores.filter((x) => x < 2).length,
        minutes: minutes !== null && minutes >= 0 ? minutes : null,
        topics: [...new Set(s.items.flatMap((i) => (i.topicId ? [i.topicId] : [])))],
        waitingForGrade: !!s.gradeLater && !s.applied,
      };
    }),
  };
}

export function examDatesView(snap: Snapshot) {
  return {
    date: snap.on,
    exams: snap.loaded.subjects
      .map((s) => ({
        subject: s.id,
        name: s.name,
        format: s.exam.format,
        date: s.exam.date ?? null,
        time: s.exam.time ?? null,
        durationMinutes: s.exam.durationMinutes ?? null,
        inDays: s.exam.date ? diffDays(snap.on, s.exam.date) : null,
        topicsOn: activeTopics(s).length,
      }))
      .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999')),
  };
}
