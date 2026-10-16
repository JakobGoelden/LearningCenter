import { describe, expect, it } from 'vitest';
import { pendingResults } from '../src/model/sync';
import type { LogEvent } from '../src/model/types';

const ev = (type: string, ref?: string, extra: Partial<LogEvent> = {}): LogEvent => ({ ts: '2026-10-16T09:00:00Z', type, actor: 'user', ...(ref ? { ref } : {}), ...extra });

describe('pending results', () => {
  it('is empty without activity', () => {
    expect(pendingResults([]).total).toBe(0);
  });

  it('counts quizzes, dojo rounds and finished sheets once per ref', () => {
    const r = pendingResults([
      ev('quiz.applied', 'q1'),
      ev('dojo.drill.round', 'd1'),
      ev('dojo.applied', 'd1'),
      ev('sheet.status', 's1', { subject: 'db', data: { from: 'open', to: 'done' } }),
      ev('sheet.status', 's2', { subject: 'db', data: { from: 'open', to: 'started' } }),
      ev('sheet.work', 's1', { subject: 'db' }),
    ]);
    expect(r).toMatchObject({ quizzes: 1, dojo: 1, sheets: 1, toGrade: 0, total: 3 });
  });

  it('starts over after ai.sync and ignores what the AI did itself', () => {
    const r = pendingResults([ev('quiz.applied', 'q1'), ev('ai.sync', undefined, { actor: 'ai' }), ev('quiz.applied', 'q2', { actor: 'ai' }), ev('dojo.drill.round', 'd2')]);
    expect(r).toMatchObject({ quizzes: 0, dojo: 1, total: 1, lastSync: '2026-10-16T09:00:00Z' });
  });

  it('keeps quizzes to grade until they are applied, even across a sync', () => {
    const events = [ev('quiz.gradeLater', 'q3'), ev('ai.sync', undefined, { actor: 'ai' })];
    expect(pendingResults(events).toGrade).toBe(1);
    expect(pendingResults([...events, ev('quiz.applied', 'q3', { actor: 'ai' })]).toGrade).toBe(0);
  });
});
