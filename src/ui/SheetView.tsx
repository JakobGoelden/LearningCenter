import { useEffect, useRef, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { diffDays, formatShort, relative, today } from '../lib/dates';
import { loadWork, saveWork } from '../storage/repo';
import type { Sheet, SheetStatus, SheetWork } from '../model/types';
import { Markdown } from './Markdown';
import { SHEET_STATUS } from './labels';
import { href } from './router';

/** Answer key used when the sheet lists no tasks. */
const WHOLE_SHEET = '_';
const SAVE_DELAY_MS = 800;

const isLink = (s: string) => /^https?:\/\//.test(s);
const extOf = (s: string) => s.slice(s.lastIndexOf('.') + 1).toLowerCase();

/** One exercise sheet: the sheet itself next to an editor for the learner's solutions. */
export function SheetView({ subjectId, sheetId }: { subjectId: string; sheetId: string }) {
  const { fs, subject, updateSubject, log, setNotice } = usePack();
  const s = subject(subjectId);
  const sheet = s?.sheets?.find((x) => x.id === sheetId);
  const [work, setWork] = useState<SheetWork | null>(null);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const timer = useRef<number>();
  const pending = useRef<SheetWork | null>(null);
  const logged = useRef(false);

  useEffect(() => {
    let live = true;
    loadWork(fs, subjectId, sheetId)
      .then((w) => live && setWork(w))
      .catch((e) => setNotice(`Could not load your answers: ${(e as Error).message}`));
    return () => {
      live = false;
    };
  }, [fs, subjectId, sheetId]);

  const flush = async () => {
    window.clearTimeout(timer.current);
    const w = pending.current;
    if (!w) return;
    pending.current = null;
    setSaved('saving');
    try {
      await saveWork(fs, w);
      setSaved(pending.current ? 'dirty' : 'saved');
      if (!logged.current) {
        logged.current = true;
        await log({ type: 'sheet.work', subject: subjectId, ref: sheetId });
      }
    } catch (e) {
      setSaved('dirty');
      setNotice(`Could not save your answers: ${(e as Error).message}`);
    }
  };

  // Save what is still pending when leaving the page.
  useEffect(() => () => void flush(), []);

  if (!s) return <div class="error">This pack has no subject "{subjectId}".</div>;
  if (!sheet) return <div class="error">{s.name} has no sheet "{sheetId}".</div>;

  const setAnswer = (key: string, text: string) => {
    const next = { ...work!, answers: { ...work!.answers, [key]: text } };
    if (!text) delete next.answers[key];
    setWork(next);
    pending.current = next;
    setSaved('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  const setStatus = (to: SheetStatus) =>
    updateSubject(
      s.id,
      (subj) => ({ ...subj, sheets: subj.sheets?.map((sh) => (sh.id === sheet.id ? { ...sh, status: to } : sh)) }),
      { type: 'sheet.status', ref: sheet.id, data: { from: sheet.status, to } },
    );

  const on = today();
  const late = sheet.status === 'open' && sheet.due && diffDays(on, sheet.due) < 0;
  const tasks = sheet.tasks ?? [];
  const hasDoc = !!sheet.file;

  return (
    <div class="stack">
      <div class="page-head">
        <a href={href({ name: 'subject', subject: s.id })}>← {s.name}</a>
        <h1 style={{ borderLeft: `6px solid ${s.color ?? 'var(--accent)'}`, paddingLeft: '10px' }}>{sheet.label}</h1>
        {sheet.due && (
          <span class={`badge${late ? ' danger' : ''}`}>
            due {formatShort(sheet.due)} ({relative(sheet.due, on)})
          </span>
        )}
        <span class="spacer" />
        <div class="segmented" role="group" aria-label="Sheet status">
          {(Object.keys(SHEET_STATUS) as SheetStatus[]).map((st) => (
            <button class={`small${sheet.status === st ? ' primary' : ''}`} aria-pressed={sheet.status === st} onClick={() => setStatus(st)}>
              {SHEET_STATUS[st]}
            </button>
          ))}
        </div>
      </div>

      <div class={hasDoc ? 'sheet-layout' : 'stack'}>
        {hasDoc && <SheetDocument sheet={sheet} />}

        <section class="panel stack">
          <div class="row">
            <h3 style="flex:1">Your solutions</h3>
            <span class="small muted" aria-live="polite">
              {work === null ? 'Loading …' : saved === 'saved' ? (Object.keys(work.answers).length ? 'Saved' : '') : saved === 'saving' ? 'Saving …' : 'Unsaved changes'}
            </span>
          </div>
          {work !== null &&
            (tasks.length > 0 ? (
              tasks.map((t) => (
                <div class="task stack">
                  <div class="row small">
                    <strong>{t.label}</strong>
                    {t.points !== undefined && <span class="muted">{t.points} pts</span>}
                  </div>
                  <Markdown text={t.text} />
                  <textarea
                    value={work.answers[t.id] ?? ''}
                    onInput={(e) => setAnswer(t.id, e.currentTarget.value)}
                    onBlur={() => void flush()}
                    placeholder="Your answer …"
                    aria-label={`Answer to ${t.label}`}
                  />
                </div>
              ))
            ) : (
              <>
                {!hasDoc && sheet.url && (
                  <a href={sheet.url} target="_blank" rel="noreferrer">
                    Open the sheet
                  </a>
                )}
                <textarea
                  style="min-height:320px"
                  value={work.answers[WHOLE_SHEET] ?? ''}
                  onInput={(e) => setAnswer(WHOLE_SHEET, e.currentTarget.value)}
                  onBlur={() => void flush()}
                  placeholder="Your solution …"
                  aria-label={`Solution for ${sheet.label}`}
                />
                <div class="small muted">
                  Tip: ask your AI to add the tasks of this sheet as text (field <code>tasks</code>), then you can answer them one by
                  one here.
                </div>
              </>
            ))}
          {sheet.status === 'open' && work && Object.keys(work.answers).length > 0 && (
            <div>
              <button
                class="primary"
                onClick={async () => {
                  await flush();
                  await setStatus('done');
                }}
              >
                Mark as done
              </button>
            </div>
          )}
          <div class="small muted">
            Saved in <code>work/{s.id}/{sheet.id}.json</code> in your pack.
          </div>
        </section>
      </div>
    </div>
  );
}

/** Shows the sheet file: PDF or image inline, text as Markdown, links as a button. */
function SheetDocument({ sheet }: { sheet: Sheet }) {
  const { fs } = usePack();
  const file = sheet.file!;
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState<string | null>(null);
  const ext = extOf(file);
  const asText = ext === 'md' || ext === 'txt';

  useEffect(() => {
    if (isLink(file)) return;
    let live = true;
    if (asText) fs.read(file).then((t) => live && (setText(t), setUrl(t === null ? null : '')));
    else if (fs.fileUrl) fs.fileUrl(file).then((u) => live && setUrl(u));
    else setUrl(null);
    return () => {
      live = false;
    };
  }, [fs, file]);

  let body;
  if (isLink(file)) {
    body = (
      <div class="stack">
        <div class="small muted">The sheet is online. It opens in a new tab, so you can keep writing here.</div>
        <a class="btn" href={file} target="_blank" rel="noreferrer">
          Open {sheet.label}
        </a>
      </div>
    );
  } else if (url === undefined) {
    body = <div class="small muted">Loading …</div>;
  } else if (url === null) {
    body = (
      <div class="small muted">
        {fs.fileUrl ? (
          <>
            <code>{file}</code> is not in the pack folder.
          </>
        ) : (
          <>This pack lives in the browser, which cannot hold files like PDFs. Open the pack folder to see the sheet.</>
        )}
      </div>
    );
  } else if (asText) {
    body = <Markdown text={text ?? ''} />;
  } else if (['png', 'jpg', 'jpeg', 'svg'].includes(ext)) {
    body = <img src={url} alt={sheet.label} style="max-width:100%" />;
  } else {
    body = (
      <>
        <iframe class="sheet-frame" src={url} title={sheet.label} />
        <a class="small" href={url} target="_blank" rel="noreferrer">
          Open in a new tab
        </a>
      </>
    );
  }
  return <section class="panel stack sheet-doc">{body}</section>;
}
