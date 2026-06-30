import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/format';

interface StatCardProps {
  title: string;
  value: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  footer?: ReactNode;
  className?: string;
}

export function StatCard({ title, value, subtitle, icon: Icon, footer, className }: StatCardProps) {
  return (
    <div className={cx('card p-4', className)}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className="rounded-lg bg-accent-50 p-2 text-accent-600 dark:bg-accent-500/10 dark:text-accent-400">
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}
