import { useQuery } from '@tanstack/react-query';
import { Activity, Cpu, Gauge, HardDrive, MemoryStick, Server, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { pve } from '../../api/client';
import { formatBytes, formatUptime } from '../../lib/format';
import { ProgressBar } from '../../components/ProgressBar';
import { ErrorState, LoadingState } from '../../components/states';
import { num, str, type PveObj } from './util';

export function SummaryTab({ node }: { node: string }) {
  const q = useQuery({
    queryKey: ['node', 'status', node],
    queryFn: () => pve.get<PveObj>(`/pve/nodes/${node}/status`),
  });

  if (q.isLoading) return <LoadingState label="Reading node status…" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const s = q.data ?? {};
  const cpuFrac = num(s, 'cpu') ?? 0;
  const cpuInfo = (s.cpuinfo as PveObj | undefined) ?? undefined;
  const cpus = num(cpuInfo, 'cpus');
  const cpuModel = str(cpuInfo, 'model');
  const mem = (s.memory as PveObj | undefined) ?? undefined;
  const memUsed = num(mem, 'used') ?? 0;
  const memTotal = num(mem, 'total') ?? 0;
  const swap = (s.swap as PveObj | undefined) ?? undefined;
  const swapUsed = num(swap, 'used') ?? 0;
  const swapTotal = num(swap, 'total') ?? 0;
  const rootfs = (s.rootfs as PveObj | undefined) ?? undefined;
  const rootUsed = num(rootfs, 'used') ?? 0;
  const rootTotal = num(rootfs, 'total') ?? 0;
  const load = Array.isArray(s.loadavg) ? (s.loadavg as unknown[]).map((x) => String(x)).join('  ') : '—';

  return (
    <div className="flex flex-col gap-px">
      <div className="grid grid-cols-1 gap-px sm:grid-cols-2">
        <MetricCard icon={Cpu} label="CPU usage" value={`${(cpuFrac * 100).toFixed(1)}%`} sub={cpuModel || undefined}>
          <ProgressBar value={cpuFrac * 100} autoTone showLabel />
          {cpus !== undefined && <p className="mt-1 text-xs text-zinc-500">{cpus} CPU(s)</p>}
        </MetricCard>

        <MetricCard
          icon={MemoryStick}
          label="Memory"
          value={`${formatBytes(memUsed)} / ${formatBytes(memTotal)}`}
        >
          <ProgressBar value={memTotal ? (memUsed / memTotal) * 100 : 0} autoTone showLabel />
        </MetricCard>

        <MetricCard
          icon={HardDrive}
          label="Root filesystem"
          value={`${formatBytes(rootUsed)} / ${formatBytes(rootTotal)}`}
        >
          <ProgressBar value={rootTotal ? (rootUsed / rootTotal) * 100 : 0} autoTone showLabel />
        </MetricCard>

        <MetricCard
          icon={Gauge}
          label="Swap"
          value={swapTotal ? `${formatBytes(swapUsed)} / ${formatBytes(swapTotal)}` : 'Not configured'}
        >
          {swapTotal ? (
            <ProgressBar value={(swapUsed / swapTotal) * 100} autoTone showLabel />
          ) : (
            <p className="text-xs text-zinc-500">No swap space.</p>
          )}
        </MetricCard>
      </div>

      <div className="grid grid-cols-1 gap-px sm:grid-cols-3">
        <InfoCard icon={Timer} label="Uptime" value={formatUptime(num(s, 'uptime'))} />
        <InfoCard icon={Activity} label="Load average" value={load} mono />
        <InfoCard icon={Server} label="Kernel" value={str(s, 'kversion') || '—'} mono />
      </div>

      <div className="grid grid-cols-1 gap-px sm:grid-cols-2">
        <InfoCard icon={Server} label="PVE version" value={str(s, 'pveversion') || '—'} mono />
        <InfoCard icon={Activity} label="IO delay" value={`${((num(s, 'wait') ?? 0) * 100).toFixed(1)}%`} />
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  children,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <Icon className="h-4 w-4" aria-hidden /> {label}
      </div>
      <p className="mb-2 text-lg font-semibold tabular-nums text-zinc-100">{value}</p>
      {children}
      {sub && <p className="mt-1 truncate text-xs text-zinc-500" title={sub}>{sub}</p>}
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <Icon className="h-4 w-4" aria-hidden /> {label}
      </div>
      <p className={mono ? 'break-all font-mono text-sm text-zinc-200' : 'text-sm text-zinc-200'}>
        {value}
      </p>
    </div>
  );
}
