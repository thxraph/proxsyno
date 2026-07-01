import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import { formatBytes, formatDate } from '../../lib/format';
import type { MediaItem } from './types';

interface LightboxProps {
  items: MediaItem[];
  index: number;
  rawUrl: (path: string) => string;
  onIndex: (index: number) => void;
  onClose: () => void;
  onDelete: (item: MediaItem) => void;
}

export function Lightbox({ items, index, rawUrl, onIndex, onClose, onDelete }: LightboxProps) {
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onIndex, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-zinc-200">
        <div className="min-w-0">
          <p className="truncate font-medium text-zinc-100">{item.name}</p>
          <p className="text-xs text-zinc-400">
            {formatDate(item.mtimeMs)} · {formatBytes(item.sizeBytes)} · {index + 1} / {items.length}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onDelete(item)}
            className="rounded-lg p-2 text-zinc-300 hover:bg-rose-600 hover:text-white"
            title="Delete"
            aria-label="Delete"
          >
            <Trash2 className="h-5 w-5" aria-hidden />
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-300 hover:bg-zinc-800"
            title="Close"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* Stage — clicking the empty area around the media closes, the media itself doesn't. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {hasPrev && (
          <button
            onClick={() => onIndex(index - 1)}
            className="absolute left-4 z-10 rounded-full bg-black/50 p-2 text-zinc-100 hover:bg-accent-500"
            title="Previous"
            aria-label="Previous"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </button>
        )}

        {item.kind === 'image' ? (
          <img
            src={rawUrl(item.path)}
            alt={item.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <video
            key={item.path}
            src={rawUrl(item.path)}
            controls
            autoPlay
            className="max-h-full max-w-full"
          />
        )}

        {hasNext && (
          <button
            onClick={() => onIndex(index + 1)}
            className="absolute right-4 z-10 rounded-full bg-black/50 p-2 text-zinc-100 hover:bg-accent-500"
            title="Next"
            aria-label="Next"
          >
            <ChevronRight className="h-6 w-6" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
