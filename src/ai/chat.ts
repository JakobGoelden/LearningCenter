// Prompts for "Start in chat": the same quiz, study round or dojo, but run in
// the person's AI chat (voice input, free talk). The app copies the prompt;
// the AI follows CLAUDE.md and writes the results back into the pack.

import type { Dojo, Level, Pack, Sheet, SheetWork, Subject, Topic } from '../model/types';
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
  blocks: { subject: Subject; topics: Topic[]; cards?: { topic: Topic; question: { id: string } }[] }[];
}): string {
  const n = a.blocks.reduce((k, b) => k + (b.cards?.length ?? b.topics.length), 0);
  const files = a.fs.kind !== 'browser';
  const cardIds = (b: (typeof a.blocks)[number], t: Topic) =>
    (b.cards ?? []).filter((c) => c.topic.id === t.id && c.question.id !== '_').map((c) => c.question.id);
  return [
    `Quiz me here in the chat, one question at a time (${n} ${n === 1 ? 'question' : 'questions'}). ${packWhere(a.fs)}`,
    files ? 'Follow CLAUDE.md → "Quizzing directly in the chat".' : '',
    '',
    'Topics, in this order (subject / topic id: title), with the prepared cards to ask:',
    ...a.blocks.flatMap((b) =>
      b.topics.map((t) => {
        const ids = cardIds(b, t);
        return `${topicLine(b.subject, t)}${ids.length ? ` → cards ${ids.join(', ')}` : ''}`;
      }),
    ),
    '',
    `Ask in ${lang(a.pack)}, numbered "Question n/${n}". I may answer by voice, so ignore typos and filler words. Ask the listed cards (one question each); for a topic without cards, use its notes.`,
    'After each answer: a score 0–5 and the gaps in 1–3 sentences, then the next question.',
    files
      ? `At the end record every grade with \`npm run review -- ${packArg(a.fs)} <subject> <topic> <score> quiz --card <card id>\` (one call per card), write the session log, and tell me the next due dates.`
      : 'At the end list topic, card, score and gaps as a short table.',
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

/** Work through an exercise sheet together in the chat: tutor, not answer key. */
export function sheetChatPrompt(a: {
  fs: Pick<PackFs, 'kind' | 'label' | 'sharedWithAi'>;
  pack: Pack;
  subject: Subject;
  sheet: Sheet;
  work?: SheetWork | null;
}): string {
  const files = a.fs.kind !== 'browser';
  const tasks = a.sheet.tasks ?? [];
  const where = a.sheet.file ?? a.sheet.url;
  const workFile = `work/${a.subject.id}/${a.sheet.id}.json`;
  const answered = Object.keys(a.work?.answers ?? {}).length;
  const inline = files
    ? []
    : tasks.flatMap((t) => [
        '',
        `${t.label}${t.points !== undefined ? ` (${t.points} pts)` : ''}:`,
        t.text,
        ...(a.work?.answers[t.id] ? [`My answer so far: ${a.work.answers[t.id]}`] : []),
      ]);
  return [
    `Work through the exercise sheet "${a.sheet.label}" (${a.subject.name}) with me here in the chat. ${packWhere(a.fs)}`,
    files
      ? `The sheet is \`${a.sheet.id}\` in \`subjects/${a.subject.id}.json\`${tasks.length ? ` (${tasks.length} tasks in \`tasks\`)` : ''}${where ? `, the original is ${where}` : ''}. Follow CLAUDE.md → "Working on a sheet in the chat".`
      : where
        ? `The sheet: ${where}`
        : '',
    files && answered
      ? `I already wrote answers to ${answered} ${answered === 1 ? 'task' : 'tasks'} in \`${workFile}\`: start from them.`
      : '',
    ...inline,
    '',
    `Go task by task in ${lang(a.pack)}. Let me try first: ask what I would do, then guide me with questions and hints instead of handing me the solution. Check each step I make and say clearly what is right and what is missing. Show a full solution only when I ask for it. I may answer by voice, so ignore typos and filler words.`,
    files
      ? `When we settle an answer, write it in my words into \`${workFile}\` (only when I agree, never overwrite what I wrote without asking), so it shows up in the app. At the end tell me which tasks are solid and which topics I should review.`
      : 'At the end list per task what I got right and what to review.',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
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
