import { useId, useMemo } from 'preact/hooks';
import type { Automaton } from '../dojo/automata';
import { layoutAutomaton } from '../dojo/diagram';

/** State diagram of an automaton: circles, double circles for final states, arrows for transitions. */
export function AutomatonDiagram({ automaton, label = 'State diagram' }: { automaton: Automaton; label?: string }) {
  const d = useMemo(() => layoutAutomaton(automaton), [automaton]);
  const arrow = `arrow-${useId()}`.replace(/[^\w-]/g, '');
  if (!d.nodes.length) return null;
  return (
    <svg
      class="automaton-diagram"
      viewBox={`0 0 ${d.width} ${d.height}`}
      width={d.width}
      height={d.height}
      role="img"
      aria-label={label}
    >
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="currentColor" />
        </marker>
      </defs>
      {d.startArrow && (
        <line
          class="edge"
          x1={d.startArrow.x1}
          y1={d.startArrow.y1}
          x2={d.startArrow.x2}
          y2={d.startArrow.y2}
          marker-end={`url(#${arrow})`}
        />
      )}
      {d.edges.map((e) => (
        <path key={`${e.from}\u0000${e.to}`} class="edge" d={e.path} marker-end={`url(#${arrow})`} />
      ))}
      {d.nodes.map((n) => (
        <g key={n.id} class={n.known ? 'state' : 'state unknown'}>
          <title>{n.known ? n.id : `${n.id}: not one of the states`}</title>
          <circle cx={n.x} cy={n.y} r={n.r} />
          {n.final && <circle cx={n.x} cy={n.y} r={n.r - 4} />}
          <text x={n.x} y={n.y} font-size={n.font}>
            {n.id}
          </text>
        </g>
      ))}
      {d.edges.map((e) => (
        <text key={`l${e.from}\u0000${e.to}`} class="edge-label" x={e.labelX} y={e.labelY}>
          {e.label}
        </text>
      ))}
    </svg>
  );
}
