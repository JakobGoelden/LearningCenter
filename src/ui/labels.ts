import type { CardStats, CheckKind, ExamFormat, SheetStatus, TopicStatus, Weekday } from '../model/types';

export { CLASS_LABEL as CLASS_KIND } from '../model/derive';

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

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export const CHECK_KIND: Record<CheckKind, string> = {
  material: 'Material',
  script: 'Script',
  notes: 'Notes',
  other: 'Other',
};

export const SCORE_LABEL = ['no idea', 'wrong', 'major gaps', 'some gaps', 'correct', 'excellent'];

/** How a card went so far, as shown next to it while asking: "seen 4× · last: 5 3 5". */
export function cardStatsLine(stats?: CardStats): string {
  return stats ? `seen ${stats.seen}× · last: ${stats.recent.join(' ')}` : 'new card';
}

/** Running tally of self-ratings in a round: "6 answered · 4 knew it · 1 partly · 1 not yet". */
export function ratingTally(c: { right: number; partly: number; wrong: number; blocked?: number }): string {
  const total = c.right + c.partly + c.wrong;
  return [
    `${total} answered`,
    `${c.right} knew it`,
    c.partly && `${c.partly} partly`,
    c.wrong && `${c.wrong} not yet`,
    c.blocked && `${c.blocked} blocked`,
  ]
    .filter(Boolean)
    .join(' · ');
}
