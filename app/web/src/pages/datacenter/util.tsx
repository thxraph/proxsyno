import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { ErrorState, LoadingState } from '../../components/states';
import { cx } from '../../lib/format';

// Shared helpers re-exported for the datacenter tabs.
export { errMsg } from '../../api/client';
export { IconBtn } from '../../components/IconBtn';

// Proxmox returns dynamic objects; type them loosely and read with accessors.
export type PveRow = Record<string, unknown>;

export function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Proxmox booleans are 0 / 1 (string or number).
export function bool01(v: unknown): boolean {
  return str(v) === '1';
}

// Loading / error gate around a react-query result.
export function QueryGate<T>({
  query,
  loading,
  children,
}: {
  query: UseQueryResult<T>;
  loading?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState label={loading ?? 'Loading…'} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data as T)}</>;
}

export function Banner({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'mb-3 rounded-lg px-3 py-2 text-sm',
        tone === 'error'
          ? 'bg-rose-500/10 text-rose-400'
          : 'bg-emerald-500/10 text-emerald-400',
      )}
    >
      {children}
    </div>
  );
}

// Section header used above a DataTable (the table renders its own card).
export function TabHeader({
  title,
  icon: Icon,
  actions,
}: {
  title: string;
  icon: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <Icon className="h-4 w-4 text-accent-500" aria-hidden /> {title}
      </h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-accent-500 focus:ring-accent-500"
      />
      {label}
    </label>
  );
}

// A monospace, copyable value (used for the one-time API token secret).
export function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100">
        {value}
      </code>
      <button
        type="button"
        className="btn-secondary shrink-0"
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        Copy
      </button>
    </div>
  );
}
