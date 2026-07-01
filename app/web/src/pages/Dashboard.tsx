import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWindows } from '../components/desktop/windowManager';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  Network,
} from 'lucide-react';
import { api } from '../api/client';
import type { SmartTestStatus, System, ZfsPool } from '../lib/types';
import { useSystemWs } from '../hooks/useSystemWs';
import {
  cx,
  formatBitrate,
  formatBytes,
  formatBytesFromKb,
  formatUptime,
} from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/Badge';
import { ProgressBar } from '../components/ProgressBar';
import { ErrorState, LoadingState } from '../components/states';

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) {
    return <div className={cx('h-10', className)} />;
  }
  const max = Math.max(...values, 1);
  const w = 100;
  const h = 32;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(h - (v / max) * h).toFixed(2)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cx('h-10 w-full', className)}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Dashboard() {
  const { open } = useWindows();
  const { sample, history, status } = useSystemWs();

  const systemQ = useQuery({
    queryKey: ['system'],
    queryFn: () => api.get<System>('/system'),
    staleTime: 60_000,
  });

  const zfsQ = useQuery({
    queryKey: ['storage', 'zfs'],
    queryFn: () => api.get<ZfsPool[]>('/storage/zfs'),
  });

  const selfTestQ = useQuery({
    queryKey: ['storage', 'selftest'],
    queryFn: () => api.get<SmartTestStatus[]>('/storage/selftest'),
  });

  const failedSelfTests = (selfTestQ.data ?? []).filter(
    (d) => d.lastResult && !d.lastResult.passed,
  );

  const system = systemQ.data;

  // Prefer live mem from the websocket, fall back to /api/system.
  const memUsedKb = sample?.mem.usedKb ?? system?.mem.usedKb ?? 0;
  const memTotalKb = sample?.mem.totalKb ?? system?.mem.totalKb ?? 0;
  const memPct = memTotalKb > 0 ? (memUsedKb / memTotalKb) * 100 : 0;

  const cpuPct = sample?.cpuPct ?? 0;
  const cpuHistory = useMemo(() => history.map((h) => h.cpuPct), [history]);

  // Sum net across interfaces for the headline rate.
  const totalRx = sample ? sample.net.reduce((a, n) => a + n.rxBps, 0) : 0;
  const totalTx = sample ? sample.net.reduce((a, n) => a + n.txBps, 0) : 0;

  const loadAvg = sample?.load ?? system?.cpu.loadAvg ?? [];

  if (systemQ.isLoading) return <LoadingState label="Loading system info…" />;
  if (systemQ.isError) return <ErrorState error={systemQ.error} onRetry={() => systemQ.refetch()} />;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live system overview"
        actions={
          <Badge tone={status === 'open' ? 'success' : status === 'connecting' ? 'warning' : 'danger'}>
            <Activity className="h-3 w-3" />
            {status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}
          </Badge>
        }
      />

      {/* Host summary */}
      <div className="card mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-accent-50 p-3 text-accent-600 dark:bg-accent-500/10 dark:text-accent-400">
            <HardDrive className="h-6 w-6" />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {system?.hostname}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {system?.os} · {system?.kernel}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {system?.isProxmox ? (
            <Badge tone="accent">Proxmox{system.pveVersion ? ` ${system.pveVersion}` : ''}</Badge>
          ) : (
            <Badge tone="neutral">Standalone Linux</Badge>
          )}
          <Badge tone="info">
            <Clock className="h-3 w-3" /> Up {formatUptime(system?.uptimeSec)}
          </Badge>
        </div>
      </div>

      {/* Live stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="CPU"
          icon={Cpu}
          value={`${cpuPct.toFixed(0)}%`}
          subtitle={system?.cpu.model}
          footer={
            <div className="text-accent-500">
              <Sparkline values={cpuHistory} />
            </div>
          }
        />

        <StatCard
          title="Memory"
          icon={MemoryStick}
          value={`${memPct.toFixed(0)}%`}
          subtitle={`${formatBytesFromKb(memUsedKb)} / ${formatBytesFromKb(memTotalKb)}`}
          footer={<ProgressBar value={memPct} autoTone />}
        />

        <StatCard
          title="Network"
          icon={Network}
          value={
            <span className="flex items-center gap-3 text-base">
              <span className="flex items-center gap-1 text-emerald-500">
                <ArrowDownToLine className="h-4 w-4" /> {formatBitrate(totalRx)}
              </span>
              <span className="flex items-center gap-1 text-sky-500">
                <ArrowUpFromLine className="h-4 w-4" /> {formatBitrate(totalTx)}
              </span>
            </span>
          }
          subtitle={
            sample?.net.length
              ? `${sample.net.length} interface${sample.net.length === 1 ? '' : 's'}`
              : 'Awaiting data…'
          }
        />

        <StatCard
          title="Load average"
          icon={Activity}
          value={
            <span className="tabular-nums">
              {loadAvg.length === 3
                ? loadAvg.map((n) => n.toFixed(2)).join('  ')
                : '—'}
            </span>
          }
          subtitle={`${system?.cpu.cores ?? '—'} cores · 1m / 5m / 15m`}
        />
      </div>

      {/* SMART self-test failures */}
      {failedSelfTests.length > 0 && (
        <div className="card mt-6 flex items-center gap-3 border-l-2 border-rose-500 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" aria-hidden />
          <span className="text-slate-700 dark:text-slate-200">
            SMART self-test failed:{' '}
            <span className="font-medium text-rose-500">
              {failedSelfTests.map((d) => d.disk).join(', ')}
            </span>
          </span>
        </div>
      )}

      {/* Storage usage summary */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-50">
              <Database className="h-4 w-4 text-slate-400" /> ZFS pools
            </h2>
            <button
              type="button"
              onClick={() => open('storage', { title: 'Storage', w: 960, h: 660 })}
              className="text-sm font-medium text-accent-400 hover:underline"
            >
              View storage
            </button>
          </div>

          {zfsQ.isLoading ? (
            <LoadingState label="Loading pools…" />
          ) : zfsQ.isError ? (
            <ErrorState error={zfsQ.error} onRetry={() => zfsQ.refetch()} />
          ) : zfsQ.data && zfsQ.data.length > 0 ? (
            <div className="space-y-4">
              {zfsQ.data.map((p) => (
                <div key={p.pool}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{p.pool}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {formatBytes(p.allocBytes)} / {formatBytes(p.sizeBytes)} · {p.capPct}%
                    </span>
                  </div>
                  <ProgressBar value={p.capPct} autoTone />
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No ZFS pools detected.
            </p>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-50">Quick links</h2>
          <div className="space-y-2">
            <QuickLink appKey="storage" title="Storage" w={960} h={660} icon={HardDrive} label="Disks & SMART" />
            <QuickLink appKey="shares" title="Shares" w={900} h={600} icon={Network} label="SMB & NFS shares" />
            <QuickLink appKey="users" title="Users" w={880} h={600} icon={Cpu} label="Users & groups" />
            <QuickLink appKey="files" title="Files" w={1000} h={680} icon={Database} label="File browser" />
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickLink({
  appKey,
  title,
  w,
  h,
  icon: Icon,
  label,
}: {
  appKey: string;
  title: string;
  w: number;
  h: number;
  icon: typeof HardDrive;
  label: string;
}) {
  const { open } = useWindows();
  return (
    <button
      type="button"
      onClick={() => open(appKey, { title, w, h })}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-accent-500/10 hover:text-accent-300"
    >
      <Icon className="h-4 w-4 text-zinc-400" />
      {label}
    </button>
  );
}
