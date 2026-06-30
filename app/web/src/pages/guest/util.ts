import type { GuestRef } from '../../lib/types';

// Base proxy path for a guest, e.g. `/pve/nodes/pve/qemu/100`.
export function guestBase(g: GuestRef): string {
  return `/pve/nodes/${g.node}/${g.type}/${g.vmid}`;
}

// react-query key prefix for everything under a guest.
export function guestKey(g: GuestRef, ...rest: (string | number)[]): (string | number)[] {
  return ['pve', g.type, g.vmid, ...rest];
}

// Proxmox stringifies many scalars; render them safely.
export function cfgStr(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

// Proxmox booleans are `0` / `1` (number or string).
export function cfgBool(v: unknown): boolean {
  return cfgStr(v) === '1';
}

// Proxmox task start/end times are unix seconds.
export function formatUnix(sec: number | undefined | null): string {
  if (!sec) return '—';
  try {
    return new Date(sec * 1000).toLocaleString();
  } catch {
    return '—';
  }
}
