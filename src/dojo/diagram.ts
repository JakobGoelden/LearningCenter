// Layout of a finite automaton as a state diagram: states in columns by their
// distance from the start state, transitions as arrows that bend around other
// states, self-loops in the freest spot around their state. Pure geometry, so
// the UI only has to draw it.

import { EPS, type Automaton } from './automata';

export interface DiagramNode {
  id: string;
  x: number;
  y: number;
  r: number;
  /** Font size for the state name (smaller for long names such as {q0,q1,q2}). */
  font: number;
  start: boolean;
  final: boolean;
  /** false: only named by a transition, not one of the states (usually a typo). */
  known: boolean;
}

export interface DiagramEdge {
  from: string;
  to: string;
  /** Symbols of all transitions from → to, e.g. "a, b". */
  label: string;
  /** SVG path; the arrowhead goes at its end. */
  path: string;
  labelX: number;
  labelY: number;
}

export interface Diagram {
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Short arrow pointing into the start state. */
  startArrow?: { x1: number; y1: number; x2: number; y2: number };
}

type Pt = { x: number; y: number };

const GAP_X = 72; // between the rims of neighbouring columns
const GAP_Y = 96; // between the centres of states in one column
const MARGIN = 12;
const START_LEN = 28;
const LOOP = 34; // how far a self-loop reaches out from its state
const LABEL_FONT = 12;
const CHAR = 0.62; // width of a monospace character per font size
const NODE_FONT = 13;
const MIN_R = 18;
const MAX_R = 34;

const isEps = (s: string) => s === '' || s === EPS || s === 'eps' || s === 'epsilon';
const textWidth = (s: string, font: number) => s.length * font * CHAR;

function nodeSize(name: string): { r: number; font: number } {
  const r = Math.max(MIN_R, textWidth(name, NODE_FONT) / 2 + 7);
  if (r <= MAX_R) return { r, font: NODE_FONT };
  return { r: MAX_R, font: Math.max(8, (2 * (MAX_R - 6)) / (name.length * CHAR)) };
}

const quad = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t ** 2 * p1.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t ** 2 * p1.y,
});

const cubic = (p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * p1.x,
    y: u ** 3 * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * p1.y,
  };
};

const toward = (from: Pt, to: Pt, dist: number): Pt => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
};

const f = (n: number) => Math.round(n * 10) / 10;

/**
 * Lays out an automaton for drawing. Accepts half-finished input as the
 * learner types it: empty state names are ignored, and states that only a
 * transition names are added as unknown states.
 */
export function layoutAutomaton(a: Automaton): Diagram {
  const names: string[] = [];
  const known = new Set<string>();
  for (const s of a.states.map((s) => s.trim())) {
    if (s && !known.has(s)) {
      known.add(s);
      names.push(s);
    }
  }
  // Group the transitions per pair of states.
  const groups = new Map<string, { from: string; to: string; symbols: string[] }>();
  for (const [rawFrom, rawSym, rawTo] of a.transitions) {
    const from = rawFrom.trim();
    const to = rawTo.trim();
    if (!from || !to) continue;
    for (const s of [from, to]) if (!names.includes(s)) names.push(s);
    const sym = isEps(rawSym.trim()) ? EPS : rawSym.trim();
    const key = `${from}\u0000${to}`;
    const g = groups.get(key) ?? { from, to, symbols: [] };
    if (!g.symbols.includes(sym)) g.symbols.push(sym);
    groups.set(key, g);
  }
  if (!names.length) return { width: 0, height: 0, nodes: [], edges: [] };

  const start = a.start.trim();
  const finals = new Set(a.final.map((s) => s.trim()));
  const succ = new Map(names.map((n) => [n, [] as string[]]));
  for (const g of groups.values()) if (g.from !== g.to) succ.get(g.from)!.push(g.to);

  // Columns: breadth-first distance from the start state. States it cannot
  // reach start their own search, from column 0 again (stacked below).
  const layer = new Map<string, number>();
  const roots = known.has(start) ? [start, ...names] : names;
  for (const root of roots) {
    if (layer.has(root)) continue;
    layer.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const s = queue.shift()!;
      for (const t of succ.get(s)!) {
        if (!layer.has(t)) {
          layer.set(t, layer.get(s)! + 1);
          queue.push(t);
        }
      }
    }
  }
  const columns: string[][] = [];
  for (const n of names) (columns[layer.get(n)!] ??= []).push(n);

  // Fewer crossings: order each column by where its predecessors sit.
  const pos = new Map<string, number>();
  columns[0].forEach((n, i) => pos.set(n, i));
  for (let l = 1; l < columns.length; l++) {
    const bary = (n: string) => {
      const from = [...groups.values()].filter((g) => g.to === n && g.from !== n && layer.get(g.from)! < l);
      if (!from.length) return Infinity;
      return from.reduce((sum, g) => sum + pos.get(g.from)! / Math.max(1, columns[layer.get(g.from)!].length - 1), 0) / from.length;
    };
    const keyed = columns[l].map((n, i) => ({ n, i, b: bary(n) }));
    keyed.sort((p, q) => (p.b === q.b ? p.i - q.i : p.b === Infinity ? 1 : q.b === Infinity ? -1 : p.b - q.b));
    columns[l] = keyed.map((k) => k.n);
    columns[l].forEach((n, i) => pos.set(n, i));
  }

  const nodes = new Map<string, DiagramNode>();
  let x = 0;
  let prevR = 0;
  columns.forEach((col, l) => {
    const sizes = col.map(nodeSize);
    const maxR = Math.max(...sizes.map((s) => s.r));
    x += l === 0 ? maxR : prevR + GAP_X + maxR;
    prevR = maxR;
    col.forEach((n, i) => {
      nodes.set(n, {
        id: n,
        x,
        y: (i - (col.length - 1) / 2) * GAP_Y,
        ...sizes[i],
        start: n === start,
        final: finals.has(n),
        known: known.has(n),
      });
    });
  });
  const all = [...nodes.values()];

  // Everything that has to fit into the picture.
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (p: Pt, w = 0, h = 0) => {
    box.x0 = Math.min(box.x0, p.x - w / 2);
    box.x1 = Math.max(box.x1, p.x + w / 2);
    box.y0 = Math.min(box.y0, p.y - h / 2);
    box.y1 = Math.max(box.y1, p.y + h / 2);
  };
  for (const n of all) grow(n, 2 * n.r, 2 * n.r);

  // Directions (angles) in which lines leave each state, to place loops.
  const angles = new Map(all.map((n) => [n.id, [] as number[]]));
  const startNode = nodes.get(start);
  let startArrow: Diagram['startArrow'];
  if (startNode && startNode.known) {
    startArrow = { x1: startNode.x - startNode.r - START_LEN, y1: startNode.y, x2: startNode.x - startNode.r, y2: startNode.y };
    grow({ x: startArrow.x1, y: startArrow.y1 });
    angles.get(start)!.push(Math.PI);
  }

  const edges: DiagramEdge[] = [];
  // Where each edge would like its label: next to `at`, pushed out along `dir`
  // (or along -dir as well, for straight arrows) until it is in nobody's way.
  const wishes: { edge: DiagramEdge; at: Pt; dir: Pt; bothSides: boolean }[] = [];
  const clearOf = (pts: Pt[], skip: DiagramNode[]) =>
    all.every((n) => skip.includes(n) || pts.every((p) => Math.hypot(p.x - n.x, p.y - n.y) > n.r + 20));

  for (const g of groups.values()) {
    if (g.from === g.to) continue;
    const u = nodes.get(g.from)!;
    const v = nodes.get(g.to)!;
    const label = g.symbols.join(', ');
    const len = Math.hypot(v.x - u.x, v.y - u.y) || 1;
    // Normal to the left of the direction of travel: up for arrows going
    // right, down for arrows going back left.
    const n = { x: (v.y - u.y) / len, y: -(v.x - u.x) / len };
    const mid = { x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 };
    const reverse = groups.has(`${g.to}\u0000${g.from}`);
    // Bend (apex distance from the straight line). Arrows in both directions
    // bend to opposite sides; others stay straight unless a state is in the way.
    const bends = reverse ? [24, 48, 80, 120] : [0, 36, -36, 64, -64, 100, -100, 140];
    let bend = bends[bends.length - 1];
    for (const b of bends) {
      const c = { x: mid.x + n.x * 2 * b, y: mid.y + n.y * 2 * b };
      const pts = Array.from({ length: 17 }, (_, i) => quad(u, c, v, (i + 2) / 20));
      if (clearOf(pts, [u, v])) {
        bend = b;
        break;
      }
    }
    const c = { x: mid.x + n.x * 2 * bend, y: mid.y + n.y * 2 * bend };
    const p0 = toward(u, c, u.r);
    const p1 = toward(v, c, v.r);
    angles.get(u.id)!.push(Math.atan2(c.y - u.y, c.x - u.x));
    angles.get(v.id)!.push(Math.atan2(c.y - v.y, c.x - v.x));
    const side = bend < 0 ? -1 : 1;
    for (let i = 0; i <= 10; i++) grow(quad(p0, c, p1, i / 10));
    const edge: DiagramEdge = {
      from: g.from,
      to: g.to,
      label,
      path: bend === 0 ? `M${f(p0.x)},${f(p0.y)} L${f(p1.x)},${f(p1.y)}` : `M${f(p0.x)},${f(p0.y)} Q${f(c.x)},${f(c.y)} ${f(p1.x)},${f(p1.y)}`,
      labelX: 0,
      labelY: 0,
    };
    edges.push(edge);
    wishes.push({ edge, at: quad(p0, c, p1, 0.5), dir: { x: n.x * side, y: n.y * side }, bothSides: bend === 0 });
  }

  for (const g of groups.values()) {
    if (g.from !== g.to) continue;
    const u = nodes.get(g.from)!;
    const theta = freestAngle(angles.get(u.id)!);
    const at = (a: number, d: number): Pt => ({ x: u.x + Math.cos(a) * d, y: u.y + Math.sin(a) * d });
    const p0 = at(theta - 0.5, u.r);
    const p1 = at(theta + 0.5, u.r);
    const c1 = at(theta - 0.85, u.r + LOOP * 1.35);
    const c2 = at(theta + 0.85, u.r + LOOP * 1.35);
    for (let i = 0; i <= 10; i++) grow(cubic(p0, c1, c2, p1, i / 10));
    const edge: DiagramEdge = {
      from: g.from,
      to: g.to,
      label: g.symbols.join(', '),
      path: `M${f(p0.x)},${f(p0.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p1.x)},${f(p1.y)}`,
      labelX: 0,
      labelY: 0,
    };
    edges.push(edge);
    wishes.push({ edge, at: cubic(p0, c1, c2, p1, 0.5), dir: { x: Math.cos(theta), y: Math.sin(theta) }, bothSides: false });
  }

  // Labels: the first spot that overlaps no state and no other label.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const free = (b: { x: number; y: number; w: number; h: number }) =>
    placed.every((o) => Math.abs(o.x - b.x) > (o.w + b.w) / 2 + 2 || Math.abs(o.y - b.y) > (o.h + b.h) / 2 + 1) &&
    all.every((n) => {
      const cx = Math.max(b.x - b.w / 2, Math.min(n.x, b.x + b.w / 2));
      const cy = Math.max(b.y - b.h / 2, Math.min(n.y, b.y + b.h / 2));
      return Math.hypot(cx - n.x, cy - n.y) > n.r + 2;
    });
  for (const { edge, at, dir, bothSides } of wishes) {
    const w = textWidth(edge.label, LABEL_FONT) + 4;
    const h = LABEL_FONT + 2;
    const off = 4 + (w / 2) * Math.abs(dir.x) + (h / 2) * Math.abs(dir.y);
    const spots: Pt[] = [];
    for (const extra of [0, 8, 16, 26, 38]) {
      for (const s of bothSides ? [1, -1] : [1]) spots.push({ x: at.x + dir.x * s * (off + extra), y: at.y + dir.y * s * (off + extra) });
    }
    const spot = spots.find((p) => free({ ...p, w, h })) ?? spots[0];
    placed.push({ ...spot, w, h });
    grow(spot, w, h);
    edge.labelX = spot.x;
    edge.labelY = spot.y;
  }

  // Shift everything into the picture.
  const dx = MARGIN - box.x0;
  const dy = MARGIN - box.y0;
  const shiftPath = (p: string) =>
    p.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, px: string, py: string) => `${f(Number(px) + dx)},${f(Number(py) + dy)}`);
  return {
    width: Math.ceil(box.x1 - box.x0 + 2 * MARGIN),
    height: Math.ceil(box.y1 - box.y0 + 2 * MARGIN),
    nodes: all.map((n) => ({ ...n, x: f(n.x + dx), y: f(n.y + dy) })),
    edges: edges.map((e) => ({ ...e, path: shiftPath(e.path), labelX: f(e.labelX + dx), labelY: f(e.labelY + dy) })),
    startArrow: startArrow && {
      x1: f(startArrow.x1 + dx),
      y1: f(startArrow.y1 + dy),
      x2: f(startArrow.x2 + dx),
      y2: f(startArrow.y2 + dy),
    },
  };
}

/**
 * Middle of the widest gap between the given directions (radians), so a loop
 * sits where no other line leaves the state. Prefers "up" when gaps tie.
 */
export function freestAngle(taken: number[]): number {
  const UP = -Math.PI / 2;
  if (!taken.length) return UP;
  const sorted = taken.map((a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((p, q) => p - q);
  let best = UP;
  let bestGap = -1;
  let bestUp = Infinity;
  sorted.forEach((a, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 2 * Math.PI;
    const gap = next - a;
    const middle = a + gap / 2;
    const fromUp = Math.abs(Math.atan2(Math.sin(middle - UP), Math.cos(middle - UP)));
    if (gap > bestGap + 0.2 || (gap > bestGap - 0.2 && fromUp < bestUp)) {
      if (gap > bestGap) bestGap = gap;
      best = middle;
      bestUp = fromUp;
    }
  });
  return Math.atan2(Math.sin(best), Math.cos(best));
}
