import type { CheckKind, ExamFormat, SheetStatus, TopicStatus } from '../model/types';

export const EXAM_FORMAT: Record<ExamFormat, string> = {
  written: 'Written exam',
  talk: 'Talk / oral exam',
  project: 'Project',
  unknown: 'Format unclear',
};

export const TOPIC_STATUS: Record<TopicStatus, string> = {
  new: 'new',
  shaky: 'shaky',
  solid: 'solid',
  skip: 'skip',
};

export const SHEET_STATUS: Record<SheetStatus, string> = {
  open: 'open',
  done: 'done',
  checked: 'checked',
};

export const NEXT_SHEET_STATUS: Record<SheetStatus, SheetStatus> = {
  open: 'done',
  done: 'checked',
  checked: 'open',
};

export const CHECK_KIND: Record<CheckKind, string> = {
  material: 'Material',
  script: 'Script',
  notes: 'Notes',
  other: 'Other',
};

export const SCORE_LABEL = ['no idea', 'wrong', 'major gaps', 'some gaps', 'correct', 'excellent'];
