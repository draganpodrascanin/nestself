/**
 * In-memory KeyValueStore for unit tests and AUTH_MODE=stub when REDIS_URL is absent.
 *
 * Expiry: checked on read (lazy) plus a periodic sweep every 60 s.
 * Sets and pub/sub are process-local; pub/sub dispatches synchronously.
 *
 * @see D-26, D-36
 */
import type { KeyValueStore, SetOptions } from './key-value-store.js';

interface Entry {
  value: string;
  expiresAt: number | null; // Date.now()-based epoch ms, null = no TTL
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, Entry>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly subs = new Map<string, Set<(message: string) => void>>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    // Prevent the timer from keeping Node alive in tests
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  // -- helpers --------------------------------------------------------------

  private alive(entry: Entry | undefined): entry is Entry {
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      return false;
    }
    return true;
  }

  private getEntry(key: string): Entry | undefined {
    const entry = this.data.get(key);
    if (entry && !this.alive(entry)) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.data) {
      if (entry.expiresAt !== null && now >= entry.expiresAt) {
        this.data.delete(key);
      }
    }
  }

  // -- KeyValueStore --------------------------------------------------------

  async get(key: string): Promise<string | null> {
    return this.getEntry(key)?.value ?? null;
  }

  async set(key: string, value: string, opts?: SetOptions): Promise<boolean> {
    if (opts?.onlyIfAbsent && this.getEntry(key)) {
      return false;
    }
    const expiresAt =
      opts?.ttlSeconds != null ? Date.now() + opts.ttlSeconds * 1000 : null;
    this.data.set(key, { value, expiresAt });
    return true;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (this.data.delete(k)) count++;
      // Also clean up sets
      if (this.sets.delete(k)) count = Math.max(count, count); // set key is separate
    }
    return count;
  }

  async getDel(key: string): Promise<string | null> {
    const entry = this.getEntry(key);
    if (!entry) return null;
    this.data.delete(key);
    return entry.value;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.getEntry(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.getEntry(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const existing = this.getEntry(key);
    const current = existing ? parseInt(existing.value, 10) || 0 : 0;
    const next = current + 1;
    const isNew = !existing;

    const expiresAt =
      isNew && ttlSeconds != null
        ? Date.now() + ttlSeconds * 1000
        : existing?.expiresAt ?? null;

    this.data.set(key, { value: String(next), expiresAt });
    return next;
  }

  async sAdd(key: string, ...members: string[]): Promise<number> {
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) {
        s.add(m);
        added++;
      }
    }
    return added;
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) {
      if (s.delete(m)) removed++;
    }
    if (s.size === 0) this.sets.delete(key);
    return removed;
  }

  async sMembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  async scan(pattern: string): Promise<string[]> {
    const re = globToRegExp(pattern);
    const keys = new Set<string>();
    for (const key of this.data.keys()) {
      if (this.getEntry(key) && re.test(key)) keys.add(key);
    }
    for (const key of this.sets.keys()) {
      if (re.test(key)) keys.add(key);
    }
    return [...keys];
  }

  async publish(channel: string, message: string): Promise<number> {
    const handlers = this.subs.get(channel);
    if (!handlers || handlers.size === 0) return 0;
    for (const fn of handlers) {
      fn(message);
    }
    return handlers.size;
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<() => Promise<void>> {
    let handlers = this.subs.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.subs.set(channel, handlers);
    }
    handlers.add(handler);

    return async () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.subs.delete(channel);
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.data.clear();
    this.sets.clear();
    this.subs.clear();
  }
}

/** Redis glob (`*`, `?`) to RegExp; every other character is literal. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}
