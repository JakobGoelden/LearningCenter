// Prompts for "Start in chat": the same quiz, study round or dojo, but run in
// the person's AI chat (voice input, free talk). The app copies the prompt;
// the AI follows CLAUDE.md and writes the results back into the pack.

import type { Dojo, Level, Pack, Subject, Topic } from '../model/types';
import type { PackFs } from '../storage/fs';
import { LANGUAGES, LEVEL_LABEL } from './requests';

/** How the AI finds the pack, in one sentence. */
export function packWhere(fs: Pick<PackFs, 'kind' | 'label' | 'sharedWithAi'>): string {
  if (fs.kind === 'dev') return `My LearningCenter pack is the folder \`${fs.label}\` in the LearningCenter repo.`;
  if (fs.kind === 'folder') return `My LearningCenter pack is the folder "${fs.label}" (the one I opened in the app).`;
  return 'My LearningCenter pack lives in the browser, so you cannot open its files: use the topics below and give me the scores at the end.';
}

const packArg = (fs: Pick<PackFs, 'kind' | 'label'>) => (fs.kind === 'dev' ? fs.label : '<pack folder>');

const lang = (pack: Pack) => {
  const l = pack.settings?.language ?? 'en';
  return LANGUAGES[l] ?? l;
};

const topicLine = (s: Subject, t: Topic) => `- ${s.id} / ${t.id}: ${t.title}${t.notes ? ` (${t.notes.split('\n')[0].slice(0, 120)})` : ''}`;

/** Quiz or study round in the chat, one question at a time. */
export function quizChatPrompt(a: {
  fs: Pick<PackFs, 'kind' | 'label' | 'sharedWithAi'>;
  pack: Pack;
  blocks: { subject: Subject; topics: Topic[] }[];
}): string {
  const n = a.blocks.reduce((k, b) => k + b.topics.length, 0);
  const files = a.fs.kind !== 'browser';
  return [
    `Quiz me here in the chat, one question at a time (${n} ${n === 1 ? 'question' : 'questions'}). ${packWhere(a.fs)}`,
    files ? 'Follow CLAUDE.md → "Quizzing directly in the chat".' : '',
    '',
    'Topics, in this order (subject / topic id: title):',
    ...a.blocks.flatMap((b) => b.topics.map((t) => topicLine(b.subject, t))),
    '',
    `Ask in ${lang(a.pack)}, numbered "Question n/${n}". I may answer by voice, so ignore typos and filler words. Use the topic's prepared questions and notes if there are any.`,
    'After each answer: a score 0–5 and the gaps in 1–3 sentences, then the next question.',
    files
      ? `At the end record every grade with \`npm run review -- ${packArg(a.fs)} <subject> <topic> <score> quiz\`, write the session log, and tell me the next due dates.`
      : 'At the end list topic, score and gaps as a short table.',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

/** Dojo training in the chat: tasks, step-by-step checks, hints on request. */
export function dojoChatPrompt(a: {
  fs: Pick<PackFs, 'kind' | 'label' | 'sharedWithAi'>;
  pack: Pack;
  subject: Subject;
  dojo: Dojo;
  level?: Level;
}): string {
  const files = a.fs.kind !== 'browser';
  const level = a.level ? LEVEL_LABEL[a.level] : 'mixed, starting easy';
  return [
    `Train me here in the chat in the dojo "${a.dojo.title}" (${a.subject.name}): ${a.dojo.procedure}. ${packWhere(a.fs)}`,
    files ? `The dojo is \`dojos/${a.dojo.id}.json\`; follow CLAUDE.md → "Dojos" (in the chat).` : '',
    `Level: ${level}. Language: ${lang(a.pack)}.${a.dojo.aids?.length ? ` Aids: ${a.dojo.aids.join(', ')}.` : ''}`,
    "Set one task at a time following the dojo's promptTemplate (or its prepared drills), wait for my solution, check it step by step with a score 0–5. Give a hint or the model solution only when I ask. I may answer by voice; when a formula is hard to say, I describe it in words.",
    'Keep going with the next task until I say stop.',
    files && a.dojo.topics?.length
      ? `Then record one grade for the trained topics (${a.dojo.topics.join(', ')}) with \`npm run review -- ${packArg(a.fs)} ${a.subject.id} <topic> <score> dojo\`.`
      : 'Then sum up what went well and what to practise.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The prompt behind the "results waiting for your AI" banner. */
export function syncPrompt(fs: Pick<PackFs, 'kind' | 'label' | 'sharedWithAi'>): string {
  return `Process my new LearningCenter results. ${packWhere(fs)} Follow CLAUDE.md → "Processing new results": grade open quizzes, review what I did since the last sync, update my learning state, then append the ai.sync event so the banner in the app disappears, and tell me briefly what changed.`;
}

/** Grade a finished in-app quiz together in the chat (the session is saved with gradeLater). */
export function quizGradeChatPrompt(a: {
  fs: Pick<PackFs, 'kind' | 'label' | 'sharedWithAi'>;
  pack: Pack;
  session: { id: string; items: { n: number; topicId?: string; prompt: string; answer?: string; solution?: string }[] };
}): string {
  const files = a.fs.kind !== 'browser';
  const head = [
    `Grade my quiz with me here in the chat. ${packWhere(a.fs)}`,
    files
      ? `The answers are in \`sessions/${a.session.id}.json\`; follow CLAUDE.md → "Grading open quizzes" for this session.`
      : 'Questions, my answers and the key points:',
  ];
  const inline = files
    ? []
    : a.session.items.flatMap((i) => [
        '',
        `${i.n}. ${i.prompt}`,
        `My answer: ${i.answer || '(none)'}`,
        ...(i.solution ? [`Key points: ${i.solution}`] : []),
      ]);
  return [
    ...head,
    ...inline,
    '',
    `Go through the questions one at a time in ${lang(a.pack)}: my answer, a score 0–5 and the gaps in 1–3 sentences. I may add something by voice before you settle a score.`,
    files
      ? `Then record the grades with \`npm run review -- ${packArg(a.fs)} <subject> <topic> <score> quiz "${a.session.id}"\`, mark the session applied, log quiz.applied and tell me the next due dates.`
      : 'At the end list topic, score and gaps as a short table.',
  ].join('\n');
}
