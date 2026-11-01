import type { Dojo, Subject, Topic } from './types';

/** A chapter counts unless the learner switched it off. Topics without a chapter always count. */
export function chapterEnabled(subject: Pick<Subject, 'chapters'>, chapterId?: string): boolean {
  if (!chapterId) return true;
  return subject.chapters?.find((c) => c.id === chapterId)?.enabled !== false;
}

/** Topics that take part in quizzes, study, endless mode and the calendar. */
export function activeTopics(subject: Pick<Subject, 'topics' | 'chapters'>): Topic[] {
  return subject.topics.filter((t) => t.enabled !== false && chapterEnabled(subject, t.chapter));
}

/**
 * Switches the topics `which` picks on or off. Nothing else about a topic
 * changes, so switching it back on restores its progress exactly.
 */
export function withTopicsEnabled<S extends Pick<Subject, 'topics'>>(subject: S, which: (t: Topic) => boolean, enabled: boolean): S {
  return {
    ...subject,
    topics: subject.topics.map((t) => {
      if (!which(t)) return t;
      const { enabled: _old, ...rest } = t;
      return enabled ? rest : { ...rest, enabled };
    }),
  };
}

/** Dojos of the subject whose chapter is switched on (dojos without a chapter always count). */
export function activeDojos(subject: Pick<Subject, 'id' | 'chapters'>, dojos: Dojo[]): Dojo[] {
  return dojos.filter((d) => d.subject === subject.id && chapterEnabled(subject, d.chapter));
}
