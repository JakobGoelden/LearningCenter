// Records a review result and reschedules the topic with the app's own rules.
// Usage (from the repo root):
//   npm run review -- <pack-dir> <subject-id> <topic-id> <score 0-5> [source] [note] [--card <question-id>]
// With --card the card is rescheduled on its own (as in an app quiz) and the
// topic gets the history entry; without it the whole topic is graded.
// Example:
//   npm run review -- local/my-pack db sql-basics 4 quiz "Terminal-Abfrage" --card joins
import { recordReview } from '../src/api/edit';
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

const r = await recordReview(new NodeFs(dir), {
  subject: subjectId,
  topic: topicId,
  score: score as Score,
  source: source as Review['source'],
  ...(note ? { note } : {}),
  ...(cardId ? { card: cardId } : {}),
});
console.log(
  r.card
    ? `${subjectId} / ${topicId} / ${cardId}: score ${score} → card next ${r.card.due} (${r.card.intervalDays} days); topic ${r.status}, next ${r.topicDue ?? '-'}`
    : `${subjectId} / ${topicId}: score ${score} → ${r.status}, next review ${r.topicDue ?? '-'} (${r.intervalDays ?? '-'} days)`,
);
