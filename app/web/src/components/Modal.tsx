import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/format';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** While true, Escape / backdrop / the X button won't close the modal. */
  busy?: boolean;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

// Open modals in stacking order, so only the topmost one reacts to Escape.
const modalStack: object[] = [];

export function Modal({ open, onClose, title, children, footer, size = 'md', busy = false }: ModalProps) {
  const stackId = useRef({});

  useEffect(() => {
    if (!open) return;
    const id = stackId.current;
    modalStack.push(id);
    document.body.style.overflow = 'hidden';
    return () => {
      const i = modalStack.indexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (modalStack[modalStack.length - 1] !== stackId.current) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className={cx('card my-8 w-full p-0', SIZES[size])}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
          <button
            type="button"
            className="btn-ghost -mr-2 h-8 w-8 rounded-lg p-0"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
