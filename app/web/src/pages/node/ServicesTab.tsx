import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, RotateCcw, Square, Wrench } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../../components/states';
import { IconBtn } from '../../components/IconBtn';
import { capitalize } from '../../lib/format';
import { str, type PveObj } from './util';

type ServiceAction = 'start' | 'stop' | 'restart';
const CONFIRM_ACTIONS: ServiceAction[] = ['stop', 'restart'];

export function ServicesTab({ node }: { node: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['node', 'services', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/services`),
  });

  const [pending, setPending] = useState<{ service: string; action: ServiceAction } | null>(null);

  const mut = useMutation({
    mutationFn: ({ service, action }: { service: string; action: ServiceAction }) =>
      pve.post(`/pve/nodes/${node}/services/${service}/${action}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['node', 'services', node] }),
  });

  const run = (service: string, action: ServiceAction) => {
    if (CONFIRM_ACTIONS.includes(action)) setPending({ service, action });
    else mut.mutate({ service, action });
  };

  const columns: Column<PveObj>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (s) => <span className="font-mono text-xs text-zinc-200">{str(s, 'service') || str(s, 'name')}</span>,
    },
    { key: 'desc', header: 'Description', render: (s) => <span className="text-zinc-300">{str(s, 'desc')}</span> },
    {
      key: 'state',
      header: 'State',
      render: (s) => {
        const state = str(s, 'state');
        return <Badge tone={state === 'running' ? 'success' : state === 'dead' ? 'neutral' : 'warning'}>{state || '—'}</Badge>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => {
        const service = str(s, 'service') || str(s, 'name');
        const running = str(s, 'state') === 'running';
        return (
          <div className="flex justify-end gap-1">
            {running ? (
              <>
                <IconBtn title="Restart" icon={RotateCcw} disabled={mut.isPending} onClick={() => run(service, 'restart')} />
                <IconBtn title="Stop" icon={Square} danger disabled={mut.isPending} onClick={() => run(service, 'stop')} />
              </>
            ) : (
              <IconBtn title="Start" icon={Play} disabled={mut.isPending} onClick={() => run(service, 'start')} />
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Wrench className="h-4 w-4 text-zinc-400" aria-hidden /> System services
        </h3>
        <button className="btn-secondary" onClick={() => q.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </button>
      </div>

      {q.isLoading ? (
        <LoadingState label="Loading services…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data ?? []}
          rowKey={(s) => str(s, 'service') || str(s, 'name')}
          emptyMessage="No services reported."
        />
      )}

      <ConfirmDialog
        open={!!pending}
        title={pending ? `${capitalize(pending.action)} service` : ''}
        message={
          pending ? (
            <>
              {capitalize(pending.action)} <strong>{pending.service}</strong>? This may interrupt running
              workloads that depend on it.
            </>
          ) : (
            ''
          )
        }
        confirmLabel={pending ? capitalize(pending.action) : 'Confirm'}
        busy={mut.isPending}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          await mut.mutateAsync(pending);
          setPending(null);
        }}
      />
    </div>
  );
}

