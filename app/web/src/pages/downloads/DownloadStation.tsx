import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Info,
  Link2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api } from '../../api/client';
import { formatBitrate, formatBytes } from '../../lib/format';
import { IconBtn } from '../../components/IconBtn';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge, type BadgeTone } from '../../components/Badge';
import { ProgressBar } from '../../components/ProgressBar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../../components/states';
import { AddDownloadModal } from './AddDownloadModal';
import type { DownloadCapabilities, DownloadJob, DownloadStatus } from './types';

const REFETCH_MS = 1500; // while something is downloading/queued
const REFETCH_IDLE_MS = 10_000; // everything paused/done/errored

const STATUS_TONE: Record<DownloadStatus, BadgeTone> = {
  queued: 'neutral',
  active: 'info',
  paused: 'warning',
  done: 'success',
  error: 'danger',
};

function pct(job: DownloadJob): number {
  return job.bytesTotal > 0 ? (job.bytesDone / job.bytesTotal) * 100 : 0;
}

export function DownloadStation() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [toRemove, setToRemove] = useState<DownloadJob | null>(null);

  const capsQ = useQuery({
    queryKey: ['downloads', 'capabilities'],
    queryFn: () => api.get<DownloadCapabilities>('/downloads/capabilities'),
    staleTime: 5 * 60 * 1000,
  });

  const listQ = useQuery({
    queryKey: ['downloads'],
    queryFn: () => api.get<DownloadJob[]>('/downloads'),
    refetchInterval: (query) =>
      query.state.data?.some((j) => j.status === 'active' || j.status === 'queued')
        ? REFETCH_MS
        : REFETCH_IDLE_MS,
  });

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'cancel' }) =>
      api.post<DownloadJob>(`/downloads/${id}/${action}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.del<void>(`/downloads/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });

  const columns: Column<DownloadJob>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (j) => (
        <div className="flex min-w-0 items-center gap-2">
          {j.url.toLowerCase().startsWith('magnet:') ? (
            <Link2 className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          ) : (
            <Download className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-100">{j.filename ?? j.url}</p>
            <p className="truncate text-[11px] text-zinc-500">{j.dest}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (j) => (
        <div className="flex flex-col gap-0.5">
          <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
          {j.status === 'error' && j.error && (
            <span className="text-[11px] text-rose-400">{j.error}</span>
          )}
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (j) => (
        <div className="w-44">
          <ProgressBar
            value={j.status === 'done' ? 100 : pct(j)}
            tone={j.status === 'done' ? 'success' : 'accent'}
            showLabel={j.bytesTotal > 0 || j.status === 'done'}
          />
          <p className="mt-0.5 text-[11px] tabular-nums text-zinc-500">
            {formatBytes(j.bytesDone)}
            {j.bytesTotal > 0 ? ` / ${formatBytes(j.bytesTotal)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'speed',
      header: 'Speed',
      align: 'right',
      render: (j) => (
        <span className="tabular-nums text-xs text-zinc-400">
          {j.status === 'active' && j.speed > 0 ? formatBitrate(j.speed) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (j) => (
        <div className="flex justify-end gap-1">
          {(j.status === 'active' || j.status === 'queued') && (
            <>
              <IconBtn
                title="Pause"
                icon={Pause}
                onClick={() => actionMut.mutate({ id: j.id, action: 'pause' })}
              />
              <IconBtn
                title="Cancel"
                icon={XCircle}
                onClick={() => actionMut.mutate({ id: j.id, action: 'cancel' })}
              />
            </>
          )}
          {j.status === 'paused' && (
            <IconBtn
              title="Resume"
              icon={Play}
              onClick={() => actionMut.mutate({ id: j.id, action: 'resume' })}
            />
          )}
          {j.status === 'error' && (
            <IconBtn
              title="Retry"
              icon={RotateCcw}
              onClick={() => actionMut.mutate({ id: j.id, action: 'resume' })}
            />
          )}
          <IconBtn title="Remove" icon={Trash2} danger onClick={() => setToRemove(j)} />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-px">
      <PageHeader
        title="Download Station"
        description="Download files by URL into a folder under the file jail"
        actions={
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add download
          </button>
        }
      />

      {capsQ.data && !capsQ.data.magnet && (
        <div className="flex items-start gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <p>
            Using the <span className="font-medium text-zinc-100">wget</span> engine — only
            http/https downloads are available. Install <span className="font-mono">aria2c</span> on
            the host to enable magnet and torrent links.
          </p>
        </div>
      )}

      {listQ.isLoading ? (
        <LoadingState label="Loading downloads…" />
      ) : listQ.isError ? (
        <ErrorState error={listQ.error} onRetry={() => listQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={listQ.data ?? []}
          rowKey={(j) => j.id}
          emptyMessage="No downloads yet. Add one to get started."
        />
      )}

      {adding && (
        <AddDownloadModal capabilities={capsQ.data} onClose={() => setAdding(false)} />
      )}

      <ConfirmDialog
        open={!!toRemove}
        title="Remove download"
        message={
          <>
            Remove <strong>{toRemove?.filename ?? toRemove?.url}</strong> from the list? Already
            downloaded files are kept on disk.
          </>
        }
        confirmLabel="Remove"
        busy={removeMut.isPending}
        onCancel={() => setToRemove(null)}
        onConfirm={async () => {
          if (!toRemove) return;
          await removeMut.mutateAsync(toRemove.id);
          setToRemove(null);
        }}
      />
    </div>
  );
}

