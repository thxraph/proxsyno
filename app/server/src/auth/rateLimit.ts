/**
 * In-memory brute-force guard for the login endpoint.
 *
 * Tracks consecutive failed attempts per key (we key by both client IP and by
 * username, and lock if either trips) inside a sliding window. After
 * MAX_FAILURES failures the key is locked for LOCK_MS; each further failure
 * while locked extends nothing but keeps the clock running. A successful login
 * clears the key. State is process-local and non-persistent — a restart resets
 * every counter, which is an acceptable (fail-open-on-restart) trade for not
 * needing a datastore.
 */

const WINDOW_MS = 15 * 60_000; // failures older than this are forgotten
const MAX_FAILURES = 5; // failures within the window before a lock
const LOCK_MS = 15 * 60_000; // how long a key stays locked
const MAX_KEYS = 10_000; // hard cap so the map can't grow unbounded

interface Entry {
  fails: number;
  firstFailAt: number;
  lockedUntil: number;
}

const entries = new Map<string, Entry>();

function now(): number {
  return Date.now();
}

/** Drop expired locks/windows; opportunistically bound the map size. */
function prune(): void {
  const t = now();
  for (const [key, e] of entries) {
    if (e.lockedUntil <= t && t - e.firstFailAt > WINDOW_MS) entries.delete(key);
  }
  if (entries.size > MAX_KEYS) {
    // Evict oldest-first if something pathological blows past the cap.
    const excess = entries.size - MAX_KEYS;
    let i = 0;
    for (const key of entries.keys()) {
      entries.delete(key);
      if (++i >= excess) break;
    }
  }
}

/**
 * If any of the given keys is currently locked, return the remaining lock time
 * in milliseconds (the max across keys); otherwise 0.
 */
export function retryAfterMs(keys: string[]): number {
  const t = now();
  let remaining = 0;
  for (const key of keys) {
    const e = entries.get(key);
    if (e && e.lockedUntil > t) remaining = Math.max(remaining, e.lockedUntil - t);
  }
  return remaining;
}

/** Record one failed attempt against each key, locking any that trips the limit. */
export function recordFailure(keys: string[]): void {
  const t = now();
  for (const key of keys) {
    const e = entries.get(key);
    if (!e || t - e.firstFailAt > WINDOW_MS) {
      entries.set(key, { fails: 1, firstFailAt: t, lockedUntil: 0 });
      continue;
    }
    e.fails += 1;
    if (e.fails >= MAX_FAILURES) e.lockedUntil = t + LOCK_MS;
  }
  prune();
}

/** Clear all counters for the given keys after a successful login. */
export function recordSuccess(keys: string[]): void {
  for (const key of keys) entries.delete(key);
}

/** Build the limiter keys for a request (IP-scoped and username-scoped). */
export function loginKeys(ip: string, username: string): string[] {
  return [`ip:${ip}`, `user:${username.toLowerCase()}`];
}
