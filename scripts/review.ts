// Records a review result and reschedules the topic with the app's own rules.
// Usage (from the repo root):
//   npm run review -- <pack-dir> <subject-id> <topic-id> <score 0-5> [source] [note] [--card <question-id>]
// With --card the card is rescheduled on its own (as in an app quiz) and the
// topic gets the history entry; without it the whole topic is graded.
// Example:
//   npm run review -- local/my-pack db sql-basics 4 quiz "Terminal-Abfrage" --card joins
import { today } from '../src/lib/dates';
import { applyCardReviews, applyReview } from '../src/scheduling/scheduler';
import { appendEvent, loadPack, saveSubject } from '../src/storage/repo';
import type { Review, Score } from '../src/model/types';
import { NodeFs } from './node-fs';

const args = process.argv.slice(2);
const cardAt = args.indexOf('--card');
const cardId = cardAt >= 0 ? args[cardAt + 1] : undefined;
if (cardAt >= 0) args.splice(cardAt, 2);
const [dir, subjectId, topicId, scoreArg, source = 'quiz', note] = args;
if (!dir || !subjectId || !topicId || scoreArg === undefined) {
  console.error('Usage: npm run review -- <pack-dir> <subject-id> <topic-id> <score 0-5> [quiz|dojo|manual] [note] [--card <question-id>]');
  process.exit(2);
}
const score = Number(scoreArg);
if (!Number.isInteger(score) || score < 0 || score > 5) throw new Error('score must be an integer 0-5');
if (!['quiz', 'dojo', 'manual'].includes(source)) throw new Error('source must be quiz, dojo or manual');

const fs = new NodeFs(dir);
const { pack, subjects } = await loadPack(fs);
const subject = subjects.find((s) => s.id === subjectId);
if (!subject) throw new Error(`Unknown subject "${subjectId}". Known: ${subjects.map((s) => s.id).join(', ')}`);
const topic = subject.topics.find((t) => t.id === topicId);
if (!topic) throw new Error(`Unknown topic "${topicId}". Known: ${subject.topics.map((t) => t.id).join(', ')}`);

if (cardId && !topic.questions?.some((q) => q.id === cardId)) {
  throw new Error(`Unknown card "${cardId}". Known: ${(topic.questions ?? []).map((q) => q.id).join(', ')}`);
}
const review: Review = { date: today(), score: score as Score, source: source as Review['source'], ...(note ? { note } : {}) };
const updated = cardId
  ? applyCardReviews(topic, [{ question: cardId, score: score as Score }], { date: review.date, source: review.source, ...(note ? { note } : {}) }, pack.settings)
  : applyReview(topic, review, pack.settings);
await saveSubject(fs, { ...subject, topics: subject.topics.map((t) => (t.id === topicId ? updated : t)) });
await appendEvent(fs, { type: 'topic.review', actor: 'ai', subject: subjectId, ref: topicId, data: { score, source, ...(cardId ? { card: cardId } : {}) } });
const card = cardId ? updated.questions?.find((q) => q.id === cardId) : undefined;
console.log(
  card
    ? `${subject.name} / ${topic.title} / ${cardId}: score ${score} → card next ${card.due} (${card.intervalDays} days); topic ${updated.status}, next ${updated.due ?? '-'}`
    : `${subject.name} / ${topic.title}: score ${score} → ${updated.status}, next review ${updated.due ?? '-'} (${updated.intervalDays ?? '-'} days)`,
);
