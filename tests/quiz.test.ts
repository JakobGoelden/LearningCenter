import { describe, expect, it } from 'vitest';
import { questionFor } from '../src/model/quiz';
import type { Topic } from '../src/model/types';

describe('questionFor', () => {
  const base: Topic = { id: 'nf', title: 'Normal forms', status: 'new' };

  it('falls back to a general question without prepared ones', () => {
    const q = questionFor(base);
    expect(q.id).toBeUndefined();
    expect(q.prompt).toContain('Normal forms');
  });

  it('takes turns through the prepared questions', () => {
    const questions = [
      { id: 'a', prompt: 'A?', answer: 'key A' },
      { id: 'b', prompt: 'B?', kind: 'why' as const },
    ];
    const review = { date: '2026-10-16', score: 4 as const, source: 'quiz' as const };
    expect(questionFor({ ...base, questions })).toMatchObject({ id: 'a', answer: 'key A' });
    expect(questionFor({ ...base, questions, history: [review] })).toMatchObject({ id: 'b', kind: 'why' });
    expect(questionFor({ ...base, questions, history: [review, review] }).id).toBe('a');
  });
});
