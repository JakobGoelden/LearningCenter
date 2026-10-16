import { EPS, type Automaton } from '../dojo/automata';

/** One row of the transition table as the learner types it. */
export interface StateRow {
  name: string;
  final: boolean;
  /** symbol → cell text */
  cells: Record<string, string>;
}

export interface TableState {
  rows: StateRow[];
  start: number;
}

export const emptyTable = (): TableState => ({ rows: [{ name: 'q0', final: false, cells: {} }], start: 0 });

/**
 * Turns the table into an automaton. A cell holds one target state; in an
 * NFA table several targets are separated by ";" or spaces (or commas, when
 * the whole cell is not itself a state name such as "{q0,q1}").
 */
export function tableToAutomaton(t: TableState, columns: string[]): Automaton {
  const names = t.rows.map((r) => r.name.trim());
  const known = new Set(names);
  const transitions: [string, string, string][] = [];
  t.rows.forEach((r, i) => {
    for (const sym of columns) {
      const cell = (r.cells[sym] ?? '').trim();
      if (!cell || cell === '-' || cell === '∅') continue;
      const targets = known.has(cell) ? [cell] : cell.split(/[;,\s]+/).filter(Boolean);
      for (const to of targets) transitions.push([names[i], sym, to]);
    }
  });
  return {
    states: names,
    start: names[t.start] ?? names[0],
    final: t.rows.filter((r) => r.final).map((r) => r.name.trim()),
    transitions,
  };
}

/** Editable transition table: one row per state, one column per symbol. */
export function AutomatonEditor({
  value,
  onChange,
  alphabet,
  allowEps,
  disabled,
}: {
  value: TableState;
  onChange: (t: TableState) => void;
  alphabet: string[];
  allowEps: boolean;
  disabled?: boolean;
}) {
  const columns = allowEps ? [...alphabet, EPS] : alphabet;
  const setRow = (i: number, change: Partial<StateRow>) =>
    onChange({ ...value, rows: value.rows.map((r, k) => (k === i ? { ...r, ...change } : r)) });
  const addRow = () => {
    const used = new Set(value.rows.map((r) => r.name));
    let n = value.rows.length;
    while (used.has(`q${n}`)) n++;
    onChange({ ...value, rows: [...value.rows, { name: `q${n}`, final: false, cells: {} }] });
  };
  const removeRow = (i: number) =>
    onChange({
      rows: value.rows.filter((_, k) => k !== i),
      start: value.start === i ? 0 : value.start > i ? value.start - 1 : value.start,
    });

  return (
    <div class="stack" style="gap:8px">
      <div class="table-wrap">
        <table class="automaton">
          <thead>
            <tr>
              <th title="Start state">→</th>
              <th title="Final state">*</th>
              <th>State</th>
              {columns.map((c) => (
                <th class="mono">{c}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {value.rows.map((r, i) => (
              <tr>
                <td>
                  <input
                    type="radio"
                    name="start"
                    checked={value.start === i}
                    disabled={disabled}
                    onChange={() => onChange({ ...value, start: i })}
                    aria-label={`${r.name || 'state'} is the start state`}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.final}
                    disabled={disabled}
                    onChange={(e) => setRow(i, { final: e.currentTarget.checked })}
                    aria-label={`${r.name || 'state'} is a final state`}
                  />
                </td>
                <td>
                  <input
                    class="mono"
                    value={r.name}
                    disabled={disabled}
                    onInput={(e) => setRow(i, { name: e.currentTarget.value })}
                    aria-label={`Name of state ${i + 1}`}
                  />
                </td>
                {columns.map((c) => (
                  <td>
                    <input
                      class="mono"
                      value={r.cells[c] ?? ''}
                      disabled={disabled}
                      placeholder="–"
                      onInput={(e) => setRow(i, { cells: { ...r.cells, [c]: e.currentTarget.value } })}
                      aria-label={`${r.name || 'state'} on ${c}`}
                    />
                  </td>
                ))}
                <td>
                  {value.rows.length > 1 && !disabled && (
                    <button class="ghost small" onClick={() => removeRow(i)} title="Remove state" aria-label={`Remove ${r.name}`}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <div class="row small">
          <button class="small" onClick={addRow}>
            + State
          </button>
          <span class="muted">
            Empty cell = no transition (dead state).{allowEps ? ' Several targets: separate with ";".' : ''}
          </span>
        </div>
      )}
    </div>
  );
}

/** Read-only transition table for an automaton given with a task. */
export function AutomatonTable({ automaton: a, alphabet }: { automaton: Automaton; alphabet: string[] }) {
  const hasEps = a.transitions.some(([, s]) => s === EPS || s === '' || s === 'eps');
  const columns = hasEps ? [...alphabet, EPS] : alphabet;
  const targets = (st: string, sym: string) =>
    a.transitions
      .filter(([f, s]) => f === st && (s === sym || (sym === EPS && (s === '' || s === 'eps'))))
      .map(([, , t]) => t);
  return (
    <div class="table-wrap">
      <table class="automaton readonly">
        <thead>
          <tr>
            <th>State</th>
            {columns.map((c) => (
              <th class="mono">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {a.states.map((st) => (
            <tr>
              <td class="mono">
                {st === a.start ? '→ ' : ''}
                {a.final.includes(st) ? '*' : ''}
                {st}
              </td>
              {columns.map((c) => {
                const t = targets(st, c);
                return <td class="mono">{t.length === 0 ? '–' : t.length === 1 ? t[0] : `{${t.join(', ')}}`}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
