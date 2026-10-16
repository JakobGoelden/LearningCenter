import { assertValid } from '../model/validate';
import type { AiRequest, AiResponse, RequestKind } from '../model/types';

const REQUIRED_FIELD: Record<RequestKind, keyof AiResponse> = {
  'quiz.start': 'questions',
  'quiz.grade': 'grades',
  'dojo.task': 'task',
  'dojo.check': 'check',
  'dojo.hint': 'hint',
  'dojo.solution': 'solution',
};

/** Pulls the first JSON object out of model text (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Keine JSON-Antwort gefunden.');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    throw new Error(`Antwort ist kein gültiges JSON: ${(e as Error).message}`);
  }
}

/** Normalises a raw AI answer into a validated AiResponse for `req`. */
export function finalizeResponse(req: AiRequest, raw: unknown): AiResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Antwort ist kein JSON-Objekt.');
  const clean: Record<string, unknown> = { ...(raw as object), requestId: req.id, kind: req.kind };
  delete clean.$schema;
  // Structured outputs require every field; drop empty optional ones.
  if (Array.isArray(clean.questions)) {
    clean.questions = (clean.questions as Record<string, unknown>[]).map((q) =>
      Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')),
    );
  }
  const res = assertValid('response', clean, 'KI-Antwort');
  const field = REQUIRED_FIELD[req.kind];
  if (res[field] === undefined) throw new Error(`KI-Antwort enthält kein Feld "${field}".`);
  return res;
}
