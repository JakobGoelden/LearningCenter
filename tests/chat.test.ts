import { describe, expect, it } from 'vitest';
import { sheetChatPrompt } from '../src/ai/chat';
import type { Pack, Sheet, Subject } from '../src/model/types';

const pack = { id: 'p', title: 'P', subjects: ['db'] } as Pack;
const subject = { id: 'db', name: 'Databases', topics: [] } as unknown as Subject;
const sheet: Sheet = {
  id: 'sheet-02',
  label: 'Sheet 2',
  status: 'open',
  file: 'material/db/sheet-02.pdf',
  tasks: [
    { id: 't1', label: 'Task 1', text: 'Normalise R.', points: 4 },
    { id: 't2', label: 'Task 2', text: 'Write the SQL.' },
  ],
};

describe('sheetChatPrompt', () => {
  it('points the AI at the pack files and the work file', () => {
    const p = sheetChatPrompt({
      fs: { kind: 'dev', label: 'local/s3', sharedWithAi: true },
      pack,
      subject,
      sheet,
      work: { subject: 'db', sheet: 'sheet-02', answers: { t1: 'R is in 2NF' } },
    });
    expect(p).toContain('"Sheet 2" (Databases)');
    expect(p).toContain('Working on a sheet in the chat');
    expect(p).toContain('work/db/sheet-02.json');
    expect(p).toContain('answers to 1 task');
    expect(p).not.toContain('Normalise R.');
  });

  it('inlines tasks and answers when the pack lives in the browser', () => {
    const p = sheetChatPrompt({
      fs: { kind: 'browser', label: 'Browser', sharedWithAi: false },
      pack,
      subject,
      sheet,
      work: { subject: 'db', sheet: 'sheet-02', answers: { t1: 'R is in 2NF' } },
    });
    expect(p).toContain('Task 1 (4 pts):\nNormalise R.\nMy answer so far: R is in 2NF');
    expect(p).toContain('Task 2:\nWrite the SQL.');
    expect(p).not.toContain('\n\n\n');
  });
});
