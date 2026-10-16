import { assertValid, check } from '../model/validate';
import { drillProblems, normalizeDrill } from '../dojo/drills';
import type { AiRequest, AiResponse, Drill, RequestKind } from '../model/types';

const REQUIRED_FIELD: Record<RequestKind, keyof AiResponse> = {
  'quiz.start': 'questions',
  'quiz.grade': 'grades',
  'dojo.task': 'task',
  'dojo.check': 'check',
  'dojo.hint': 'hint',
  'dojo.solution': 'solution',
  'dojo.drills': 'drills',
};

/** Pulls the first JSON object out of model text (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON answer found.');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    throw new Error(`Answer is not valid JSON: ${(e as Error).message}`);
  }
}

/** Normalises a raw AI answer into a validated AiResponse for `req`. */
export function finalizeResponse(req: AiRequest, raw: unknown): AiResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Answer is not a JSON object.');
  const clean: Record<string, unknown> = { ...(raw as object), requestId: req.id, kind: req.kind };
  delete clean.$schema;
  // Structured outputs require every field; drop empty optional ones.
  if (Array.isArray(clean.questions)) {
    clean.questions = (clean.questions as Record<string, unknown>[]).map((q) =>
      Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')),
    );
  }
  // Keep the usable drills and drop broken ones instead of failing the whole answer.
  const dropped: string[] = [];
  if (Array.isArray(clean.drills)) {
    const usable: Drill[] = [];
    for (const raw of clean.drills as Record<string, unknown>[]) {
      const d = normalizeDrill(raw);
      const shell = { id: 'x', subject: 'x', title: 'x', procedure: 'x', promptTemplate: 'x', drills: [d] };
      const problems = check('dojo', shell) ? ['does not match the drill format'] : drillProblems(d as unknown as Drill);
      if (problems.length) dropped.push(`${String(d.id ?? '?')}: ${problems[0]}`);
      else usable.push(d as unknown as Drill);
    }
    if (!usable.length) throw new Error(`None of the exercises were usable. ${dropped.slice(0, 3).join('; ')}`);
    clean.drills = usable;
    if (dropped.length) clean.summary = `Skipped ${dropped.length} broken exercise(s): ${dropped.join('; ')}`;
  }
  const res = assertValid('response', clean, 'AI answer');
  const field = REQUIRED_FIELD[req.kind];
  if (res[field] === undefined) throw new Error(`AI answer has no "${field}" field.`);
  return res;
}
