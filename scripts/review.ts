// Records a review result and reschedules the topic with the app's own rules.
// Usage (from the repo root):
//   npm run review -- <pack-dir> <subject-id> <topic-id> <score 0-5> [source] [note]
// Example:
//   npm run review -- local/my-pack db sql-basics 4 quiz "Terminal-Abfrage"
import { today } from '../src/lib/dates';
import { applyReview } from '../src/scheduling/scheduler';
import { appendEvent, loadPack, saveSubject } from '../src/storage/repo';
import type { Review, Score } from '../src/model/types';
import { NodeFs } from './node-fs';

const [dir, subjectId, topicId, scoreArg, source = 'quiz', note] = process.argv.slice(2);
if (!dir || !subjectId || !topicId || scoreArg === undefined) {
  console.error('Usage: npm run review -- <pack-dir> <subject-id> <topic-id> <score 0-5> [quiz|dojo|manual] [note]');
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

const review: Review = { date: today(), score: score as Score, source: source as Review['source'], ...(note ? { note } : {}) };
const updated = applyReview(topic, review, pack.settings);
await saveSubject(fs, { ...subject, topics: subject.topics.map((t) => (t.id === topicId ? updated : t)) });
await appendEvent(fs, { type: 'topic.review', actor: 'ai', subject: subjectId, ref: topicId, data: { score, source } });
console.log(`${subject.name} / ${topic.title}: score ${score} → ${updated.status}, next review ${updated.due ?? '-'} (${updated.intervalDays ?? '-'} days)`);
