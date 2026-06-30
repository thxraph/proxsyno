import { cx } from '../lib/format';

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<ProgressTone, string> = {
  accent: 'bg-accent-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

interface ProgressBarProps {
  // 0..100
  value: number;
  tone?: ProgressTone;
  // auto-color by thresholds (>=90 danger, >=75 warning)
  autoTone?: boolean;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  tone = 'accent',
  autoTone = false,
  showLabel = false,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  let resolvedTone = tone;
  if (autoTone) {
    if (pct >= 90) resolvedTone = 'danger';
    else if (pct >= 75) resolvedTone = 'warning';
    else resolvedTone = 'accent';
  }
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={cx('h-full rounded-full transition-all duration-500', TONES[resolvedTone])}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
