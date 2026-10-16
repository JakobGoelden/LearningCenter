import type { CheckKind, ExamFormat, SheetStatus, TopicStatus } from '../model/types';

export const EXAM_FORMAT: Record<ExamFormat, string> = {
  written: 'Klausur',
  talk: 'Vortrag / mündlich',
  project: 'Projekt',
  unknown: 'Form unklar',
};

export const TOPIC_STATUS: Record<TopicStatus, string> = {
  new: 'neu',
  shaky: 'unsicher',
  solid: 'sicher',
  skip: 'nicht abfragen',
};

export const SHEET_STATUS: Record<SheetStatus, string> = {
  open: 'offen',
  done: 'bearbeitet',
  checked: 'geprüft',
};

export const NEXT_SHEET_STATUS: Record<SheetStatus, SheetStatus> = {
  open: 'done',
  done: 'checked',
  checked: 'open',
};

export const CHECK_KIND: Record<CheckKind, string> = {
  material: 'Material',
  script: 'Skript',
  notes: 'Mitschrift',
  other: 'Sonstiges',
};

export const SCORE_LABEL = ['keine Ahnung', 'falsch', 'große Lücken', 'mit Lücken', 'richtig', 'sehr gut'];
