import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  CheckCircle2,
  Container,
  Database,
  MonitorPlay,
  Server,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { pve } from '../../api/client';
import { Badge } from '../../components/Badge';
import { ProgressBar } from '../../components/ProgressBar';
import { formatBytes } from '../../lib/format';
import { QueryGate, bool01, num, str, type PveRow } from './util';

export function SummaryTab() {
  const statusQ = useQuery({
    queryKey: ['dc', 'cluster', 'status'],
    queryFn: () => pve.get<PveRow[]>('/pve/cluster/status'),
  });
  const resourcesQ = useQuery({
    queryKey: ['dc', 'cluster', 'resources'],
    queryFn: () => pve.get<PveRow[]>('/pve/cluster/resources'),
  });

  return (
    <div className="space-y-6">
      <QueryGate query={resourcesQ} loading="Loading cluster resources…">
        {(rows) => <ResourceSummary rows={rows} />}
      </QueryGate>

      <QueryGate query={statusQ} loading="Loading cluster status…">
        {(rows) => <NodeStatus rows={rows} />}
      </QueryGate>
    </div>
  );
}

function ResourceSummary({ rows }: { rows: PveRow[] }) {
  const vms = rows.filter((r) => str(r.type) === 'qemu');
  const cts = rows.filter((r) => str(r.type) === 'lxc');
  const storages = rows.filter((r) => str(r.type) === 'storage');
  const nodes = rows.filter((r) => str(r.type) === 'node');

  const runningVms = vms.filter((r) => str(r.status) === 'running').length;
  const runningCts = cts.filter((r) => str(r.status) === 'running').length;

  // Aggregate node-level usage.
  let cpu = 0;
  let maxcpu = 0;
  let mem = 0;
  let maxmem = 0;
  for (const n of nodes) {
    cpu += num(n.cpu) * num(n.maxcpu);
    maxcpu += num(n.maxcpu);
    mem += num(n.mem);
    maxmem += num(n.maxmem);
  }
  const cpuPct = maxcpu ? (cpu / maxcpu) * 100 : 0;
  const memPct = maxmem ? (mem / maxmem) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-zinc-950 sm:grid-cols-4">
        <StatCard icon={Server} label="Nodes" value={nodes.length} />
        <StatCard
          icon={MonitorPlay}
          label="Virtual machines"
          value={vms.length}
          sub={`${runningVms} running`}
        />
        <StatCard
          icon={Container}
          label="Containers"
          value={cts.length}
          sub={`${runningCts} running`}
        />
        <StatCard icon={Database} label="Storages" value={storages.length} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UsageCard label="CPU" value={cpuPct} sub={`${maxcpu} cores total`} />
        <UsageCard
          label="Memory"
          value={memPct}
          sub={`${formatBytes(mem)} / ${formatBytes(maxmem)}`}
        />
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="bg-zinc-900 p-4">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="h-4 w-4 text-accent-500" aria-hidden />
        <span className="text-[10px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">{value}</p>
      {sub && <p className="text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function UsageCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </span>
        <span className="text-xs tabular-nums text-zinc-400">{sub}</span>
      </div>
      <ProgressBar value={value} autoTone showLabel />
    </div>
  );
}

function NodeStatus({ rows }: { rows: PveRow[] }) {
  const cluster = rows.find((r) => str(r.type) === 'cluster');
  const nodes = rows.filter((r) => str(r.type) === 'node');

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <Boxes className="h-4 w-4 text-accent-500" aria-hidden /> Cluster &amp; nodes
        </h2>
        {cluster && (
          <Badge tone={bool01(cluster.quorate) ? 'success' : 'danger'}>
            {bool01(cluster.quorate) ? 'Quorate' : 'No quorum'}
          </Badge>
        )}
      </div>

      <div className="card divide-y divide-zinc-800">
        {nodes.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">No nodes reported.</p>
        )}
        {nodes.map((n) => {
          const online = bool01(n.online);
          return (
            <div key={str(n.id) || str(n.name)} className="flex items-center gap-3 px-4 py-3">
              {online ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
              ) : (
                <XCircle className="h-4 w-4 text-rose-500" aria-hidden />
              )}
              <span className="font-medium text-zinc-100">{str(n.name)}</span>
              {str(n.ip) && <span className="font-mono text-xs text-zinc-500">{str(n.ip)}</span>}
              <span className="ml-auto">
                <Badge tone={online ? 'success' : 'danger'}>
                  {online ? 'online' : 'offline'}
                </Badge>
              </span>
              {bool01(n.local) && <Badge tone="accent">local</Badge>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
