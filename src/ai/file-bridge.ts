import { toJson } from '../storage/repo';
import type { PackFs } from '../storage/fs';
import type { AiRequest } from '../model/types';

export const INBOX = 'inbox';
export const OUTBOX = 'outbox';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Cancelled', 'AbortError'));
    });
  });

/**
 * Writes the request to inbox/<id>.json and waits for outbox/<id>.json.
 * Afterwards both files are removed; the session file and event log keep the content.
 */
export async function sendViaFileBridge(
  fs: PackFs,
  req: AiRequest,
  signal: AbortSignal,
  pollSeconds = 2,
): Promise<unknown> {
  const inPath = `${INBOX}/${req.id}.json`;
  const outPath = `${OUTBOX}/${req.id}.json`;
  await fs.write(inPath, toJson({ $schema: '../../../schema/request.schema.json', ...req }));
  try {
    for (;;) {
      await sleep(pollSeconds * 1000, signal);
      const text = await fs.read(outPath);
      if (text === null) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue; // Probably still being written.
      }
      await fs.remove(outPath);
      await fs.remove(inPath);
      return parsed;
    }
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') await fs.remove(inPath);
    throw e;
  }
}
