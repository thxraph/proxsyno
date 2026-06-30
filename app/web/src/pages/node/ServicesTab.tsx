import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, RotateCcw, Square, Wrench } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../../components/states';
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
        title={pending ? `${title(pending.action)} service` : ''}
        message={
          pending ? (
            <>
              {title(pending.action)} <strong>{pending.service}</strong>? This may interrupt running
              workloads that depend on it.
            </>
          ) : (
            ''
          )
        }
        confirmLabel={pending ? title(pending.action) : 'Confirm'}
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

function title(a: ServiceAction): string {
  return a.charAt(0).toUpperCase() + a.slice(1);
}

function IconBtn({
  title: t,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  title: string;
  icon: typeof Play;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={t}
      aria-label={t}
      disabled={disabled}
      onClick={onClick}
      className={
        'btn-ghost h-8 w-8 p-0' + (danger ? ' text-rose-400 hover:bg-rose-500/10' : '')
      }
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
