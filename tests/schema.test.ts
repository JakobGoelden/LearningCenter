import { describe, expect, it } from 'vitest';
import { check } from '../src/model/validate';

describe('schema', () => {
  it('accepts a minimal subject', () => {
    expect(
      check('subject', { id: 'db', name: 'Databases', exam: { format: 'written' }, topics: [] }),
    ).toBeNull();
  });

  it('rejects bad dates and unknown fields', () => {
    const errors = check('subject', {
      id: 'db',
      name: 'Databases',
      exam: { format: 'written', date: '16.10.2026' },
      topics: [],
      extra: true,
    });
    expect(errors?.length).toBeGreaterThan(0);
  });

  it('validates responses with steps', () => {
    expect(
      check('response', {
        requestId: 'r1',
        kind: 'dojo.check',
        check: { score: 4, feedback: 'ok', steps: [{ label: 'Startzustand', ok: true }] },
      }),
    ).toBeNull();
  });
});
