import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes,
  Container as ContainerIcon,
  FileText,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Trash2,
} from 'lucide-react';
import { api } from '../../api/client';
import type { Guest } from '../../lib/types';
import { cx, formatDate } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { RunContainerModal } from './RunContainerModal';
import type { ContainerAction, DockerContainer, DockerStatus } from './types';

const CONTAINERS_REFETCH_MS = 5000;
// Disruptive actions confirm first.
const CONFIRM_ACTIONS: ContainerAction[] = ['stop', 'remove'];

export function DockerApp() {
  const guestsQ = useQuery({
    queryKey: ['proxmox', 'guests'],
    queryFn: () => api.get<Guest[]>('/proxmox/guests'),
    staleTime: 10_000,
  });

  const guests = useMemo(
    () => (guestsQ.data ?? []).filter((g) => !g.template),
    [guestsQ.data],
  );

  const [selectedKey, setSelectedKey] = useState<string>('');

  // Default to the first running guest once the list arrives.
  useEffect(() => {
    if (selectedKey || guests.length === 0) return;
    const first = guests.find((g) => g.status === 'running') ?? guests[0];
    if (first) setSelectedKey(`${first.type}-${first.vmid}`);
  }, [guests, selectedKey]);

  const selected = guests.find((g) => `${g.type}-${g.vmid}` === selectedKey) ?? null;

  return (
    <div>
      <PageHeader
        title="Docker"
        description="Manage Docker containers running inside a guest"
        actions={
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-slate-400" aria-hidden />
            <select
              className="input w-56"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              aria-label="Select guest"
            >
              {guests.length === 0 && <option value="">No guests</option>}
              {guests.map((g) => (
                <option key={`${g.type}-${g.vmid}`} value={`${g.type}-${g.vmid}`}>
                  {(g.name || `guest-${g.vmid}`)} · {g.type === 'qemu' ? 'VM' : 'LXC'} {g.vmid} ({g.status})
                </option>
              ))}
            </select>
          </div>
        }
      />

      {guestsQ.isLoading ? (
        <LoadingState label="Loading guests…" />
      ) : guestsQ.isError ? (
        <ErrorState error={guestsQ.error} onRetry={() => guestsQ.refetch()} />
      ) : !selected ? (
        <EmptyState icon={Boxes} title="No guests" message="No VMs or containers were found on this host." />
      ) : (
        <GuestDocker key={selectedKey} guest={selected} />
      )}
    </div>
  );
}

function GuestDocker({ guest }: { guest: Guest }) {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ['docker', 'status', guest.type, guest.vmid],
    queryFn: () => api.get<DockerStatus>(`/docker/${guest.type}/${guest.vmid}/status`),
    staleTime: 15_000,
  });

  const reachable = statusQ.data?.reachable && statusQ.data?.dockerInstalled;

  const containersQ = useQuery({
    queryKey: ['docker', 'containers', guest.type, guest.vmid],
    queryFn: () => api.get<DockerContainer[]>(`/docker/${guest.type}/${guest.vmid}/containers`),
    enabled: !!reachable,
    refetchInterval: reachable ? CONTAINERS_REFETCH_MS : false,
  });

  const [running, setRunning] = useState(false);
  const [logsFor, setLogsFor] = useState<DockerContainer | null>(null);
  const [detailFor, setDetailFor] = useState<DockerContainer | null>(null);
  const [pending, setPending] = useState<{ c: DockerContainer; action: ContainerAction } | null>(null);

  const actionMut = useMutation({
    mutationFn: ({ c, action }: { c: DockerContainer; action: ContainerAction }) =>
      api.post<{ ok: true }>(`/docker/${guest.type}/${guest.vmid}/containers/${c.id}/${action}`, undefined),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ['docker', 'containers', guest.type, guest.vmid] }),
  });

  const runAction = (c: DockerContainer, action: ContainerAction) => {
    if (CONFIRM_ACTIONS.includes(action)) setPending({ c, action });
    else actionMut.mutate({ c, action });
  };

  if (statusQ.isLoading) return <LoadingState label="Probing Docker…" />;
  if (statusQ.isError) return <ErrorState error={statusQ.error} onRetry={() => statusQ.refetch()} />;

  if (!reachable) {
    const status = statusQ.data;
    return (
      <EmptyState
        icon={Boxes}
        title={status?.dockerInstalled ? 'Docker not reachable' : 'Docker not available'}
        message={
          <span>
            {status?.reason ?? 'Docker is not available in this guest.'}
            {status?.transport === 'agent' && !status?.dockerInstalled && (
              <span className="mt-2 block text-xs">
                For VMs, install and start <code className="font-mono">qemu-guest-agent</code> inside the guest,
                then install Docker.
              </span>
            )}
          </span>
        }
      />
    );
  }

  const columns: Column<DockerContainer>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          <ContainerIcon className="h-4 w-4 text-slate-400" />
          {c.name || c.id.slice(0, 12)}
        </span>
      ),
    },
    { key: 'image', header: 'Image', render: (c) => <span className="font-mono text-xs">{c.image}</span> },
    { key: 'state', header: 'State', render: (c) => <StateBadge state={c.state} /> },
    {
      key: 'ports',
      header: 'Ports',
      render: (c) =>
        c.ports.length ? (
          <div className="flex flex-col gap-0.5">
            {c.ports.map((p, i) => (
              <span key={i} className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {p.hostPort ? `${p.hostPort}:` : ''}
                {p.containerPort}/{p.proto}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: 'created',
      header: 'Created',
      render: (c) => <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(c.createdSec * 1000)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconAction title="Logs" icon={FileText} onClick={() => setLogsFor(c)} />
          {c.state === 'running' ? (
            <>
              <IconAction
                title="Restart"
                icon={RotateCcw}
                disabled={actionMut.isPending}
                onClick={() => runAction(c, 'restart')}
              />
              <IconAction
                title="Stop"
                icon={Square}
                danger
                disabled={actionMut.isPending}
                onClick={() => runAction(c, 'stop')}
              />
            </>
          ) : (
            <IconAction
              title="Start"
              icon={Play}
              disabled={actionMut.isPending}
              onClick={() => runAction(c, 'start')}
            />
          )}
          <IconAction
            title="Remove"
            icon={Trash2}
            danger
            disabled={actionMut.isPending}
            onClick={() => runAction(c, 'remove')}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {statusQ.data?.dockerVersion && (
            <>
              Docker {statusQ.data.dockerVersion} · transport {statusQ.data.transport}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => containersQ.refetch()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button className="btn-primary" onClick={() => setRunning(true)}>
            <Plus className="h-4 w-4" /> Run container
          </button>
        </div>
      </div>

      {containersQ.isLoading ? (
        <LoadingState label="Loading containers…" />
      ) : containersQ.isError ? (
        <ErrorState error={containersQ.error} onRetry={() => containersQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={containersQ.data ?? []}
          rowKey={(c) => c.id}
          onRowClick={(c) => setDetailFor(c)}
          emptyMessage="No containers in this guest yet."
        />
      )}

      {running && <RunContainerModal guest={guest} onClose={() => setRunning(false)} />}

      {logsFor && <LogsModal guest={guest} container={logsFor} onClose={() => setLogsFor(null)} />}

      {detailFor && <DetailModal guest={guest} container={detailFor} onClose={() => setDetailFor(null)} />}

      <ConfirmDialog
        open={!!pending}
        title={pending ? `${title(pending.action)} container` : ''}
        message={
          pending ? (
            <>
              {title(pending.action)} <strong>{pending.c.name || pending.c.id.slice(0, 12)}</strong>?
            </>
          ) : (
            ''
          )
        }
        confirmLabel={pending ? title(pending.action) : 'Confirm'}
        busy={actionMut.isPending}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          await actionMut.mutateAsync(pending);
          setPending(null);
        }}
      />
    </div>
  );
}

function title(a: ContainerAction): string {
  return a.charAt(0).toUpperCase() + a.slice(1);
}

const STATE_TONES: Record<DockerContainer['state'], BadgeTone> = {
  running: 'success',
  exited: 'neutral',
  created: 'info',
  paused: 'warning',
  restarting: 'warning',
  dead: 'danger',
};

function StateBadge({ state }: { state: DockerContainer['state'] }) {
  return <Badge tone={STATE_TONES[state]}>{state}</Badge>;
}

function IconAction({
  title: label,
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
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx('btn-ghost h-8 w-8 p-0', danger && 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10')}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function LogsModal({
  guest,
  container,
  onClose,
}: {
  guest: Guest;
  container: DockerContainer;
  onClose: () => void;
}) {
  const logsQ = useQuery({
    queryKey: ['docker', 'logs', guest.type, guest.vmid, container.id],
    queryFn: () =>
      api.get<{ logs: string }>(`/docker/${guest.type}/${guest.vmid}/containers/${container.id}/logs?tail=500`),
  });

  return (
    <Modal open onClose={onClose} size="lg" title={`Logs · ${container.name || container.id.slice(0, 12)}`}>
      {logsQ.isLoading ? (
        <LoadingState label="Loading logs…" />
      ) : logsQ.isError ? (
        <ErrorState error={logsQ.error} onRetry={() => logsQ.refetch()} />
      ) : (
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">
          {logsQ.data?.logs?.trim() ? logsQ.data.logs : 'No log output.'}
        </pre>
      )}
    </Modal>
  );
}

function DetailModal({
  guest,
  container,
  onClose,
}: {
  guest: Guest;
  container: DockerContainer;
  onClose: () => void;
}) {
  const detailQ = useQuery({
    queryKey: ['docker', 'inspect', guest.type, guest.vmid, container.id],
    queryFn: () => api.get<unknown>(`/docker/${guest.type}/${guest.vmid}/containers/${container.id}`),
  });

  return (
    <Modal open onClose={onClose} size="lg" title={`Inspect · ${container.name || container.id.slice(0, 12)}`}>
      {detailQ.isLoading ? (
        <LoadingState label="Inspecting…" />
      ) : detailQ.isError ? (
        <ErrorState error={detailQ.error} onRetry={() => detailQ.refetch()} />
      ) : (
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">
          {JSON.stringify(detailQ.data, null, 2)}
        </pre>
      )}
    </Modal>
  );
}
