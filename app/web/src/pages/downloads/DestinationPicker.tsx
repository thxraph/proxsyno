import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, FolderOpen, HardDrive } from 'lucide-react';
import { api } from '../../api/client';
import type { FileEntry, FileListResponse } from '../../lib/types';
import { cx } from '../../lib/format';
import { FILES_ROOT, joinPath } from '../../lib/paths';
import { ErrorState, LoadingState } from '../../components/states';

/**
 * Inline folder browser reusing the jailed /files/list endpoint. The currently
 * shown directory IS the selection — navigate into subfolders to pick one.
 */
export function DestinationPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}) {
  const [path, setPath] = useState(value || FILES_ROOT);

  const listQ = useQuery({
    queryKey: ['files', path],
    queryFn: () => api.get<FileListResponse>(`/files/list?path=${encodeURIComponent(path)}`),
  });

  const navigate = (next: string) => {
    setPath(next);
    onChange(next);
  };

  const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
  const dirs = (listQ.data?.entries ?? []).filter((e: FileEntry) => e.type === 'dir');

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-0.5 border-b border-zinc-800 px-2 py-2 text-xs">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-zinc-300 hover:bg-zinc-800"
          onClick={() => navigate(FILES_ROOT)}
        >
          <HardDrive className="h-3.5 w-3.5" aria-hidden /> root
        </button>
        {segments.slice(1).map((seg, i) => {
          const target = '/' + segments.slice(0, i + 2).join('/');
          return (
            <span key={target} className="flex items-center gap-0.5">
              <ChevronRight className="h-3 w-3 text-zinc-600" aria-hidden />
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800"
                onClick={() => navigate(target)}
              >
                {seg}
              </button>
            </span>
          );
        })}
      </nav>

      <div className="max-h-48 overflow-y-auto p-1">
        {listQ.isLoading ? (
          <LoadingState label="Loading folders…" />
        ) : listQ.isError ? (
          <ErrorState error={listQ.error} onRetry={() => listQ.refetch()} />
        ) : dirs.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-zinc-500">No subfolders here.</p>
        ) : (
          <ul className="space-y-0.5">
            {dirs.map((d) => (
              <li key={d.name}>
                <button
                  type="button"
                  onClick={() => navigate(joinPath(path, d.name))}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <Folder className="h-4 w-4 shrink-0 text-accent-400" aria-hidden />
                  <span className="truncate">{d.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
        <FolderOpen className={cx('h-3.5 w-3.5 shrink-0 text-accent-400')} aria-hidden />
        <span className="truncate">
          Download to <span className="font-mono text-zinc-200">{path}</span>
        </span>
      </div>
    </div>
  );
}
