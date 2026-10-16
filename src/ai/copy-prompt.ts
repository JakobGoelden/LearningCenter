import type { AiRequest } from '../model/types';
import { extractJson } from './response';

/** Text to paste into any AI chat. */
export function copyPromptText(req: AiRequest): string {
  return req.prompt;
}

/** Parses what the user pasted back from the chat. */
export function parsePasted(text: string): unknown {
  return extractJson(text);
}
