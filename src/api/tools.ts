// The API for AIs: one table of tools, served over MCP (scripts/mcp.ts) and as
// a command line (scripts/ai.ts). See docs/API.md.

import Ajv2020 from 'ajv/dist/2020';
import { collectResults } from '../ai/results';
import { today } from '../lib/dates';
import { pendingResults } from '../model/sync';
import type { Session } from '../model/types';
import type { PackFs } from '../storage/fs';
import { listSessions, loadPack, loadSession, readEvents } from '../storage/repo';
import { addCard, editCard, markProcessed, recordReview, setTopicNotes, setTopicsEnabled } from './edit';
import { listCards, progressReport, subjectTopics, topicDetail, weakSpots, type CardFilter, type Snapshot } from './insights';

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  /** Changes the pack. */
  writes?: boolean;
  run(fs: PackFs, args: Args): Promise<unknown>;
}

async function snapshot(fs: PackFs): Promise<Snapshot> {
  const loaded = await loadPack(fs);
  const ids = await listSessions(fs);
  const sessions = (await Promise.all(ids.map((id) => loadSession(fs, id).catch(() => null)))).filter((s): s is Session => !!s);
  return { loaded, sessions, on: today() };
}

const subject = { type: 'string', description: 'Subject id, see get_progress.' };
const topic = { type: 'string', description: 'Topic id, see get_subject_topics.' };
const offChapters = { type: 'boolean', description: 'Also look at chapters the learner switched off. Default false: their lecture may not have happened yet.' };
const kind = { enum: ['why', 'what-if', 'explain', 'apply'] };
const schema = (properties: Record<string, unknown>, required: string[] = []): Tool['inputSchema'] => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const SHARED_NOTE = 'A subject in the shared repository takes the change along with the next `npm run share -- push`, so friends get it too; on the hosted app that sync runs by itself.';

export const TOOLS: Tool[] = [
  {
    name: 'get_progress',
    description:
      'How the learner stands: per subject the exam date, topic and card counts (new/shaky/solid, covered share, due, overdue, average score), the new cards a day needed to see everything by the exam, switched-off chapters, dojos, open sheets and tasks; plus activity per week, the streak, what is on today and what a study round would ask next. Start here.',
    inputSchema: schema({ subject: { ...subject, description: 'Only this subject. Default: all.' } }),
    run: async (fs, a) => progressReport(await snapshot(fs), a.subject),
  },
  {
    name: 'get_weak_spots',
    description:
      'Topics that keep going wrong, worst first, each with the reasons and evidence: weak cards, cards that relapsed after being right, drills that fail, gaps named in graded answers. Near exams count more. Topics never answered are new, not weak.',
    inputSchema: schema({ subject: { ...subject, description: 'Only this subject. Default: all.' }, limit: { type: 'integer', minimum: 1, description: 'Default 15.' }, include_off_chapters: offChapters }),
    run: async (fs, a) => weakSpots(await snapshot(fs), { subject: a.subject, limit: a.limit, includeOffChapters: a.include_off_chapters }),
  },
  {
    name: 'get_subject_topics',
    description: 'All chapters and topics of a subject with status, due date and number of cards.',
    inputSchema: schema({ subject }, ['subject']),
    run: async (fs, a) => subjectTopics(await snapshot(fs), a.subject),
  },
  {
    name: 'get_topic',
    description: 'One topic in depth: notes, review history, every card with answer and statistics, related dojos and the learner\'s last answers with their feedback.',
    inputSchema: schema({ subject, topic }, ['subject', 'topic']),
    run: async (fs, a) => topicDetail(await snapshot(fs), a.subject, a.topic),
  },
  {
    name: 'list_cards',
    description: 'The learner\'s own cards with prompt, answer, schedule and statistics. Filter by topic or state; page with limit and offset.',
    inputSchema: schema(
      {
        subject,
        topic: { ...topic, description: 'Only this topic.' },
        filter: { enum: ['all', 'due', 'new', 'weak', 'blocked'], description: 'Default all.' },
        limit: { type: 'integer', minimum: 1, description: 'Default 50.' },
        offset: { type: 'integer', minimum: 0 },
        include_off_chapters: offChapters,
      },
      ['subject'],
    ),
    run: async (fs, a) =>
      listCards(await snapshot(fs), {
        subject: a.subject,
        topic: a.topic,
        filter: a.filter as CardFilter | undefined,
        limit: a.limit,
        offset: a.offset,
        includeOffChapters: a.include_off_chapters,
      }),
  },
  {
    name: 'get_new_results',
    description:
      'What the learner did since the AI last looked (the "New results" banner): finished quizzes, dojo rounds, sheets, and quizzes waiting to be graded in the chat, with their answers. Afterwards call mark_results_processed.',
    inputSchema: schema({}),
    run: async (fs) => {
      const { subjects } = await loadPack(fs);
      const pending = pendingResults(await readEvents(fs, Number.MAX_SAFE_INTEGER));
      const d = await collectResults(fs, subjects, pending);
      return {
        counts: { quizzes: pending.quizzes, toGrade: pending.toGrade, dojo: pending.dojo, sheets: pending.sheets },
        lastSync: pending.lastSync ?? null,
        toGrade: d.open,
        quizzes: d.quizzes,
        dojo: d.dojo,
        sheets: d.sheets.map((s) => ({ subject: s.subject.id, sheet: s.sheet.id, label: s.sheet.label, status: s.sheet.status, tasks: s.sheet.tasks ?? [], answers: s.work?.answers ?? {} })),
      };
    },
  },
  {
    name: 'add_card',
    description: `Adds a card to a topic of the learner's pack. A card tests understanding (definitions, why, what if, short conceptual checks), never where something stands in the script; calculations and proofs belong in dojo drills. Do not write a replacement for a blocked card. ${SHARED_NOTE}`,
    writes: true,
    inputSchema: schema(
      {
        subject,
        topic,
        id: { type: 'string', description: 'Lowercase slug, unique in the topic.' },
        prompt: { type: 'string', minLength: 1, description: 'The question (Markdown, $…$ LaTeX). The topic title is shown above it, so it must not give the answer away.' },
        answer: { type: 'string', minLength: 1, description: 'Key points of a good answer as short Markdown bullets, plus a typical mistake.' },
        kind,
      },
      ['subject', 'topic', 'id', 'prompt', 'answer'],
    ),
    run: (fs, a) => addCard(fs, a as Parameters<typeof addCard>[1]),
  },
  {
    name: 'edit_card',
    description: `Changes the prompt, answer or kind of a card, for example when low scores point at an unclear question. Schedule and statistics stay. Blocked cards cannot be changed. ${SHARED_NOTE}`,
    writes: true,
    inputSchema: schema(
      { subject, topic, id: { type: 'string', description: 'Card id.' }, prompt: { type: 'string', minLength: 1 }, answer: { type: 'string', minLength: 1 }, kind },
      ['subject', 'topic', 'id'],
    ),
    run: (fs, a) => editCard(fs, a as Parameters<typeof editCard>[1]),
  },
  {
    name: 'set_topic_notes',
    description: 'Replaces the notes of a topic: scope, source and typical mistakes, the context for good questions. Read them with get_topic first and keep what still holds. Notes stay private, they are never pushed.',
    writes: true,
    inputSchema: schema({ subject, topic, notes: { type: 'string' } }, ['subject', 'topic', 'notes']),
    run: (fs, a) => setTopicNotes(fs, a.subject, a.topic, a.notes),
  },
  {
    name: 'set_topics_enabled',
    description:
      'Switches topics on or off, only when the learner asks for it, for example to study with one set of cards only. A switched-off topic leaves quizzes, study and the calendar; status, schedule, history and statistics stay and come back when it is switched on. To keep only some topics: switch all off, then those on. This is not `skip`, which clears the schedule.',
    writes: true,
    inputSchema: schema(
      {
        subject,
        enabled: { type: 'boolean' },
        topics: { type: 'array', items: { type: 'string' }, description: 'Topic ids. Default: every topic of the subject.' },
        match: { type: 'string', description: 'Only topics with this text in their title.' },
      },
      ['subject', 'enabled'],
    ),
    run: (fs, a) => setTopicsEnabled(fs, a as Parameters<typeof setTopicsEnabled>[1]),
  },
  {
    name: 'record_review',
    description: 'Records a grade for an answer given in the chat, with the app\'s scheduling rules. 0 no answer, 1 wrong, 2 big gaps, 3 right at the core, 4 right, 5 right and well reasoned. Never use it for answers made in the app: those are recorded already.',
    writes: true,
    inputSchema: schema(
      {
        subject,
        topic,
        score: { type: 'integer', minimum: 0, maximum: 5 },
        card: { type: 'string', description: 'Card id: reschedules this card alone. Without it the whole topic is graded (dojo tasks).' },
        source: { enum: ['quiz', 'dojo', 'manual'], description: 'Default quiz.' },
        note: { type: 'string' },
      },
      ['subject', 'topic', 'score'],
    ),
    run: (fs, a) => recordReview(fs, a as Parameters<typeof recordReview>[1]),
  },
  {
    name: 'mark_results_processed',
    description: 'Says the AI has seen everything get_new_results showed, which clears the banner. Quizzes still waiting for a grade stay open.',
    writes: true,
    inputSchema: schema({}),
    run: (fs) => markProcessed(fs),
  },
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validators = new Map(TOOLS.map((t) => [t.name, ajv.compile(t.inputSchema)]));

/** Runs a tool; throws on an unknown name or wrong arguments. */
export async function callTool(fs: PackFs, name: string, args: Args = {}): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool "${name}". Known: ${TOOLS.map((t) => t.name).join(', ')}`);
  const validate = validators.get(name)!;
  if (!validate(args)) throw new Error(`Wrong arguments for ${name}: ${ajv.errorsText(validate.errors, { dataVar: 'args' })}`);
  return tool.run(fs, args);
}
