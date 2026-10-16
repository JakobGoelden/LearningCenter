// TypeScript mirror of /schema/*.schema.json. The schema is the source of truth;
// keep both in sync when changing the format.

export type ISODate = string; // YYYY-MM-DD, local
export type ISODateTime = string;
export type Score = 0 | 1 | 2 | 3 | 4 | 5;
export type Level = 'easy' | 'medium' | 'exam';
export type TopicStatus = 'new' | 'shaky' | 'solid' | 'skip';
export type ExamFormat = 'written' | 'talk' | 'project' | 'unknown';
export type SheetStatus = 'open' | 'done' | 'checked';
export type CheckKind = 'material' | 'script' | 'notes' | 'other';

export interface PackSettings {
  reviewLadder?: number[];
  skipWeekends?: boolean;
  questionsPerQuiz?: number;
  language?: string;
}

export interface Pack {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  owner?: string;
  semester?: { label?: string; start?: ISODate; end?: ISODate };
  settings?: PackSettings;
  subjects: string[];
  dojos?: string[];
}

export interface Review {
  date: ISODate;
  score: Score;
  source: 'quiz' | 'dojo' | 'manual';
  sessionId?: string;
  note?: string;
}

export interface Topic {
  id: string;
  title: string;
  notes?: string;
  status: TopicStatus;
  due?: ISODate;
  intervalDays?: number;
  history?: Review[];
}

export interface Sheet {
  id: string;
  label: string;
  due?: ISODate;
  status: SheetStatus;
  url?: string;
  /** Path in the pack (e.g. material/db/sheet-3.pdf) or an https link. */
  file?: string;
  tasks?: SheetTask[];
  notes?: string;
}

export interface SheetTask {
  id: string;
  label: string;
  /** Markdown. */
  text: string;
  points?: number;
}

export type ClassKind = 'lecture' | 'tutorial' | 'lab' | 'seminar' | 'other';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** One weekly slot in the timetable. */
export interface ClassSlot {
  kind: ClassKind;
  weekday: Weekday;
  start: string;
  end: string;
  location?: string;
  from?: ISODate;
  until?: ISODate;
  notes?: string;
}

/** The learner's answers to a sheet (work/<subject>/<sheet>.json). */
export interface SheetWork {
  $schema?: string;
  subject: string;
  sheet: string;
  updatedAt?: string;
  /** Task id → Markdown; '_' when the sheet lists no tasks. */
  answers: Record<string, string>;
}

export interface OpenItem {
  id: string;
  text: string;
  createdAt?: ISODate;
  doneAt?: ISODate;
}

export interface Check {
  id: string;
  kind: CheckKind;
  label: string;
  lastChecked?: ISODate;
  version?: string;
  url?: string;
  everyDays?: number;
  note?: string;
}

export interface Exam {
  format: ExamFormat;
  date?: ISODate;
  time?: string;
  location?: string;
  durationMinutes?: number;
  aids?: string[];
  notes?: string;
}

export interface Subject {
  $schema?: string;
  id: string;
  name: string;
  short?: string;
  color?: string;
  notes?: string;
  exam: Exam;
  topics: Topic[];
  schedule?: ClassSlot[];
  sheets?: Sheet[];
  openItems?: OpenItem[];
  checks?: Check[];
}

export interface Dojo {
  $schema?: string;
  id: string;
  subject: string;
  title: string;
  procedure: string;
  description?: string;
  levels?: Level[];
  topics?: string[];
  aids?: string[];
  promptTemplate: string;
  answerFormat?: string;
}

export interface Step {
  label: string;
  ok: boolean;
  comment?: string;
}

export type QuestionKind = 'why' | 'what-if' | 'explain' | 'apply';

export interface SessionItem {
  n: number;
  topicId?: string;
  kind?: QuestionKind | 'task';
  prompt: string;
  answer?: string;
  score?: Score;
  feedback?: string;
  gaps?: string[];
  steps?: Step[];
  hints?: string[];
  solution?: string;
}

export interface Session {
  $schema?: string;
  id: string;
  type: 'quiz' | 'dojo';
  subject: string;
  dojo?: string;
  level?: Level;
  adapter?: string;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  applied?: boolean;
  summary?: string;
  items: SessionItem[];
}

export interface LogEvent {
  ts: ISODateTime;
  type: string;
  actor?: 'user' | 'ai' | 'app';
  subject?: string;
  ref?: string;
  data?: Record<string, unknown>;
}

export type RequestKind =
  | 'quiz.start'
  | 'quiz.grade'
  | 'dojo.task'
  | 'dojo.check'
  | 'dojo.hint'
  | 'dojo.solution';

export interface AiRequest {
  $schema?: string;
  id: string;
  kind: RequestKind;
  createdAt: ISODateTime;
  subject: string;
  sessionId?: string;
  dojo?: string;
  level?: Level;
  language?: string;
  summary?: string;
  context?: Record<string, unknown>;
  prompt: string;
}

export interface AiResponse {
  $schema?: string;
  requestId: string;
  kind: RequestKind;
  questions?: { topicId?: string; kind?: QuestionKind; prompt: string }[];
  grades?: { n: number; score: Score; feedback: string; gaps?: string[] }[];
  task?: string;
  check?: { correct?: boolean; score: Score; steps?: Step[]; feedback: string };
  hint?: string;
  solution?: string;
  summary?: string;
}

export interface Bundle {
  format: 'learningcenter-bundle';
  schemaVersion: 1;
  exportedAt?: ISODateTime;
  files: Record<string, string>;
}

/** A pack as held in memory by the app. */
export interface LoadedPack {
  pack: Pack;
  subjects: Subject[];
  dojos: Dojo[];
}
