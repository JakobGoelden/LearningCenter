import { useEffect, useRef, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { today } from '../lib/dates';
import { cardKey, deckOf, drawCard, withCardAnswer, withCardBlocked, type Card } from '../scheduling/cards';
import { SELF_SCORE, type SelfRating } from '../model/quiz';
import type { Score } from '../model/types';
import { Markdown } from './Markdown';
import { BackLink } from './BackLink';
import { href } from './router';

const RATE_KEYS: Record<string, SelfRating> = { '1': 'right', '2': 'partly', '3': 'wrong' };

/**
 * Endless mode: cards of one subject, as long as the learner wants. Weak cards
 * come up more often (see scheduling/cards.ts). Answers only feed the card
 * stats; the topic schedule is not touched.
 */
export function EndlessView({ subjectId }: { subjectId: string }) {
  const pack = usePack();
  const s = pack.subject(subjectId);
  const on = today();
  const shown = useRef<string[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [counts, setCounts] = useState({ right: 0, partly: 0, wrong: 0, blocked: 0 });
  const total = counts.right + counts.partly + counts.wrong;

  const next = (subject = s) => {
    const c = subject ? drawCard(deckOf(subject), on, shown.current) : null;
    if (c) shown.current = [...shown.current, cardKey(c)].slice(-10);
    setCard(c);
    setRevealed(false);
  };

  useEffect(() => next(), []);

  const rate = async (r: SelfRating) => {
    if (!s || !card || !revealed) return;
    const score = SELF_SCORE[r] as Score;
    setCounts((c) => ({ ...c, [r]: c[r] + 1 }));
    next(withCardAnswer(s, card, score, on));
    await pack.updateSubject(s.id, (subj) => withCardAnswer(subj, card, score, on), {
      type: 'card.answer',
      ref: `${card.topic.id}/${card.question.id}`,
      data: { mode: 'endless', score },
    });
  };

  const block = async () => {
    if (!s || !card) return;
    setCounts((c) => ({ ...c, blocked: c.blocked + 1 }));
    next(withCardBlocked(s, card));
    await pack.updateSubject(s.id, (subj) => withCardBlocked(subj, card), {
      type: 'question.block',
      ref: `${card.topic.id}/${card.question.id}`,
    });
  };

  // Space or Enter flips, 1 / 2 / 3 rate, B blocks, Esc turns the card back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || (el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && RATE_KEYS[e.key]) {
        e.preventDefault();
        void rate(RATE_KEYS[e.key]);
      } else if (revealed && e.key.toLowerCase() === 'b') void block();
      else if (revealed && e.key === 'Escape') {
        e.preventDefault();
        setRevealed(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!s) return <div class="error">This pack has no subject "{subjectId}".</div>;

  return (
    <div class="stack">
      <div class="page-head subject-head" style={{ '--c': s.color }}>
        <BackLink href={href({ name: 'subject', subject: s.id })} label={s.name} />
        <h1>Endless · {s.name}</h1>
        <span class="spacer" />
        <span class="small muted">
          {total} answered · {counts.right} knew it{counts.blocked ? ` · ${counts.blocked} blocked` : ''}
        </span>
      </div>

      {!card ? (
        <div class="panel">
          <p>There are no cards to ask in this subject.</p>
          <p class="small muted">
            Cards are the prepared questions of the topics. Topics that are skipped and blocked cards are left out. Your AI can add
            questions to the topics.
          </p>
        </div>
      ) : (
        <div class="panel stack" style={{ '--c': s.color }}>
          <span class="row small">
            <span class="badge">{card.topic.title}</span>
            {card.question.kind && <span class="badge">{card.question.kind}</span>}
            <span class="muted">
              {card.question.stats ? `seen ${card.question.stats.seen}× · last: ${card.question.stats.recent.join(' ')}` : 'new card'}
            </span>
          </span>
          <div class="prompt flash-prompt">
            <Markdown text={card.question.prompt} />
          </div>
          {!revealed ? (
            <div class="row">
              <button type="button" class="primary" onClick={() => setRevealed(true)}>
                Show answer <kbd>Space</kbd>
              </button>
            </div>
          ) : (
            <>
              {card.question.answer ? (
                <div class="key-points">
                  <strong class="small">Key points</strong>
                  <Markdown text={card.question.answer} />
                </div>
              ) : (
                <span class="small muted">No key points for this card. Check it against your script or notes.</span>
              )}
              <span class="small muted">How did you do?</span>
              <span class="rate">
                {(['right', 'partly', 'wrong'] as SelfRating[]).map((k, i) => (
                  <button type="button" class={`rate-${k}`} onClick={() => rate(k)}>
                    {k === 'right' ? '✓ Knew it' : k === 'partly' ? '~ Partly' : '✗ Not yet'} <kbd>{i + 1}</kbd>
                  </button>
                ))}
              </span>
              <div class="row">
                <button type="button" class="ghost small" onClick={() => setRevealed(false)} title="Flipped by mistake? Turn the card back to the question">
                  ↺ Turn back <kbd>Esc</kbd>
                </button>
                <button type="button" class="ghost small" onClick={block} title="Never ask this card again (stays on this machine)">
                  🚫 Block this card <kbd>B</kbd>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
