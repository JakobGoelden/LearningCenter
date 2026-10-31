import { useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { parseGrades, withGrades } from '../ai/results';
import { today } from '../lib/dates';
import type { Session } from '../model/types';
import { quizScores, withQuizResults } from '../scheduling/cards';
import { loadSession, saveSession } from '../storage/repo';

/**
 * Saves the grades an AI chat gave for open quizzes. `session` is the quiz the
 * paste belongs to, when the block does not name one.
 */
export function PasteGrades({ session, onDone }: { session?: string; onDone(saved: Session[]): void }) {
  const { fs, loaded, log, updateSubject } = usePack();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { grades, summary } = parseGrades(text, session);
      // Check every session first, so a bad paste saves nothing.
      const graded = await Promise.all(
        [...new Set(grades.map((g) => g.session))].map(async (id) => {
          const found = await loadSession(fs, id);
          if (!found) throw new Error(`There is no quiz ${id}.`);
          if (!loaded.subjects.some((s) => s.id === found.subject)) throw new Error(`Quiz ${id} belongs to the unknown subject ${found.subject}.`);
          return withGrades(found, grades.filter((g) => g.session === id), summary);
        }),
      );
      const saved: Session[] = [];
      for (const s of graded.filter((g) => !g.applied)) {
        await saveSession(fs, s);
        await log({ type: 'quiz.graded', subject: s.subject, ref: s.id, actor: 'ai', data: { scores: s.items.map((i) => i.score ?? null) } });
        await updateSubject(s.subject, (subj) => withQuizResults(subj, s, today(), loaded.pack.settings), {
          type: 'quiz.applied',
          ref: s.id,
          actor: 'ai',
          data: { scores: quizScores(s) },
        });
        const applied = { ...s, applied: true };
        await saveSession(fs, applied);
        saved.push(applied);
      }
      setText('');
      onDone(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="paste-grades stack" style="gap:6px">
      <span class="small">When your AI is done, paste its answer here to save the grades:</span>
      <textarea class="mono" value={text} onInput={(e) => setText(e.currentTarget.value)} aria-label="AI answer with the grades" />
      <div class="row">
        <button class="primary small" disabled={!text.trim() || busy} onClick={save}>
          Save grades
        </button>
      </div>
      {error && <div class="error">{error}</div>}
    </div>
  );
}
