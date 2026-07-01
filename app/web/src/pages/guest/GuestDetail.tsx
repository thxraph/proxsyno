import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Camera,
  Container,
  Cpu,
  Gauge,
  HardDrive,
  ListChecks,
  MemoryStick,
  MonitorPlay,
  Play,
  Power,
  RotateCcw,
  Sliders,
  Square,
  TerminalSquare,
} from 'lucide-react';
import { pve } from '../../api/client';
import type { Guest, GuestAction, PveStatusCurrent } from '../../lib/types';
import { Badge } from '../../components/Badge';
import { ProgressBar } from '../../components/ProgressBar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../../components/states';
import { capitalize, cx, formatBytes, formatUptime } from '../../lib/format';
import { guestBase, guestKey } from './util';
import { HardwareTab, OptionsTab } from './GuestConfigTabs';
import { GuestSnapshotsTab } from './GuestSnapshotsTab';
import { GuestBackupTab } from './GuestBackupTab';
import { GuestTasksTab } from './GuestTasksTab';
import { GuestConsole } from './GuestConsole';

export type TabId = 'summary' | 'hardware' | 'options' | 'snapshots' | 'backup' | 'tasks' | 'console';

const CONFIRM_ACTIONS: GuestAction[] = ['stop', 'reboot', 'shutdown'];

export function GuestDetail({ guest, initialTab = 'summary' }: { guest: Guest; initialTab?: TabId }) {
  const isQemu = guest.type === 'qemu';
  const [tab, setTab] = useState<TabId>(initialTab);

  const tabs: { id: TabId; label: string; icon: typeof Gauge }[] = [
    { id: 'summary', label: 'Summary', icon: Gauge },
    { id: 'hardware', label: isQemu ? 'Hardware' : 'Resources', icon: isQemu ? Cpu : Container },
    { id: 'options', label: 'Options', icon: Sliders },
    { id: 'snapshots', label: 'Snapshots', icon: Camera },
    { id: 'backup', label: 'Backup', icon: Archive },
    { id: 'tasks', label: 'Task Log', icon: ListChecks },
    { id: 'console', label: 'Console', icon: TerminalSquare },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <TabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} icon={t.icon} label={t.label} />
        ))}
      </div>

      {tab === 'summary' && <SummaryTab guest={guest} />}
      {tab === 'hardware' && <HardwareTab guest={guest} />}
      {tab === 'options' && <OptionsTab guest={guest} />}
      {tab === 'snapshots' && <GuestSnapshotsTab guest={guest} />}
      {tab === 'backup' && <GuestBackupTab guest={guest} />}
      {tab === 'tasks' && <GuestTasksTab guest={guest} />}
      {tab === 'console' && <GuestConsole guest={guest} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Gauge;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-accent-500 text-accent-600 dark:text-accent-400'
          : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

/* -------------------------------- summary -------------------------------- */

function SummaryTab({ guest }: { guest: Guest }) {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: guestKey(guest, 'status'),
    queryFn: () => pve.get<PveStatusCurrent>(`${guestBase(guest)}/status/current`),
    refetchInterval: 5000,
  });

  const [pending, setPending] = useState<GuestAction | null>(null);

  const actionMut = useMutation({
    mutationFn: (action: GuestAction) => pve.post(`${guestBase(guest)}/status/${action}`),
    onSettled: () => qc.invalidateQueries({ queryKey: guestKey(guest, 'status') }),
  });

  const runAction = (action: GuestAction) => {
    if (CONFIRM_ACTIONS.includes(action)) setPending(action);
    else actionMut.mutate(action);
  };

  if (statusQ.isLoading) return <LoadingState label="Loading status…" />;
  if (statusQ.isError) return <ErrorState error={statusQ.error} onRetry={() => statusQ.refetch()} />;

  const st = statusQ.data ?? {};
  const status = (st.status as string) ?? guest.status;
  const running = status === 'running';
  const cpuPct = (st.cpu ?? guest.cpu ?? 0) * 100;
  const mem = st.mem ?? guest.mem;
  const maxmem = st.maxmem ?? guest.maxmem;
  const disk = st.disk ?? guest.disk;
  const maxdisk = st.maxdisk ?? guest.maxdisk;
  const uptime = st.uptime ?? guest.uptimeSec;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          {guest.type === 'qemu' ? (
            <MonitorPlay className="h-5 w-5 text-slate-400" aria-hidden />
          ) : (
            <Container className="h-5 w-5 text-slate-400" aria-hidden />
          )}
          <div>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {guest.name || `guest-${guest.vmid}`}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {guest.type === 'qemu' ? 'VM' : 'LXC'} {guest.vmid} · node {guest.node} · uptime{' '}
              {running ? formatUptime(uptime) : '—'}
            </p>
          </div>
          <StatusBadge status={status} />
        </div>
        <div className="flex gap-2">
          {running ? (
            <>
              <button className="btn-secondary" disabled={actionMut.isPending} onClick={() => runAction('reboot')}>
                <RotateCcw className="h-4 w-4" /> Reboot
              </button>
              <button className="btn-secondary" disabled={actionMut.isPending} onClick={() => runAction('shutdown')}>
                <Power className="h-4 w-4" /> Shutdown
              </button>
              <button className="btn-danger" disabled={actionMut.isPending} onClick={() => runAction('stop')}>
                <Square className="h-4 w-4" /> Stop
              </button>
            </>
          ) : (
            <button className="btn-primary" disabled={actionMut.isPending} onClick={() => runAction('start')}>
              <Play className="h-4 w-4" /> Start
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard icon={Cpu} label="CPU" detail={`${cpuPct.toFixed(1)}%`}>
          <ProgressBar value={cpuPct} autoTone />
        </MetricCard>
        <MetricCard
          icon={MemoryStick}
          label="Memory"
          detail={`${formatBytes(mem)} / ${formatBytes(maxmem)}`}
        >
          <ProgressBar value={maxmem ? (mem / maxmem) * 100 : 0} autoTone />
        </MetricCard>
        <MetricCard
          icon={HardDrive}
          label="Disk"
          detail={`${formatBytes(disk)} / ${formatBytes(maxdisk)}`}
        >
          <ProgressBar value={maxdisk ? (disk / maxdisk) * 100 : 0} autoTone />
        </MetricCard>
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending ? `${capitalize(pending)} guest` : ''}
        message={
          pending ? (
            <>
              {capitalize(pending)} <strong>{guest.name}</strong> ({guest.type === 'qemu' ? 'VM' : 'LXC'}{' '}
              {guest.vmid})?
            </>
          ) : (
            ''
          )
        }
        confirmLabel={pending ? capitalize(pending) : 'Confirm'}
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

function MetricCard({
  icon: Icon,
  label,
  detail,
  children,
}: {
  icon: typeof Cpu;
  label: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
        </span>
        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{detail}</span>
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'running'
      ? 'success'
      : status === 'paused'
        ? 'warning'
        : status === 'stopped'
          ? 'neutral'
          : 'danger';
  return <Badge tone={tone}>{status}</Badge>;
}
