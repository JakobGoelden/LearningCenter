import type { AiRequest } from '../model/types';
import { RESPONSE_SCHEMAS } from './requests';
import { extractJson } from './response';
import type { AiSettings } from './settings';

// The prompt is self-contained; the system message only pins the output contract.
const SYSTEM = 'You are a study assistant inside a learning app. Reply with exactly one JSON object as specified in the user message.';

async function viaAnthropic(req: AiRequest, s: AiSettings, signal: AbortSignal): Promise<unknown> {
  // Loaded on demand so the SDK is only downloaded when the API adapter is used.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true });
  const res = await client.beta.messages.create(
    {
      model: s.model || 'claude-opus-5-5',
      max_tokens: 16000,
      // On a policy decline the API retries on its default fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: s.effort,
        format: { type: 'json_schema', schema: RESPONSE_SCHEMAS[req.kind] },
      },
      system: SYSTEM,
      messages: [{ role: 'user', content: req.prompt }],
    },
    { signal },
  );
  if (res.stop_reason === 'refusal') {
    throw new Error(`The AI declined the request${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}.`);
  }
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off (max_tokens).');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return extractJson(text);
}

async function viaOpenAiCompatible(req: AiRequest, s: AiSettings, signal: AbortSignal): Promise<unknown> {
  if (!s.model) throw new Error('Please enter a model.');
  const res = await fetch(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: s.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: req.prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty answer from the API.');
  return extractJson(text);
}

export function sendViaApi(req: AiRequest, s: AiSettings, signal: AbortSignal): Promise<unknown> {
  if (s.provider === 'anthropic' && !s.apiKey) {
    return Promise.reject(new Error('No API key set (Settings).'));
  }
  return s.provider === 'anthropic' ? viaAnthropic(req, s, signal) : viaOpenAiCompatible(req, s, signal);
}
