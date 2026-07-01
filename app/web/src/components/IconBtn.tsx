import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/format';

// Square icon-only ghost button (row actions in tables, etc.).
export function IconBtn({
  title,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  title: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cx('btn-ghost h-8 w-8 p-0', danger && 'text-rose-400 hover:bg-rose-500/10')}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
