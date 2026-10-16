import { describe, expect, it } from 'vitest';
import { check } from '../src/model/validate';
import { demoBundle } from '../src/storage/builtin';
import { importBundle, loadPack } from '../src/storage/repo';
import { dojoTaskRequest, fill, quizStartRequest } from '../src/ai/requests';
import { extractJson, finalizeResponse } from '../src/ai/response';
import { sendViaFileBridge } from '../src/ai/file-bridge';
import { MemFs } from './memfs';

async function demo() {
  const fs = new MemFs();
  await importBundle(fs, demoBundle());
  return { fs, ...(await loadPack(fs)) };
}

describe('ai requests', () => {
  it('builds schema-valid, self-contained requests', async () => {
    const { pack, subjects, dojos } = await demo();
    const theo = subjects[0];
    const quiz = quizStartRequest(pack, theo, theo.topics.slice(0, 3), 's1');
    expect(check('request', quiz)).toBeNull();
    expect(quiz.prompt).toContain('genau 3 Verständnisfragen');
    expect(quiz.prompt).toContain('Theoretische Informatik');

    const task = dojoTaskRequest({ pack, subject: theo, dojo: dojos[0], level: 'exam', sessionId: 's2' });
    expect(check('request', task)).toBeNull();
    expect(task.prompt).toContain('Potenzmengenkonstruktion');
    expect(task.prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it('fills placeholders', () => {
    expect(fill('{{a}} {{b}}', { a: 1 })).toBe('1 {{b}}');
  });
});

describe('ai responses', () => {
  it('extracts JSON from fenced chat output', () => {
    expect(extractJson('Klar!\n```json\n{"hint":"x"}\n```\nViel Erfolg')).toEqual({ hint: 'x' });
  });

  it('validates and stamps responses', async () => {
    const { pack, subjects } = await demo();
    const req = quizStartRequest(pack, subjects[1], subjects[1].topics.slice(0, 1), 's1');
    const res = finalizeResponse(req, { questions: [{ topicId: '', kind: 'why', prompt: 'Warum?' }] });
    expect(res.requestId).toBe(req.id);
    expect(res.questions?.[0].topicId).toBeUndefined();
    expect(() => finalizeResponse(req, { hint: 'x' })).toThrow(/questions/);
  });

  it('round-trips through the file bridge', async () => {
    const { fs, pack, subjects } = await demo();
    const req = quizStartRequest(pack, subjects[0], subjects[0].topics.slice(0, 1), 's1');
    const pending = sendViaFileBridge(fs, req, new AbortController().signal, 0.01);
    await new Promise((r) => setTimeout(r, 5));
    expect(JSON.parse((await fs.read(`inbox/${req.id}.json`))!).prompt).toBe(req.prompt);
    await fs.write(`outbox/${req.id}.json`, JSON.stringify({ questions: [{ prompt: 'Warum?' }] }));
    expect(await pending).toEqual({ questions: [{ prompt: 'Warum?' }] });
    expect(await fs.read(`inbox/${req.id}.json`)).toBeNull();
  });
});
