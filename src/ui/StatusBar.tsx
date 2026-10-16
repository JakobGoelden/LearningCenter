import type { TopicStatus } from '../model/types';
import { TOPIC_STATUS } from './labels';

const ORDER: TopicStatus[] = ['solid', 'shaky', 'new', 'skip'];

/** Stacked bar of topics by status, with an optional legend. */
export function StatusBar({ counts, legend = false }: { counts: Record<TopicStatus, number>; legend?: boolean }) {
  const total = ORDER.reduce((n, s) => n + counts[s], 0) || 1;
  const label = ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${TOPIC_STATUS[s]}`).join(', ');
  return (
    <>
      <div class="statusbar" role="img" aria-label={`Topics: ${label || 'none'}`}>
        {ORDER.map((st) => (
          <span class={`st-${st}`} style={{ width: `${(counts[st] / total) * 100}%` }} />
        ))}
      </div>
      {legend && (
        <div class="legend">
          {ORDER.map((st) =>
            counts[st] ? (
              <span>
                <span class={`dot st-${st}`} />
                {counts[st]} {TOPIC_STATUS[st]}
              </span>
            ) : null,
          )}
        </div>
      )}
    </>
  );
}
