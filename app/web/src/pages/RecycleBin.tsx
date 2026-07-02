import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { api, errMsg } from '../api/client';
import type { FileEntry, FileListResponse, SharesResponse, SmbShare } from '../lib/types';
import { cx, formatBytes, formatDate } from '../lib/format';
import { joinPath, parentPath } from '../lib/paths';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SubmitError } from '../components/SubmitError';
import { EmptyState, ErrorState, LoadingState } from '../components/states';

// The `.recycle` bin lives directly under each SMB share's path.
function recycleRootOf(share: SmbShare): string {
  return joinPath(share.path, '.recycle');
}

export function RecycleBin() {
  const qc = useQueryClient();
  const [shareName, setShareName] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<FileEntry | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);

  const sharesQ = useQuery({
    queryKey: ['shares'],
    queryFn: () => api.get<SharesResponse>('/shares'),
  });

  const recycleShares = useMemo(
    () => (sharesQ.data?.smb ?? []).filter((s) => s.recycle),
    [sharesQ.data],
  );

  // Resolve the active share + its recycle root, defaulting to the first one.
  const share = useMemo(
    () => recycleShares.find((s) => s.name === shareName) ?? recycleShares[0] ?? null,
    [recycleShares, shareName],
  );
  const recycleRoot = share ? recycleRootOf(share) : null;
  // Clamp the current path to the selected share's recycle subtree.
  const activePath = share && path && path.startsWith(recycleRoot!) ? path : recycleRoot;

  const listQ = useQuery({
    queryKey: ['recycle', activePath],
    enabled: !!activePath,
    // A missing `.recycle` dir throws — treat that as an empty bin.
    queryFn: async () => {
      try {
        return await api.get<FileListResponse>(
          `/files/list?path=${encodeURIComponent(activePath!)}`,
        );
      } catch {
        return { path: activePath!, entries: [] } as FileListResponse;
      }
    },
  });

  const restoreMut = useMutation({
    mutationFn: (entry: FileEntry) => {
      const from = joinPath(activePath!, entry.name);
      // Drop the single `/.recycle` segment: <share>/.recycle/<rel> -> <share>/<rel>.
      const to = share!.path + from.slice(recycleRoot!.length);
      return api.post<void>('/files/rename', { from, to });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recycle', activePath] }),
    onError: (e) => setActionError(errMsg(e, 'Failed to restore')),
  });

  const deleteMut = useMutation({
    mutationFn: (target: string) => api.post<void>('/files/delete', { path: target }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recycle', activePath] }),
    onError: (e) => setActionError(errMsg(e, 'Failed to delete')),
  });

  const emptyMut = useMutation({
    mutationFn: () => api.post<void>('/files/delete', { path: recycleRoot! }),
    onSuccess: () => {
      setPath(recycleRoot);
      qc.invalidateQueries({ queryKey: ['recycle'] });
    },
    onError: (e) => setActionError(errMsg(e, 'Failed to empty bin')),
  });

  const selectShare = (s: SmbShare) => {
    setActionError(null);
    setShareName(s.name);
    setPath(recycleRootOf(s));
  };

  // Breadcrumb segments relative to the recycle root (jailed).
  const relSegments =
    activePath && recycleRoot
      ? activePath.slice(recycleRoot.length).split('/').filter(Boolean)
      : [];

  const columns: Column<FileEntry>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (e) => {
        const isDir = e.type === 'dir';
        const Icon = isDir ? Folder : FileIcon;
        const content = (
          <span className="flex items-center gap-2">
            <Icon className={cx('h-4 w-4 shrink-0', isDir ? 'text-accent-500' : 'text-slate-400')} />
            <span className={cx('truncate', isDir && 'font-medium')}>{e.name}</span>
          </span>
        );
        return isDir ? (
          <button
            className="text-left text-slate-800 hover:text-accent-600 dark:text-slate-100"
            onClick={() => setPath(joinPath(activePath!, e.name))}
          >
            {content}
          </button>
        ) : (
          <span className="text-slate-700 dark:text-slate-200">{content}</span>
        );
      },
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      render: (e) => (
        <span className="tabular-nums">{e.type === 'dir' ? '—' : formatBytes(e.sizeBytes)}</span>
      ),
    },
    {
      key: 'mtime',
      header: 'Deleted',
      render: (e) => <span className="text-xs text-slate-500">{formatDate(e.mtimeMs)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) => (
        <div className="flex justify-end gap-1">
          <button
            className="btn-ghost h-8 w-8 p-0 text-accent-600 hover:bg-accent-50 dark:hover:bg-accent-500/10"
            onClick={() => {
              setActionError(null);
              restoreMut.mutate(e);
            }}
            disabled={restoreMut.isPending}
            title="Restore"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost h-8 w-8 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            onClick={() => {
              setActionError(null);
              setToDelete(e);
            }}
            title="Delete forever"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Recycle Bin"
        description="Restore or permanently remove files deleted from your shares"
        actions={
          share && (
            <button
              className="btn-danger"
              onClick={() => {
                setActionError(null);
                setEmptyOpen(true);
              }}
              disabled={emptyMut.isPending}
            >
              {emptyMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Empty bin
            </button>
          )
        }
      />

      {sharesQ.isLoading ? (
        <LoadingState label="Loading shares…" />
      ) : sharesQ.isError ? (
        <ErrorState error={sharesQ.error} onRetry={() => sharesQ.refetch()} />
      ) : recycleShares.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="No recycle bins"
          message="No shares have a recycle bin. Enable it per-share in Shares to keep deleted files recoverable."
        />
      ) : (
        <>
          {/* Share selector */}
          <div className="mb-4 flex flex-wrap gap-2">
            {recycleShares.map((s) => (
              <button
                key={s.name}
                onClick={() => selectShare(s)}
                className={cx(
                  'rounded-lg px-3 py-1.5 text-sm font-medium',
                  s.name === share?.name
                    ? 'bg-accent-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                )}
              >
                {s.name}
              </button>
            ))}
          </div>

          {/* Breadcrumb (jailed to the share's .recycle root) */}
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm">
            <button
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => setPath(recycleRoot)}
            >
              <Trash2 className="h-4 w-4" /> {share?.name}
            </button>
            {relSegments.map((seg, i) => {
              const target = recycleRoot + '/' + relSegments.slice(0, i + 1).join('/');
              const isLast = i === relSegments.length - 1;
              return (
                <span key={target} className="flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  <button
                    className={cx(
                      'rounded-md px-2 py-1',
                      isLast
                        ? 'font-medium text-slate-900 dark:text-slate-50'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                    onClick={() => setPath(target)}
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </nav>

          {actionError && <SubmitError message={actionError} />}

          {activePath !== recycleRoot && (
            <button
              className="mb-3 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-accent-600 dark:text-slate-400"
              onClick={() => setPath(parentPath(activePath!))}
            >
              <ChevronRight className="h-4 w-4 rotate-180" /> Up one level
            </button>
          )}

          {listQ.isLoading ? (
            <LoadingState label="Listing bin…" />
          ) : (listQ.data?.entries.length ?? 0) === 0 ? (
            <EmptyState icon={Trash2} title="Recycle bin is empty" />
          ) : (
            <DataTable
              columns={columns}
              rows={listQ.data?.entries ?? []}
              rowKey={(e) => e.name}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete forever"
        message={
          <>
            Permanently delete <strong>{toDelete?.name}</strong>
            {toDelete?.type === 'dir' ? ' and all of its contents' : ''}? This cannot be undone.
          </>
        }
        confirmLabel="Delete forever"
        busy={deleteMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteMut.mutateAsync(joinPath(activePath!, toDelete.name));
          setToDelete(null);
        }}
      />

      <ConfirmDialog
        open={emptyOpen}
        title="Empty recycle bin"
        message={
          <>
            Permanently delete everything in <strong>{share?.name}</strong>'s recycle bin? This
            cannot be undone.
          </>
        }
        confirmLabel="Empty bin"
        busy={emptyMut.isPending}
        onCancel={() => setEmptyOpen(false)}
        onConfirm={async () => {
          await emptyMut.mutateAsync();
          setEmptyOpen(false);
        }}
      />
    </div>
  );
}
