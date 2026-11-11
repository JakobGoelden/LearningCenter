// The read-only HTTP API: bearer tokens, rate limit, routes. Transport-free so it
// can be tested; scripts/progress-api.ts puts it behind node:http. docs/API.md.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PackFs } from '../storage/fs';
import { examDatesView, NotFound, progressView, recentActivityView, weakSpotsView, type Freshness } from './readonly';
import type { Snapshot } from './insights';

/** One line of the token file. Only the SHA-256 of the token is stored. */
export interface TokenEntry {
  /** Name to revoke it by, e.g. "uni-claude". */
  id: string;
  /** Whose pack it reads (folder name on the server). */
  user: string;
  sha256: string;
  created: string;
  /** Set when revoked; the entry stays for the record. */
  revoked?: string;
}

export interface TokenFile {
  tokens: TokenEntry[];
}

export const TOKEN_PREFIX = 'lc_ro_';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => TOKEN_PREFIX + randomBytes(24).toString('base64url');

export function findToken(file: TokenFile, token: string): TokenEntry | null {
  const h = Buffer.from(hashToken(token), 'hex');
  let hit: TokenEntry | null = null;
  for (const t of file.tokens) {
    const other = Buffer.from(t.sha256, 'hex');
    if (other.length === h.length && timingSafeEqual(other, h) && !t.revoked) hit = t;
  }
  return hit;
}

/** Sliding window: at most `limit` hits per `windowMs` and key. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}
  /** Counts a hit; returns the seconds to wait when over the limit, else 0. */
  take(key: string, now: number): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return 0;
  }
}

export interface ApiDeps {
  tokens(): TokenFile;
  /** The learner's pack, read-only. */
  snapshot(user: string): Promise<{ snap: Snapshot; freshness: Omit<Freshness, 'generatedAt'> }>;
  now?(): number;
  /** Per token. Default 60 a minute. */
  perToken?: RateLimiter;
  /** Wrong or missing tokens per client IP. Default 20 in 15 minutes. */
  failures?: RateLimiter;
}

export interface ApiRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const BASE = '/api/v1';
const ROUTES = ['progress', 'weak-spots', 'recent-activity', 'exam-dates'] as const;

const json = (status: number, data: unknown, extra: Record<string, string> = {}): ApiResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  body: JSON.stringify(data),
});
const error = (status: number, message: string, extra: Record<string, string> = {}) => json(status, { error: message }, extra);

function intParam(q: URLSearchParams, name: string, max: number): number | undefined {
  const v = q.get(name);
  if (v === null) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new BadRequest(`${name} must be a positive integer`);
  return Math.min(n, max);
}
class BadRequest extends Error {}

export function createApi(deps: ApiDeps) {
  const perToken = deps.perToken ?? new RateLimiter(60, 60_000);
  const failures = deps.failures ?? new RateLimiter(20, 15 * 60_000);
  const now = deps.now ?? Date.now;

  return async function handle(req: ApiRequest): Promise<ApiResponse> {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(BASE)) return error(404, 'not found');
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(405, 'read-only API: GET only', { allow: 'GET' });

    const auth = String(req.headers.authorization ?? '');
    const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
    const entry = token ? findToken(deps.tokens(), token) : null;
    if (!entry) {
      const wait = failures.take(req.ip, now());
      if (wait) return error(429, 'too many failed attempts', { 'retry-after': String(wait) });
      return error(401, token ? 'invalid or revoked token' : 'missing header "Authorization: Bearer <token>"', { 'www-authenticate': 'Bearer' });
    }
    const wait = perToken.take(entry.id, now());
    if (wait) return error(429, 'rate limit: 60 requests a minute', { 'retry-after': String(wait) });

    const route = url.pathname.slice(BASE.length).replace(/^\/+|\/+$/g, '');
    if (route === '') return json(200, { endpoints: ROUTES.map((r) => `${BASE}/${r}`) });
    if (!(ROUTES as readonly string[]).includes(route)) return error(404, `unknown endpoint; known: ${ROUTES.join(', ')}`);

    try {
      const q = url.searchParams;
      const subject = q.get('subject') ?? undefined;
      const { snap, freshness } = await deps.snapshot(entry.user);
      let data: object;
      switch (route as (typeof ROUTES)[number]) {
        case 'progress':
          data = progressView(snap, subject);
          break;
        case 'weak-spots':
          data = weakSpotsView(snap, { subject, limit: intParam(q, 'limit', 50) });
          break;
        case 'recent-activity':
          data = recentActivityView(snap, { subject, limit: intParam(q, 'limit', 50) });
          break;
        case 'exam-dates':
          data = examDatesView(snap);
          break;
      }
      return json(200, { generatedAt: new Date(now()).toISOString(), ...freshness, ...data });
    } catch (e) {
      if (e instanceof BadRequest) return error(400, e.message);
      if (e instanceof NotFound) return error(404, e.message);
      throw e;
    }
  };
}

/** Wraps a pack so nothing can write through it, whatever the code above does. */
export function readOnly(fs: PackFs): PackFs {
  const refuse = async () => {
    throw new Error('read-only');
  };
  return {
    kind: fs.kind,
    label: fs.label,
    sharedWithAi: false,
    read: (p) => fs.read(p),
    list: (d) => fs.list(d),
    mtime: (p) => fs.mtime(p),
    write: refuse,
    append: refuse,
    remove: refuse,
  };
}
