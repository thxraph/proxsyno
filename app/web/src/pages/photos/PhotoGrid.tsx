import { ChevronRight, Film, HardDrive, Folder, Image as ImageIcon, Trash2 } from 'lucide-react';
import { cx } from '../../lib/format';
import { FILES_ROOT } from '../../lib/paths';
import type { MediaFolder, MediaItem } from './types';

export function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm">
      <button
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-zinc-300 hover:bg-zinc-800 hover:text-accent-400"
        onClick={() => onNavigate(FILES_ROOT)}
      >
        <HardDrive className="h-4 w-4" aria-hidden /> root
      </button>
      {segments.map((seg, i) => {
        const target = '/' + segments.slice(0, i + 1).join('/');
        const isLast = i === segments.length - 1;
        return (
          <span key={target} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-zinc-600" aria-hidden />
            <button
              className={cx(
                'rounded-md px-2 py-1',
                isLast
                  ? 'font-medium text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-accent-400',
              )}
              onClick={() => onNavigate(target)}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

interface PhotoGridProps {
  folders: MediaFolder[];
  items: MediaItem[];
  hasThumbnailer: boolean;
  thumbUrl: (path: string) => string;
  onOpenFolder: (path: string) => void;
  onOpenItem: (index: number) => void;
  onDelete: (item: MediaItem) => void;
}

export function PhotoGrid({
  folders,
  items,
  hasThumbnailer,
  thumbUrl,
  onOpenFolder,
  onOpenItem,
  onDelete,
}: PhotoGridProps) {
  return (
    <div className="flex flex-col gap-4">
      {folders.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {folders.map((f) => (
            <button
              key={f.path}
              onClick={() => onOpenFolder(f.path)}
              className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800 hover:text-accent-400"
              title={f.name}
            >
              <Folder className="h-4 w-4 shrink-0 text-accent-400" aria-hidden />
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item, i) => {
            // Videos only get a thumbnail when a server-side thumbnailer exists;
            // otherwise show a film placeholder (an <img> can't render a video).
            const showThumb = item.kind === 'image' || hasThumbnailer;
            return (
              <div
                key={item.path}
                className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-transparent hover:ring-accent-500"
              >
                <button
                  onClick={() => onOpenItem(i)}
                  className="block h-full w-full"
                  title={item.name}
                >
                  {showThumb ? (
                    <img
                      src={thumbUrl(item.path)}
                      alt={item.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-zinc-600">
                      <Film className="h-10 w-10" aria-hidden />
                    </span>
                  )}
                </button>

                {item.kind === 'video' && (
                  <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/60 p-1 text-zinc-100">
                    <Film className="h-3 w-3" aria-hidden />
                  </span>
                )}

                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[11px] text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100">
                  {item.name}
                </span>

                <button
                  onClick={() => onDelete(item)}
                  className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-zinc-200 opacity-0 transition-opacity hover:bg-rose-600 hover:text-white group-hover:opacity-100"
                  title="Delete"
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {folders.length === 0 && items.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-zinc-400">
          <ImageIcon className="h-8 w-8 text-zinc-600" aria-hidden />
          <p className="text-sm">No photos or videos in this folder.</p>
        </div>
      )}
    </div>
  );
}
