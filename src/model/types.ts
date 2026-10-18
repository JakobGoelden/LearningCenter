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
  /** Prepared quiz questions; the app asks them without an AI. */
  questions?: TopicQuestion[];
  /** Id of the chapter (see Subject.chapters) the topic belongs to. */
  chapter?: string;
}

export interface TopicQuestion {
  id: string;
  prompt: string;
  kind?: QuestionKind;
  /** Key points of a good answer (Markdown), shown after answering. */
  answer?: string;
  /** Blocked on this machine: never asked again and not re-added by a sync. */
  blocked?: boolean;
  /** How the learner does with this card; drives the endless-mode priority, not the schedule. */
  stats?: CardStats;
}

export interface CardStats {
  /** Number of answers given. */
  seen: number;
  /** The last (up to 5) scores, oldest first. */
  recent: Score[];
  /** Date of the last answer. */
  last?: ISODate;
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
  /** Optional parts of the subject, in order. Topics point to one with `chapter`. */
  chapters?: Chapter[];
  schedule?: ClassSlot[];
  sheets?: Sheet[];
  openItems?: OpenItem[];
  checks?: Check[];
}

/** A part of a subject (e.g. a script chapter) the learner can switch on once the lecture has happened. */
export interface Chapter {
  id: string;
  title: string;
  /** False: the topics of this chapter are left out of quizzes, study, endless mode and the calendar. Default true. */
  enabled?: boolean;
}

export interface Dojo {
  $schema?: string;
  id: string;
  subject: string;
  title: string;
  procedure: string;
  description?: string;
  levels?: Level[];
  /** Chapter of the subject the dojo belongs to. */
  chapter?: string;
  topics?: string[];
  aids?: string[];
  promptTemplate: string;
  answerFormat?: string;
  /** Formula symbols (or group names, see src/dojo/symbols.ts) offered as buttons while answering. */
  symbols?: string[];
  /** Prepared exercises that run and get graded in the app. */
  drills?: Drill[];
}

/** Plain-data finite automaton; see src/dojo/automata.ts. */
export interface AutomatonData {
  states: string[];
  start: string;
  final: string[];
  transitions: [string, string, string][];
}

interface DrillBase {
  id: string;
  level?: Level;
  /** Topic id in the dojo's subject, if the drill trains one topic. */
  topic?: string;
  /** Markdown. */
  prompt: string;
  /** Shown after answering (Markdown). */
  explanation?: string;
  /** Time limit; defaults depend on level and kind. */
  seconds?: number;
}

export interface LanguageReference {
  regex?: string;
  automaton?: AutomatonData;
}

export type Drill = DrillBase &
  (
    | { kind: 'choice'; options: string[]; correct: number[] }
    | { kind: 'input'; accept: string[]; caseSensitive?: boolean }
    | { kind: 'number'; answer: number; tolerance?: number; unit?: string }
    | { kind: 'order'; items: string[] }
    | { kind: 'automaton'; alphabet: string[]; reference: LanguageReference; given?: AutomatonData; deterministic?: boolean; minimal?: boolean }
    | { kind: 'regex'; alphabet: string[]; reference: LanguageReference; given?: AutomatonData }
    | { kind: 'self'; solution: string }
  );

export interface Step {
  label: string;
  ok: boolean;
  comment?: string;
}

export type QuestionKind = 'why' | 'what-if' | 'explain' | 'apply';

export interface SessionItem {
  n: number;
  topicId?: string;
  kind?: QuestionKind | 'task' | 'drill';
  /** Drill id, for kind 'drill'. */
  drill?: string;
  /** Id of the prepared topic question, for quizzes run in the app. */
  question?: string;
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
  /** The answers wait for the AI to grade them later. */
  gradeLater?: boolean;
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
  | 'dojo.solution'
  | 'dojo.drills';

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
  drills?: Drill[];
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
