import type { Subject, Topic } from './types';

/** A chapter counts unless the learner switched it off. Topics without a chapter always count. */
export function chapterEnabled(subject: Pick<Subject, 'chapters'>, chapterId?: string): boolean {
  if (!chapterId) return true;
  return subject.chapters?.find((c) => c.id === chapterId)?.enabled !== false;
}

/** Topics that take part in quizzes, study, endless mode and the calendar. */
export function activeTopics(subject: Pick<Subject, 'topics' | 'chapters'>): Topic[] {
  return subject.chapters?.length ? subject.topics.filter((t) => chapterEnabled(subject, t.chapter)) : subject.topics;
}
