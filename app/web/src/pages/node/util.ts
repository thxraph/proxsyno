// Local helpers for the Node management app. Proxmox returns dynamic, loosely
// typed objects, so we read fields defensively rather than declaring strict
// shapes for every endpoint.

export type PveObj = Record<string, unknown>;

/** Read a field as a string ('' when missing/null). */
export function str(o: PveObj | undefined, k: string): string {
  const v = o?.[k];
  return v === undefined || v === null ? '' : String(v);
}

/** Read a field as a number (undefined when not numeric). */
export function num(o: PveObj | undefined, k: string): number | undefined {
  const v = o?.[k];
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** Read a field as a boolean (Proxmox uses 1/0, true/false, '1'/'0'). */
export function bool(o: PveObj | undefined, k: string): boolean {
  const v = o?.[k];
  return v === 1 || v === true || v === '1';
}

/** Coerce an unknown value into an array of rows. */
export function asArray<T = PveObj>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Format a Proxmox unix-seconds timestamp. */
export function formatUnix(seconds: number | undefined): string {
  if (!seconds) return '—';
  try {
    return new Date(seconds * 1000).toLocaleString();
  } catch {
    return '—';
  }
}
