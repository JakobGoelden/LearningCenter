import { FsHttpError, type PackFs } from './fs';
import { newEventId } from '../progress/ops';

/**
 * A server pack that keeps working without a connection. Events (answers and
 * the rest of the log) and session/sheet-answer files wait in an outbox on the
 * device and are sent when the server can be reached: right away, on `online`,
 * when the app becomes visible again, and with backoff. Each event has an id
 * and the server skips ids it has, so sending twice is harmless; that is also
 * why several tabs may flush the same outbox.
 *
 * Every item is its own key in the store, so tabs never overwrite each other's
 * items, and an item is removed only after the server confirmed it.
 *
 * Until `eventsMode` is on (the pack is migrated, so the server has
 * POST /__lc/events), everything passes straight through as before.
 */

export const EVENTS_LOG = 'log/events.jsonl';

/** Paths whose writes may wait: files only this device writes (one per session or sheet). */
export const queueable = (path: string) => /^(sessions|work)\//.test(path) && path.endsWith('.json');

export interface OutboxStore {
  entries(prefix: string): Promise<[string, unknown][]>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

interface EventItem {
  kind: 'event';
  event: { id: string } & Record<string, unknown>;
}
interface WriteItem {
  kind: 'write';
  path: string;
  text: string;
  /** Distinguishes two writes of the same path, so a newer one is not dropped by the ack of an older one. */
  stamp: string;
}
type Item = EventItem | WriteItem;

export interface OutboxStatus {
  /** Events and files waiting to be sent. */
  pending: number;
  /** Items the server refused (kept, never dropped). */
  failed: number;
  /** Why the last send did not go through, if it did not. */
  problem: 'offline' | 'login' | 'refused' | null;
  /** mtime of the log after the last successful send of events. */
  logMtime?: number | null;
  /** mtime of the log right before that send, when the server says. */
  logBefore?: number | null;
  /** Counts successful sends of events, so a listener can act on each one once. */
  sends?: number;
}

const BATCH = 200;
const MIN_WAIT = 2000;
const MAX_WAIT = 60000;

const isNetworkError = (e: unknown) => !(e instanceof FsHttpError) || e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
const isAuthError = (e: unknown) => e instanceof FsHttpError && (e.status === 401 || e.status === 403);

export class QueuedFs implements PackFs {
  readonly kind: PackFs['kind'];
  readonly label: string;
  readonly sharedWithAi: boolean;
  eventsMode = false;
  private readonly prefix: string;
  private readonly failedPrefix: string;
  private seq = 0;
  private flushing: Promise<void> | null = null;
  private again = false;
  private wait = MIN_WAIT;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: OutboxStatus) => void>();
  private status: OutboxStatus = { pending: 0, failed: 0, problem: null };

  constructor(
    private readonly inner: PackFs & {
      appendEvents(events: object[]): Promise<{ mtime: number | null; before?: number | null }>;
      takeCached?(): { any: boolean; reads: string[] };
    },
    key: string,
    private readonly store: OutboxStore,
  ) {
    this.kind = inner.kind;
    this.label = inner.label;
    this.sharedWithAi = inner.sharedWithAi;
    this.prefix = `outbox|${key}|`;
    this.failedPrefix = `outbox-failed|${key}|`;
    if (inner.fileUrl) this.fileUrl = (p: string) => inner.fileUrl!(p);
  }

  fileUrl?: (path: string) => Promise<string | null>;

  /** What came from the service worker's offline copy since the last call (see DevFs). */
  takeCached(): { any: boolean; reads: string[] } {
    return this.inner.takeCached?.() ?? { any: false, reads: [] };
  }

  onStatus(cb: (s: OutboxStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  private setStatus(change: Partial<OutboxStatus>) {
    this.status = { ...this.status, ...change };
    for (const cb of this.listeners) cb(this.status);
  }

  /** Keys sort in the order the items were made: time, then a counter within this tab. */
  private key(kind: string) {
    return `${this.prefix}${Date.now().toString(36).padStart(9, '0')}|${(this.seq++).toString(36).padStart(4, '0')}|${kind}|${newEventId()}`;
  }

  private async items(): Promise<[string, Item][]> {
    return (await this.store.entries(this.prefix)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) as [string, Item][];
  }

  private async refreshCount() {
    const [items, failed] = await Promise.all([this.items(), this.store.entries(this.failedPrefix)]);
    // Items set aside stay visible until someone looks at them, even after later sends went through.
    const problem = this.status.problem ?? (failed.length ? 'refused' : null);
    this.setStatus({ pending: items.length, failed: failed.length, problem });
  }

  // --- PackFs -------------------------------------------------------------

  async read(path: string) {
    if (!this.eventsMode) return this.inner.read(path);
    const items = await this.items();
    if (queueable(path)) {
      const w = items.filter((x): x is [string, WriteItem] => x[1].kind === 'write' && x[1].path === path).at(-1);
      if (w) return w[1].text;
    }
    const text = await this.inner.read(path);
    if (path !== EVENTS_LOG) return text;
    const waiting = items.filter((x): x is [string, EventItem] => x[1].kind === 'event').map(([, it]) => it.event);
    if (!waiting.length) return text;
    const have = text ?? '';
    const extra = waiting.filter((e) => !have.includes(`"id":"${e.id}"`)).map((e) => JSON.stringify(e) + '\n');
    return have + (have && !have.endsWith('\n') ? '\n' : '') + extra.join('');
  }

  async write(path: string, text: string) {
    if (!this.eventsMode || !queueable(path)) return this.inner.write(path, text);
    await this.store.put(this.key('write'), { kind: 'write', path, text, stamp: newEventId() } satisfies WriteItem);
    await this.refreshCount();
    // Saved on the device is saved: sending happens in the background.
    void this.flush();
  }

  async append(path: string, text: string) {
    if (!this.eventsMode || path !== EVENTS_LOG) return this.inner.append(path, text);
    const events = text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .map((e) => ({ ...e, id: typeof e.id === 'string' ? e.id : newEventId() }));
    await this.appendEvents(events);
  }

  async appendEvents(events: object[]) {
    if (!this.eventsMode) return this.inner.appendEvents(events);
    for (const event of events) await this.store.put(this.key('event'), { kind: 'event', event } as EventItem);
    await this.refreshCount();
    void this.flush();
    return { mtime: null };
  }

  remove(path: string) {
    return this.inner.remove(path);
  }

  async list(dir: string) {
    const names = await this.inner.list(dir);
    if (!this.eventsMode) return names;
    const prefix = dir.replace(/\/?$/, '/');
    const waiting = (await this.items())
      .map(([, it]) => it)
      .filter((it): it is WriteItem => it.kind === 'write' && it.path.startsWith(prefix) && !it.path.slice(prefix.length).includes('/'))
      .map((it) => it.path.slice(prefix.length));
    return [...new Set([...names, ...waiting])].sort();
  }

  mtime(path: string) {
    return this.inner.mtime(path);
  }

  // --- Sending ------------------------------------------------------------

  /** Sends what is waiting. Never throws; the status says how it went. */
  flush(): Promise<void> {
    if (!this.eventsMode) return Promise.resolve();
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    const run = async () => {
      do {
        this.again = false;
        await this.sendAll();
      } while (this.again);
    };
    // One tab at a time sends, so an older write of a file can never land after a newer one.
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    this.flushing = (locks ? (locks.request(`lc-outbox|${this.prefix}`, run) as unknown as Promise<void>) : run()).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.wait);
    this.wait = Math.min(this.wait * 2, MAX_WAIT);
  }

  private async sendAll() {
    try {
      for (;;) {
        const items = await this.items();
        if (!items.length) break;
        const events = items.filter((x): x is [string, EventItem] => x[1].kind === 'event').slice(0, BATCH);
        if (events.length) {
          await this.sendEvents(events);
          continue;
        }
        const w = items[0][1] as WriteItem;
        // Only the newest write of a path matters; older ones are dropped unsent.
        const newest = items.filter((x) => x[1].kind === 'write' && (x[1] as WriteItem).path === w.path).at(-1)!;
        const older = items.filter(([k, it]) => it.kind === 'write' && it.path === w.path && k <= newest[0]);
        try {
          await this.inner.write(w.path, (newest[1] as WriteItem).text);
        } catch (e) {
          if (isNetworkError(e) || isAuthError(e)) throw e;
          // Refused for good: keep the newest version aside, so the files after it still go.
          await this.store.put(this.failedPrefix + newest[0].slice(this.prefix.length), { ...newest[1], error: (e as Error).message });
          for (const [k] of older) await this.store.del(k);
          this.setStatus({ problem: 'refused' });
          continue;
        }
        for (const [k] of older) await this.store.del(k);
      }
      this.wait = MIN_WAIT;
      this.setStatus({ problem: null });
    } catch (e) {
      if (isAuthError(e)) this.setStatus({ problem: 'login' });
      else if (isNetworkError(e)) this.setStatus({ problem: 'offline' });
      else this.setStatus({ problem: 'refused' });
      this.schedule();
    } finally {
      await this.refreshCount();
    }
  }

  /** One batch; a refused batch is split so one bad event cannot hold back the others. */
  private async sendEvents(batch: [string, EventItem][]): Promise<void> {
    try {
      const { mtime, before } = await this.inner.appendEvents(batch.map(([, it]) => it.event));
      for (const [k] of batch) await this.store.del(k);
      this.setStatus({ logMtime: mtime, logBefore: before, sends: (this.status.sends ?? 0) + 1 });
    } catch (e) {
      if (isNetworkError(e) || isAuthError(e)) throw e;
      if (batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        await this.sendEvents(batch.slice(0, half));
        await this.sendEvents(batch.slice(half));
        return;
      }
      // Refused for good: keep it aside (never lost), so it does not block the queue.
      const [k, it] = batch[0];
      await this.store.put(this.failedPrefix + k.slice(this.prefix.length), { ...it, error: (e as Error).message });
      await this.store.del(k);
      this.setStatus({ problem: 'refused' });
    }
  }

  /** Starts sending on the browser's signals; returns a function that stops it. */
  watch(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const kick = () => {
      this.wait = MIN_WAIT;
      void this.flush();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', onVisible);
    void this.refreshCount().then(() => this.flush());
    return () => {
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', onVisible);
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    };
  }
}

/** The outbox in IndexedDB (the app's key-value store). */
export async function idbOutbox(): Promise<OutboxStore> {
  const { idbEntries, idbSet, idbDelete, KV } = await import('./idb');
  return {
    entries: (prefix) => idbEntries(KV, prefix),
    put: (key, value) => idbSet(KV, key, value),
    del: (key) => idbDelete(KV, key),
  };
}

export class MemoryOutbox implements OutboxStore {
  data = new Map<string, unknown>();
  async entries(prefix: string) {
    return [...this.data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)] as [string, unknown]);
  }
  async put(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
  async del(key: string) {
    this.data.delete(key);
  }
}
