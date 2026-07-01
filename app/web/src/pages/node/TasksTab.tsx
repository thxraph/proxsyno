import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, RefreshCw } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ErrorState, LoadingState } from '../../components/states';
import { formatUnix } from '../../lib/format';
import { asArray, num, str, type PveObj } from './util';

export function TasksTab({ node }: { node: string }) {
  const q = useQuery({
    queryKey: ['node', 'tasks', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/tasks?limit=100`),
  });

  const [openUpid, setOpenUpid] = useState<string | null>(null);

  const columns: Column<PveObj>[] = [
    {
      key: 'starttime',
      header: 'Start time',
      render: (t) => <span className="tabular-nums text-xs text-zinc-300">{formatUnix(num(t, 'starttime'))}</span>,
    },
    { key: 'type', header: 'Type', render: (t) => <span className="font-mono text-xs text-zinc-200">{str(t, 'type')}</span> },
    { key: 'id', header: 'ID', render: (t) => <span className="font-mono text-xs text-zinc-400">{str(t, 'id') || '—'}</span> },
    { key: 'user', header: 'User', render: (t) => <span className="text-xs text-zinc-400">{str(t, 'user')}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (t) => {
        const status = str(t, 'status');
        const running = !status && !num(t, 'endtime');
        if (running) return <Badge tone="info">running</Badge>;
        return <Badge tone={status === 'OK' ? 'success' : 'danger'}>{status || 'unknown'}</Badge>;
      },
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <ListChecks className="h-4 w-4 text-zinc-400" aria-hidden /> Recent tasks
        </h3>
        <button className="btn-secondary" onClick={() => q.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </button>
      </div>

      {q.isLoading ? (
        <LoadingState label="Loading tasks…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data ?? []}
          rowKey={(t) => str(t, 'upid')}
          onRowClick={(t) => setOpenUpid(str(t, 'upid'))}
          emptyMessage="No tasks recorded."
        />
      )}

      {openUpid && <TaskLogModal node={node} upid={openUpid} onClose={() => setOpenUpid(null)} />}
    </div>
  );
}

function TaskLogModal({ node, upid, onClose }: { node: string; upid: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['node', 'task-log', node, upid],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/tasks/${encodeURIComponent(upid)}/log?limit=1000`),
  });

  const lines = asArray(q.data);

  return (
    <Modal open onClose={onClose} size="lg" title="Task log">
      <p className="mb-3 break-all font-mono text-xs text-zinc-500">{upid}</p>
      {q.isLoading ? (
        <LoadingState label="Reading task log…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No log output.</p>
      ) : (
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">
          {lines.map((l) => str(l, 't')).join('\n')}
        </pre>
      )}
    </Modal>
  );
}
