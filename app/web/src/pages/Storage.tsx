import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Database,
  HardDrive,
  Layers,
  RefreshCw,
  ShieldCheck,
  Thermometer,
} from 'lucide-react';
import { api } from '../api/client';
import type { Disk, RaidArray, Smart, ZfsPool } from '../lib/types';
import { formatBytes } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { ProgressBar } from '../components/ProgressBar';
import { ErrorState, LoadingState } from '../components/states';

// Flatten the disk tree into rows with a depth marker for indentation.
interface FlatDisk extends Disk {
  _depth: number;
  _id: string;
}

function flatten(disks: Disk[], depth = 0, prefix = ''): FlatDisk[] {
  const out: FlatDisk[] = [];
  for (const d of disks) {
    const id = `${prefix}${d.name}`;
    out.push({ ...d, _depth: depth, _id: id });
    if (d.children && d.children.length) {
      out.push(...flatten(d.children, depth + 1, `${id}/`));
    }
  }
  return out;
}

const TYPE_TONE: Record<Disk['type'], Parameters<typeof Badge>[0]['tone']> = {
  disk: 'accent',
  part: 'neutral',
  raid: 'info',
  lvm: 'warning',
  crypt: 'danger',
};

function SmartBadge({ disk }: { disk: string }) {
  const q = useQuery({
    queryKey: ['storage', 'smart', disk],
    queryFn: () => api.get<Smart>(`/storage/smart/${encodeURIComponent(disk)}`),
    retry: false,
    staleTime: 60_000,
  });

  if (q.isLoading) return <span className="text-xs text-slate-400">checking…</span>;
  if (q.isError || !q.data) return <Badge tone="neutral">N/A</Badge>;

  const s = q.data;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={s.healthy ? 'success' : 'danger'}>
        <ShieldCheck className="h-3 w-3" />
        {s.healthy ? 'Healthy' : 'Failing'}
      </Badge>
      {typeof s.temperatureC === 'number' && (
        <span className="inline-flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400">
          <Thermometer className="h-3 w-3" />
          {s.temperatureC}°C
        </span>
      )}
    </span>
  );
}

export function Storage() {
  const disksQ = useQuery({
    queryKey: ['storage', 'disks'],
    queryFn: () => api.get<Disk[]>('/storage/disks'),
  });
  const raidQ = useQuery({
    queryKey: ['storage', 'raid'],
    queryFn: () => api.get<RaidArray[]>('/storage/raid'),
  });
  const zfsQ = useQuery({
    queryKey: ['storage', 'zfs'],
    queryFn: () => api.get<ZfsPool[]>('/storage/zfs'),
  });

  const flatDisks = disksQ.data ? flatten(disksQ.data) : [];

  const diskColumns: Column<FlatDisk>[] = [
    {
      key: 'name',
      header: 'Device',
      render: (d) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          {d._depth === 0 ? (
            <HardDrive className="h-4 w-4 text-slate-400" />
          ) : (
            <Box className="h-3.5 w-3.5 text-slate-400" />
          )}
          {d.name}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (d) => <Badge tone={TYPE_TONE[d.type]}>{d.type}</Badge>,
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      render: (d) => <span className="tabular-nums">{formatBytes(d.sizeBytes)}</span>,
    },
    { key: 'fstype', header: 'Filesystem', render: (d) => d.fstype ?? '—' },
    {
      key: 'mount',
      header: 'Mount point',
      render: (d) => (
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
          {d.mountpoint ?? '—'}
        </span>
      ),
    },
    { key: 'model', header: 'Model', render: (d) => d.model ?? '—' },
    {
      key: 'smart',
      header: 'SMART',
      render: (d) => (d.type === 'disk' ? <SmartBadge disk={d.name} /> : <span>—</span>),
    },
  ];

  const raidColumns: Column<RaidArray>[] = [
    {
      key: 'device',
      header: 'Array',
      render: (r) => (
        <span className="flex items-center gap-2 font-medium">
          <Layers className="h-4 w-4 text-slate-400" />
          {r.device}
        </span>
      ),
    },
    { key: 'level', header: 'Level', render: (r) => <Badge tone="info">{r.level}</Badge> },
    {
      key: 'state',
      header: 'State',
      render: (r) => (
        <Badge tone={/active|clean/i.test(r.state) ? 'success' : 'warning'}>{r.state}</Badge>
      ),
    },
    {
      key: 'members',
      header: 'Members',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums">
          {r.active}/{r.total}
        </span>
      ),
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      render: (r) => <span className="tabular-nums">{formatBytes(r.sizeBytes)}</span>,
    },
    {
      key: 'sync',
      header: 'Sync',
      render: (r) =>
        typeof r.syncPct === 'number' ? (
          <ProgressBar value={r.syncPct} tone="warning" showLabel className="w-40" />
        ) : (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">In sync</span>
        ),
    },
  ];

  const zfsColumns: Column<ZfsPool>[] = [
    {
      key: 'pool',
      header: 'Pool',
      render: (p) => (
        <span className="flex items-center gap-2 font-medium">
          <Database className="h-4 w-4 text-slate-400" />
          {p.pool}
        </span>
      ),
    },
    {
      key: 'health',
      header: 'Health',
      render: (p) => (
        <Badge tone={/online/i.test(p.health) ? 'success' : 'danger'}>{p.health}</Badge>
      ),
    },
    {
      key: 'usage',
      header: 'Usage',
      render: (p) => (
        <div className="w-48">
          <ProgressBar value={p.capPct} autoTone showLabel />
        </div>
      ),
    },
    {
      key: 'alloc',
      header: 'Allocated',
      align: 'right',
      render: (p) => <span className="tabular-nums">{formatBytes(p.allocBytes)}</span>,
    },
    {
      key: 'free',
      header: 'Free',
      align: 'right',
      render: (p) => <span className="tabular-nums">{formatBytes(p.freeBytes)}</span>,
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      render: (p) => <span className="tabular-nums">{formatBytes(p.sizeBytes)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Storage"
        description="Disks, RAID arrays, ZFS pools and SMART health"
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              disksQ.refetch();
              raidQ.refetch();
              zfsQ.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      {/* Disks */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Block devices
        </h2>
        {disksQ.isLoading ? (
          <LoadingState label="Reading block devices…" />
        ) : disksQ.isError ? (
          <ErrorState error={disksQ.error} onRetry={() => disksQ.refetch()} />
        ) : (
          <DataTable
            columns={diskColumns}
            rows={flatDisks}
            rowKey={(d) => d._id}
            rowDepth={(d) => d._depth}
            emptyMessage="No block devices found."
          />
        )}
      </section>

      {/* RAID */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          RAID arrays (mdadm)
        </h2>
        {raidQ.isLoading ? (
          <LoadingState label="Reading mdstat…" />
        ) : raidQ.isError ? (
          <ErrorState error={raidQ.error} onRetry={() => raidQ.refetch()} />
        ) : (
          <DataTable
            columns={raidColumns}
            rows={raidQ.data ?? []}
            rowKey={(r) => r.device}
            emptyMessage="No software RAID arrays configured."
          />
        )}
      </section>

      {/* ZFS */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          ZFS pools
        </h2>
        {zfsQ.isLoading ? (
          <LoadingState label="Reading zpools…" />
        ) : zfsQ.isError ? (
          <ErrorState error={zfsQ.error} onRetry={() => zfsQ.refetch()} />
        ) : (
          <DataTable
            columns={zfsColumns}
            rows={zfsQ.data ?? []}
            rowKey={(p) => p.pool}
            emptyMessage="No ZFS pools detected."
          />
        )}
      </section>
    </div>
  );
}
