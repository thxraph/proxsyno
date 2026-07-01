import { useQuery } from '@tanstack/react-query';
import { pve } from '../../api/client';
import type { GuestRef, PveTask } from '../../lib/types';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { ErrorState, LoadingState } from '../../components/states';
import { formatUnix } from '../../lib/format';
import { guestKey, cfgStr } from './util';

function statusTone(status: string | undefined): 'success' | 'danger' | 'warning' {
  if (!status || status === 'OK') return 'success';
  if (status === 'running') return 'warning';
  return 'danger';
}

export function GuestTasksTab({ guest }: { guest: GuestRef }) {
  const tasksQ = useQuery({
    queryKey: guestKey(guest, 'tasks'),
    queryFn: () =>
      pve.get<PveTask[]>(`/pve/nodes/${guest.node}/tasks?vmid=${guest.vmid}&limit=50`),
    refetchInterval: 10_000,
  });

  const columns: Column<PveTask>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (t) => <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{cfgStr(t.type) || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => {
        const s = t.status ?? (t.endtime ? 'OK' : 'running');
        return <Badge tone={statusTone(t.status)}>{s}</Badge>;
      },
    },
    {
      key: 'starttime',
      header: 'Started',
      render: (t) => <span className="text-xs tabular-nums text-slate-500">{formatUnix(t.starttime)}</span>,
    },
    {
      key: 'endtime',
      header: 'Ended',
      render: (t) => <span className="text-xs tabular-nums text-slate-500">{formatUnix(t.endtime)}</span>,
    },
    {
      key: 'user',
      header: 'User',
      render: (t) => <span className="text-xs text-slate-500">{cfgStr(t.user) || '—'}</span>,
    },
  ];

  if (tasksQ.isLoading) return <LoadingState label="Loading tasks…" />;
  if (tasksQ.isError) return <ErrorState error={tasksQ.error} onRetry={() => tasksQ.refetch()} />;

  return (
    <DataTable
      columns={columns}
      rows={tasksQ.data ?? []}
      rowKey={(t) => t.upid}
      emptyMessage="No recent tasks for this guest."
    />
  );
}
