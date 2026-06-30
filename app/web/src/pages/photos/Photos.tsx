import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Image as ImageIcon } from 'lucide-react';
import { api } from '../../api/client';
import { cx } from '../../lib/format';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../../components/states';
import { Breadcrumb, PhotoGrid } from './PhotoGrid';
import { Lightbox } from './Lightbox';
import type { MediaItem, MediaKind, MediaListing } from './types';

const ROOT = '/mnt';
const API = '/api';

const thumbUrl = (p: string) => `${API}/photos/thumb?path=${encodeURIComponent(p)}`;
const rawUrl = (p: string) => `${API}/photos/raw?path=${encodeURIComponent(p)}`;

function parentPath(path: string): string {
  if (path === ROOT || path === '/') return ROOT;
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  const parent = idx <= 0 ? '/' : trimmed.slice(0, idx);
  return parent.length < ROOT.length ? ROOT : parent;
}

type Filter = 'all' | 'image' | 'video';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'image', label: 'Photos' },
  { key: 'video', label: 'Videos' },
];

export function Photos() {
  const qc = useQueryClient();
  const [path, setPath] = useState(ROOT);
  const [filter, setFilter] = useState<Filter>('all');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<MediaItem | null>(null);

  const listQ = useQuery({
    queryKey: ['photos', path],
    queryFn: () => api.get<MediaListing>(`/photos?path=${encodeURIComponent(path)}`),
  });

  const deleteMut = useMutation({
    mutationFn: (target: string) => api.del<void>(`/photos?path=${encodeURIComponent(target)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['photos', path] }),
  });

  const items = useMemo(
    () =>
      (listQ.data?.items ?? []).filter((i) => filter === 'all' || i.kind === (filter as MediaKind)),
    [listQ.data, filter],
  );

  const navigate = (p: string) => {
    setPath(p);
    setFilter('all');
    setLightboxIndex(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <ImageIcon className="h-5 w-5 text-accent-400" aria-hidden /> Photos
        </h1>
        <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                'rounded-md px-3 py-1 text-sm transition-colors',
                filter === f.key
                  ? 'bg-accent-500 font-medium text-white'
                  : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Breadcrumb path={path} onNavigate={navigate} />
        {path !== ROOT && (
          <button
            className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-accent-400"
            onClick={() => navigate(parentPath(path))}
          >
            <ChevronRight className="h-4 w-4 rotate-180" aria-hidden /> Up one level
          </button>
        )}
      </div>

      {listQ.isLoading ? (
        <LoadingState label="Loading gallery…" />
      ) : listQ.isError ? (
        <ErrorState error={listQ.error} onRetry={() => listQ.refetch()} />
      ) : (
        <PhotoGrid
          folders={listQ.data?.folders ?? []}
          items={items}
          hasThumbnailer={listQ.data?.hasThumbnailer ?? false}
          thumbUrl={thumbUrl}
          onOpenFolder={navigate}
          onOpenItem={setLightboxIndex}
          onDelete={setToDelete}
        />
      )}

      {lightboxIndex !== null && items[lightboxIndex] && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          rawUrl={rawUrl}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={setToDelete}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete media"
        message={
          <>
            Delete <strong>{toDelete?.name}</strong>? This permanently removes the file and cannot
            be undone.
          </>
        }
        confirmLabel="Delete"
        busy={deleteMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteMut.mutateAsync(toDelete.path);
          setToDelete(null);
          setLightboxIndex(null);
        }}
      />
    </div>
  );
}
