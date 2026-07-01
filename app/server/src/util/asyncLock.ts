/**
 * Keyed promise-chain lock: serialises async read-modify-write cycles sharing a
 * key so concurrent mutations can't clobber each other. Callers pick a key that
 * names the resource (a file path, a username, ...).
 */
const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  chains.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}
