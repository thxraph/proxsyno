import { useRef, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  HardDrive,
  Link2,
  Loader2,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { FileEntry, FileListResponse } from '../lib/types';
import { cx, formatBytes, formatDate } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../components/states';

const ROOT = '/mnt';

function joinPath(base: string, name: string): string {
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
}

function parentPath(path: string): string {
  if (path === ROOT || path === '/') return ROOT;
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  const parent = idx <= 0 ? '/' : trimmed.slice(0, idx);
  // Never climb above the jail root.
  return parent.length < ROOT.length ? ROOT : parent;
}

export function Files() {
  const qc = useQueryClient();
  const [path, setPath] = useState(ROOT);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [toDelete, setToDelete] = useState<FileEntry | null>(null);

  const listQ = useQuery({
    queryKey: ['files', path],
    queryFn: () => api.get<FileListResponse>(`/files/list?path=${encodeURIComponent(path)}`),
  });

  const uploadMut = useMutation({
    mutationFn: (files: File[]) =>
      api.upload(`/files/upload?path=${encodeURIComponent(path)}`, files),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files', path] }),
  });

  const deleteMut = useMutation({
    mutationFn: (target: string) => api.post<void>('/files/delete', { path: target }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files', path] }),
  });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) uploadMut.mutate(files);
  };

  const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);

  const columns: Column<FileEntry>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (e) => {
        const isDir = e.type === 'dir';
        const Icon = isDir ? Folder : e.type === 'symlink' ? Link2 : FileIcon;
        const content = (
          <span className="flex items-center gap-2">
            <Icon className={cx('h-4 w-4 shrink-0', isDir ? 'text-accent-500' : 'text-slate-400')} />
            <span className={cx('truncate', isDir && 'font-medium')}>{e.name}</span>
          </span>
        );
        return isDir ? (
          <button
            className="text-left text-slate-800 hover:text-accent-600 dark:text-slate-100"
            onClick={() => setPath(joinPath(path, e.name))}
          >
            {content}
          </button>
        ) : (
          <span className="text-slate-700 dark:text-slate-200">{content}</span>
        );
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: (e) => (
        <Badge tone={e.type === 'dir' ? 'accent' : e.type === 'symlink' ? 'info' : 'neutral'}>
          {e.type}
        </Badge>
      ),
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
      key: 'mode',
      header: 'Mode',
      render: (e) => <span className="font-mono text-xs text-slate-500">{e.mode}</span>,
    },
    {
      key: 'mtime',
      header: 'Modified',
      render: (e) => <span className="text-xs text-slate-500">{formatDate(e.mtimeMs)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) => (
        <div className="flex justify-end gap-1">
          {e.type === 'file' && (
            <a
              className="btn-ghost h-8 w-8 p-0"
              href={api.downloadUrl(joinPath(path, e.name))}
              title="Download"
            >
              <Download className="h-4 w-4" />
            </a>
          )}
          <button className="btn-ghost h-8 w-8 p-0" onClick={() => setRenaming(e)} title="Rename">
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost h-8 w-8 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            onClick={() => setToDelete(e)}
            title="Delete"
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
        title="Files"
        description="Browse, upload and manage files inside the jail"
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setMkdirOpen(true)}>
              <FolderPlus className="h-4 w-4" /> New folder
            </button>
            <button
              className="btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMut.isPending}
            >
              {uploadMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) uploadMut.mutate(files);
                e.target.value = '';
              }}
            />
          </div>
        }
      />

      {/* Breadcrumb */}
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        <button
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={() => setPath(ROOT)}
        >
          <HardDrive className="h-4 w-4" /> root
        </button>
        {segments.map((seg, i) => {
          const target = '/' + segments.slice(0, i + 1).join('/');
          const isLast = i === segments.length - 1;
          // The jail root segments are not navigable above ROOT.
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

      {uploadMut.isError && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          Upload failed:{' '}
          {uploadMut.error instanceof ApiError ? uploadMut.error.message : 'unknown error'}
        </div>
      )}

      {/* Drop zone wrapper */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'rounded-xl transition-colors',
          dragging && 'ring-2 ring-accent-500 ring-offset-2 ring-offset-slate-100 dark:ring-offset-slate-950',
        )}
      >
        {dragging && (
          <div className="pointer-events-none mb-3 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent-400 bg-accent-50/60 py-6 text-sm font-medium text-accent-700 dark:bg-accent-500/10 dark:text-accent-300">
            <Upload className="h-5 w-5" /> Drop files to upload to {path}
          </div>
        )}

        {path !== ROOT && (
          <button
            className="mb-3 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-accent-600 dark:text-slate-400"
            onClick={() => setPath(parentPath(path))}
          >
            <ChevronRight className="h-4 w-4 rotate-180" /> Up one level
          </button>
        )}

        {listQ.isLoading ? (
          <LoadingState label="Listing directory…" />
        ) : listQ.isError ? (
          <ErrorState error={listQ.error} onRetry={() => listQ.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={listQ.data?.entries ?? []}
            rowKey={(e) => e.name}
            emptyMessage="This folder is empty. Drag files here or use Upload."
          />
        )}
      </div>

      {mkdirOpen && (
        <MkdirModal basePath={path} onClose={() => setMkdirOpen(false)} />
      )}

      {renaming && (
        <RenameModal basePath={path} entry={renaming} onClose={() => setRenaming(null)} />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete item"
        message={
          <>
            Delete <strong>{toDelete?.name}</strong>
            {toDelete?.type === 'dir' ? ' and all of its contents' : ''}? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        busy={deleteMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteMut.mutateAsync(joinPath(path, toDelete.name));
          setToDelete(null);
        }}
      />
    </div>
  );
}

function MkdirModal({ basePath, onClose }: { basePath: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (folder: string) =>
      api.post<void>('/files/mkdir', { path: joinPath(basePath, folder) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', basePath] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to create folder'),
  });

  const onSubmit = () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes('/')) {
      setError('Enter a folder name without slashes.');
      return;
    }
    mut.mutate(trimmed);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="New folder"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <FormField label="Folder name" required error={error ?? undefined}>
        <input
          className="input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          placeholder="new-folder"
        />
      </FormField>
      <p className="text-xs text-slate-400">
        Created inside <span className="font-mono">{basePath}</span>
      </p>
    </Modal>
  );
}

function RenameModal({
  basePath,
  entry,
  onClose,
}: {
  basePath: string;
  entry: FileEntry;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (newName: string) =>
      api.post<void>('/files/rename', {
        from: joinPath(basePath, entry.name),
        to: joinPath(basePath, newName),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', basePath] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to rename'),
  });

  const onSubmit = () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes('/')) {
      setError('Enter a name without slashes.');
      return;
    }
    if (trimmed === entry.name) {
      onClose();
      return;
    }
    mut.mutate(trimmed);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Rename ${entry.name}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Renaming…' : 'Rename'}
          </button>
        </>
      }
    >
      <FormField label="New name" required error={error ?? undefined}>
        <input
          className="input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
      </FormField>
    </Modal>
  );
}
