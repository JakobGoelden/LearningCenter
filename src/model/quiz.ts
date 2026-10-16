import type { QuestionKind, Topic } from './types';

export interface QuizQuestion {
  /** Id of the prepared question; missing for the generic fallback. */
  id?: string;
  prompt: string;
  kind?: QuestionKind;
  /** Key points of a good answer. */
  answer?: string;
}

/**
 * The question the app asks for a topic without an AI. Prepared questions
 * take turns (by the number of past reviews); a topic without any gets a
 * general "explain it" question built from its title.
 */
export function questionFor(topic: Topic): QuizQuestion {
  const qs = topic.questions ?? [];
  if (!qs.length) {
    return { kind: 'explain', prompt: `Explain **${topic.title}** in your own words: what is it, why does it matter, and what is a typical example or mistake?` };
  }
  const q = qs[(topic.history?.length ?? 0) % qs.length];
  return { id: q.id, prompt: q.prompt, ...(q.kind ? { kind: q.kind } : {}), ...(q.answer ? { answer: q.answer } : {}) };
}

/** Self-grading in the app, same scale as dojo drills. */
export const SELF_SCORE = { right: 5, partly: 3, wrong: 1 } as const;
export type SelfRating = keyof typeof SELF_SCORE;
