import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  CalendarClock,
  Database,
  HardDrive,
  Layers,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  Thermometer,
} from 'lucide-react';
import { api, errMsg } from '../api/client';
import type {
  Disk,
  RaidArray,
  ScrubFrequency,
  ScrubSchedule,
  ScrubStatus,
  Smart,
  ZfsPool,
} from '../lib/types';
import { formatBytes, formatDate } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { ProgressBar } from '../components/ProgressBar';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormField } from '../components/FormField';
import { SubmitError } from '../components/SubmitError';
import { ErrorState, LoadingState } from '../components/states';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function scheduleSummary(s: ScrubSchedule): string {
  if (s.frequency === 'disabled') return 'Not scheduled';
  const time = `${pad2(s.hour)}:${pad2(s.minute)}`;
  if (s.frequency === 'weekly') return `Weekly · ${WEEKDAYS[s.weekday]} ${time}`;
  return `Monthly · day ${s.day} ${time}`;
}

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

      {/* RAID scrub */}
      <ScrubSection />

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

function ScrubSection() {
  const q = useQuery({
    queryKey: ['storage', 'scrub'],
    queryFn: () => api.get<ScrubStatus[]>('/storage/scrub'),
    refetchInterval: (query) => {
      const running = query.state.data?.some((s) => s.syncAction !== 'idle');
      return running ? 3000 : 30000;
    },
  });

  const arrays = q.data ?? [];

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        RAID scrub
      </h2>
      {q.isLoading ? (
        <LoadingState label="Reading scrub status…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : arrays.length === 0 ? (
        <div className="card p-5 text-sm text-slate-500 dark:text-slate-400">
          No software RAID arrays.
        </div>
      ) : (
        <div className="flex flex-col gap-px">
          {arrays.map((s) => (
            <ScrubCard key={s.array} status={s} />
          ))}
        </div>
      )}
    </section>
  );
}

function ScrubCard({ status }: { status: ScrubStatus }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['storage', 'scrub'] });

  const startMut = useMutation({
    mutationFn: () => api.post(`/storage/scrub/${status.array}/start`),
    onSuccess: invalidate,
  });
  const cancelMut = useMutation({
    mutationFn: () => api.post(`/storage/scrub/${status.array}/cancel`),
    onSuccess: () => {
      invalidate();
      setConfirmCancel(false);
    },
  });

  const idle = status.syncAction === 'idle';
  const running = status.syncAction === 'check' || status.syncAction === 'repair';

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <Layers className="h-4 w-4 text-slate-400" aria-hidden />
            {status.array}
          </div>

          {idle ? (
            <Badge tone="success">Idle</Badge>
          ) : (
            <div className="flex items-center gap-3">
              <Badge tone="warning">{status.syncAction}</Badge>
              <ProgressBar
                value={status.progressPct ?? 0}
                tone="warning"
                showLabel
                className="w-40"
              />
            </div>
          )}

          <div className="text-xs">
            {status.mismatchCnt > 0 ? (
              <span className="text-rose-500 dark:text-rose-400">
                {status.mismatchCnt} mismatches
              </span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400">0 mismatches</span>
            )}
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            {scheduleSummary(status.schedule)}
            {status.lastRunMs != null && <> · Last: {formatDate(status.lastRunMs)}</>}
            {status.nextRunMs != null && <> · Next: {formatDate(status.nextRunMs)}</>}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          {idle ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending}
            >
              <Play className="h-4 w-4" aria-hidden /> Scrub now
            </button>
          ) : running ? (
            <button
              type="button"
              className="btn-danger"
              onClick={() => setConfirmCancel(true)}
              disabled={cancelMut.isPending}
            >
              <Square className="h-4 w-4" aria-hidden /> Cancel
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            <CalendarClock className="h-4 w-4" aria-hidden /> Edit schedule
          </button>
        </div>
      </div>

      {editing && (
        <ScheduleModal
          array={status.array}
          initial={status.schedule}
          onClose={() => setEditing(false)}
        />
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel scrub"
        destructive
        busy={cancelMut.isPending}
        confirmLabel="Cancel scrub"
        cancelLabel="Keep running"
        message={`Abort the in-progress ${status.syncAction} on ${status.array}? Progress will be lost.`}
        onConfirm={() => cancelMut.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

function ScheduleModal({
  array,
  initial,
  onClose,
}: {
  array: string;
  initial: ScrubSchedule;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [frequency, setFrequency] = useState<ScrubFrequency>(initial.frequency);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [day, setDay] = useState(initial.day);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [error, setError] = useState<string | null>(null);

  const minuteOpts = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b);

  const mut = useMutation({
    mutationFn: () =>
      api.put<ScrubStatus>(`/storage/scrub/${array}`, {
        frequency,
        weekday,
        day,
        hour,
        minute,
      } satisfies ScrubSchedule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['storage', 'scrub'] });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      busy={mut.isPending}
      title={
        <span className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4" aria-hidden /> Scrub schedule · {array}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={mut.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={mut.isPending}
          >
            <Save className="h-4 w-4" aria-hidden /> {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && <SubmitError message={error} />}

      <FormField label="Frequency">
        <select
          className="input"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as ScrubFrequency)}
        >
          <option value="disabled">Disabled</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </FormField>

      {frequency === 'weekly' && (
        <FormField label="Weekday">
          <select
            className="input"
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
          >
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {frequency === 'monthly' && (
        <FormField label="Day of month">
          <select className="input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {frequency !== 'disabled' && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Hour">
            <select
              className="input"
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                <option key={h} value={h}>
                  {pad2(h)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Minute">
            <select
              className="input"
              value={minute}
              onChange={(e) => setMinute(Number(e.target.value))}
            >
              {minuteOpts.map((m) => (
                <option key={m} value={m}>
                  {pad2(m)}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      )}
    </Modal>
  );
}
