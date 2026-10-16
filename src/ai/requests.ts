import system from '../../prompts/system.md?raw';
import quizStart from '../../prompts/quiz-start.md?raw';
import quizGrade from '../../prompts/quiz-grade.md?raw';
import dojoTask from '../../prompts/dojo-task.md?raw';
import dojoCheck from '../../prompts/dojo-check.md?raw';
import dojoHint from '../../prompts/dojo-hint.md?raw';
import dojoSolution from '../../prompts/dojo-solution.md?raw';
import dojoDrills from '../../prompts/dojo-drills.md?raw';
import { nowIso } from '../lib/dates';
import type { AiRequest, Dojo, Level, Pack, RequestKind, SessionItem, Subject, Topic } from '../model/types';

const TEMPLATES: Record<RequestKind, string> = {
  'quiz.start': quizStart,
  'quiz.grade': quizGrade,
  'dojo.task': dojoTask,
  'dojo.check': dojoCheck,
  'dojo.hint': dojoHint,
  'dojo.solution': dojoSolution,
  'dojo.drills': dojoDrills,
};

const LANGUAGES: Record<string, string> = { de: 'German (Deutsch)', en: 'English' };
export const LEVEL_LABEL: Record<Level, string> = { easy: 'easy', medium: 'medium', exam: 'exam level' };

/** Replaces {{name}} placeholders; unknown names are left as they are. */
export function fill(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, name: string) => {
    const v = vars[name];
    return v === undefined ? m : String(v);
  });
}

// Minimal JSON schemas per request kind. Every property is required so they
// also work as structured-output formats for the API adapter.
const str = { type: 'string' };
const score = { type: 'integer', enum: [0, 1, 2, 3, 4, 5] };
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const arr = (items: unknown) => ({ type: 'array', items });

export const RESPONSE_SCHEMAS: Record<RequestKind, Record<string, unknown>> = {
  'quiz.start': obj({
    questions: arr(obj({ topicId: str, kind: { type: 'string', enum: ['why', 'what-if', 'explain', 'apply'] }, prompt: str })),
  }),
  'quiz.grade': obj({
    grades: arr(obj({ n: { type: 'integer' }, score, feedback: str, gaps: arr(str) })),
    summary: str,
  }),
  'dojo.task': obj({ task: str }),
  'dojo.check': obj({
    check: obj({ correct: { type: 'boolean' }, score, steps: arr(obj({ label: str, ok: { type: 'boolean' }, comment: str })), feedback: str }),
  }),
  'dojo.hint': obj({ hint: str }),
  'dojo.solution': obj({ solution: str }),
  // One flat shape for every drill kind, since structured outputs need fixed
  // fields; unused fields come back empty and normalizeDrill drops them.
  'dojo.drills': obj({
    drills: arr(
      obj({
        id: str,
        kind: { type: 'string', enum: ['choice', 'input', 'number', 'order', 'regex', 'automaton', 'self'] },
        level: { type: 'string', enum: ['easy', 'medium', 'exam'] },
        topic: str,
        prompt: str,
        explanation: str,
        options: arr(str),
        correct: arr({ type: 'integer' }),
        accept: arr(str),
        answer: { type: 'number' },
        tolerance: { type: 'number' },
        unit: str,
        items: arr(str),
        alphabet: arr(str),
        referenceRegex: str,
        deterministic: { type: 'boolean' },
        minimal: { type: 'boolean' },
        solution: str,
      }),
    ),
  }),
};

const EXAMPLES: Record<RequestKind, unknown> = {
  'quiz.start': { questions: [{ topicId: '<topic id>', kind: 'why', prompt: 'Why …?' }] },
  'quiz.grade': {
    grades: [{ n: 1, score: 3, feedback: 'Mostly right, but …', gaps: ['…'] }],
    summary: '…',
  },
  'dojo.task': { task: 'Markdown text of the task' },
  'dojo.check': {
    check: {
      correct: false,
      score: 3,
      steps: [{ label: 'Step 1', ok: true, comment: '' }],
      feedback: '…',
    },
  },
  'dojo.hint': { hint: '…' },
  'dojo.solution': { solution: 'Markdown text of the model solution' },
  'dojo.drills': {
    drills: [
      { id: 'example-choice', kind: 'choice', level: 'easy', topic: '', prompt: '…', explanation: '…', options: ['…', '…', '…'], correct: [1] },
      { id: 'example-number', kind: 'number', level: 'medium', topic: '<topic id>', prompt: '…', explanation: '…', answer: 42, tolerance: 0, unit: '' },
      { id: 'example-regex', kind: 'regex', level: 'exam', topic: '', prompt: '…', explanation: '…', alphabet: ['a', 'b'], referenceRegex: '(a|b)*abb' },
    ],
  },
};

export function newRequestId(kind: RequestKind, subject: string): string {
  const stamp = nowIso().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${kind.replace('.', '-')}-${subject}-${rand}`;
}

interface BuildArgs {
  pack: Pack;
  subject: Subject;
  kind: RequestKind;
  summary: string;
  context: Record<string, unknown>;
  vars?: Record<string, string | number | undefined>;
  sessionId?: string;
  dojo?: Dojo;
  level?: Level;
}

function build(a: BuildArgs): AiRequest {
  const language = a.pack.settings?.language ?? 'en';
  const vars = { subject: a.subject.name, language: LANGUAGES[language] ?? language, ...a.vars };
  const id = newRequestId(a.kind, a.subject.id);
  const prompt = [
    fill(system, vars).trim(),
    fill(TEMPLATES[a.kind], vars).trim(),
    '## Context',
    '```json\n' + JSON.stringify(a.context, null, 2) + '\n```',
    '## Answer format',
    'Reply with exactly one JSON object in exactly this shape, with no text before or after it:',
    '```json\n' + JSON.stringify(EXAMPLES[a.kind], null, 2) + '\n```',
  ].join('\n\n');
  return {
    id,
    kind: a.kind,
    createdAt: nowIso(),
    subject: a.subject.id,
    sessionId: a.sessionId,
    dojo: a.dojo?.id,
    level: a.level,
    language,
    summary: a.summary,
    context: a.context,
    prompt,
  };
}

function examContext(s: Subject) {
  return { name: s.name, exam: s.exam };
}

function topicContext(t: Topic) {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    due: t.due,
    lastScores: (t.history ?? []).slice(-3).map((h) => h.score),
  };
}

export function quizStartRequest(pack: Pack, subject: Subject, topics: Topic[], sessionId: string): AiRequest {
  return build({
    pack,
    subject,
    kind: 'quiz.start',
    sessionId,
    summary: `Quiz ${subject.name}: generate ${topics.length} questions`,
    vars: { count: topics.length },
    context: { subject: examContext(subject), count: topics.length, topics: topics.map(topicContext) },
  });
}

export function quizGradeRequest(pack: Pack, subject: Subject, items: SessionItem[], sessionId: string): AiRequest {
  const topics = new Map(subject.topics.map((t) => [t.id, t]));
  return build({
    pack,
    subject,
    kind: 'quiz.grade',
    sessionId,
    summary: `Quiz ${subject.name}: grade ${items.length} answers`,
    context: {
      subject: examContext(subject),
      questions: items.map((i) => ({
        n: i.n,
        topicId: i.topicId,
        topic: i.topicId ? topics.get(i.topicId)?.title : undefined,
        topicNotes: i.topicId ? topics.get(i.topicId)?.notes : undefined,
        question: i.prompt,
        answer: i.answer ?? '',
      })),
    },
  });
}

function dojoVars(pack: Pack, subject: Subject, dojo: Dojo, level: Level) {
  const language = pack.settings?.language ?? 'en';
  const base = {
    level: `${level} (${LEVEL_LABEL[level]})`,
    procedure: dojo.procedure,
    subject: subject.name,
    aids: dojo.aids?.length ? dojo.aids.join(', ') : 'none in particular',
    language: LANGUAGES[language] ?? language,
  };
  return {
    ...base,
    dojo: dojo.title,
    template: fill(dojo.promptTemplate, base),
    answerFormat: dojo.answerFormat ? `Answer format expected from the learner: ${dojo.answerFormat}` : '',
  };
}

interface DojoArgs {
  pack: Pack;
  subject: Subject;
  dojo: Dojo;
  level: Level;
  sessionId: string;
}

export function dojoTaskRequest(a: DojoArgs): AiRequest {
  return build({
    ...a,
    kind: 'dojo.task',
    summary: `Dojo ${a.dojo.title}: generate task (${LEVEL_LABEL[a.level]})`,
    vars: dojoVars(a.pack, a.subject, a.dojo, a.level),
    context: { subject: examContext(a.subject), dojo: a.dojo.title, procedure: a.dojo.procedure, level: a.level },
  });
}

export function dojoCheckRequest(a: DojoArgs & { task: string; answer: string; hintsUsed: number }): AiRequest {
  return build({
    ...a,
    kind: 'dojo.check',
    summary: `Dojo ${a.dojo.title}: check solution`,
    vars: dojoVars(a.pack, a.subject, a.dojo, a.level),
    context: { procedure: a.dojo.procedure, level: a.level, task: a.task, answer: a.answer, hintsUsed: a.hintsUsed },
  });
}

export function dojoHintRequest(a: DojoArgs & { task: string; answer: string; previousHints: string[] }): AiRequest {
  return build({
    ...a,
    kind: 'dojo.hint',
    summary: `Dojo ${a.dojo.title}: hint`,
    vars: dojoVars(a.pack, a.subject, a.dojo, a.level),
    context: { procedure: a.dojo.procedure, task: a.task, answer: a.answer, previousHints: a.previousHints },
  });
}

export function dojoSolutionRequest(a: DojoArgs & { task: string }): AiRequest {
  return build({
    ...a,
    kind: 'dojo.solution',
    summary: `Dojo ${a.dojo.title}: model solution`,
    vars: dojoVars(a.pack, a.subject, a.dojo, a.level),
    context: { procedure: a.dojo.procedure, level: a.level, task: a.task },
  });
}

export function dojoDrillsRequest(a: DojoArgs & { count: number }): AiRequest {
  return build({
    ...a,
    kind: 'dojo.drills',
    summary: `Dojo ${a.dojo.title}: write ${a.count} new exercises`,
    vars: { ...dojoVars(a.pack, a.subject, a.dojo, a.level), count: a.count },
    context: {
      subject: examContext(a.subject),
      topics: a.subject.topics.filter((t) => t.status !== 'skip').map((t) => ({ id: t.id, title: t.title, notes: t.notes })),
      dojo: { title: a.dojo.title, procedure: a.dojo.procedure, description: a.dojo.description, topics: a.dojo.topics },
      existingDrills: (a.dojo.drills ?? []).map((d) => ({ id: d.id, kind: d.kind, level: d.level, prompt: d.prompt.slice(0, 160) })),
      count: a.count,
    },
  });
}
