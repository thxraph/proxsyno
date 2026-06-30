import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, HardDrive, Layers, ShieldCheck } from 'lucide-react';
import { pve } from '../../api/client';
import { formatBytes } from '../../lib/format';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ErrorState, LoadingState } from '../../components/states';
import { asArray, bool, num, str, type PveObj } from './util';

function healthTone(h: string): 'success' | 'danger' | 'neutral' {
  if (!h || h === 'UNKNOWN') return 'neutral';
  return /pass|ok/i.test(h) ? 'success' : 'danger';
}

export function DisksTab({ node }: { node: string }) {
  const [smartDisk, setSmartDisk] = useState<string | null>(null);

  const disksQ = useQuery({
    queryKey: ['node', 'disks', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/disks/list`),
  });
  const lvmQ = useQuery({
    queryKey: ['node', 'disks-lvm', node],
    queryFn: () => pve.get<PveObj>(`/pve/nodes/${node}/disks/lvm`),
  });
  const lvmthinQ = useQuery({
    queryKey: ['node', 'disks-lvmthin', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/disks/lvmthin`),
  });
  const zfsQ = useQuery({
    queryKey: ['node', 'disks-zfs', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/disks/zfs`),
  });
  const dirQ = useQuery({
    queryKey: ['node', 'disks-dir', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/disks/directory`),
  });

  const diskColumns: Column<PveObj>[] = [
    {
      key: 'dev',
      header: 'Device',
      render: (d) => (
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-200">
          <HardDrive className="h-3.5 w-3.5 text-zinc-500" aria-hidden /> {str(d, 'devpath')}
        </span>
      ),
    },
    { key: 'type', header: 'Type', render: (d) => <Badge tone="neutral">{str(d, 'type') || '—'}</Badge> },
    { key: 'model', header: 'Model', render: (d) => <span className="text-xs text-zinc-300">{str(d, 'model') || '—'}</span> },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      render: (d) => <span className="tabular-nums text-xs">{formatBytes(num(d, 'size'))}</span>,
    },
    { key: 'serial', header: 'Serial', render: (d) => <span className="font-mono text-xs text-zinc-500">{str(d, 'serial') || '—'}</span> },
    {
      key: 'health',
      header: 'Health',
      render: (d) => {
        const h = str(d, 'health');
        return <Badge tone={healthTone(h)}>{h || 'N/A'}</Badge>;
      },
    },
    {
      key: 'smart',
      header: '',
      align: 'right',
      render: (d) => (
        <button
          type="button"
          className="btn-ghost h-8 px-2 text-xs"
          onClick={() => setSmartDisk(str(d, 'devpath'))}
          disabled={!str(d, 'devpath')}
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> SMART
        </button>
      ),
    },
  ];

  // lvm endpoint returns a volume-group tree: { children: [{ name, size, free, ... }] }.
  const vgs = asArray(lvmQ.data?.children);

  return (
    <div className="flex flex-col gap-px">
      <Section title="Physical disks" icon={HardDrive}>
        {disksQ.isLoading ? (
          <LoadingState label="Reading disks…" />
        ) : disksQ.isError ? (
          <ErrorState error={disksQ.error} onRetry={() => disksQ.refetch()} />
        ) : (
          <DataTable columns={diskColumns} rows={disksQ.data ?? []} rowKey={(d) => str(d, 'devpath')} emptyMessage="No disks detected." />
        )}
      </Section>

      <Section title="LVM volume groups" icon={Layers}>
        {lvmQ.isLoading ? (
          <LoadingState label="Reading LVM…" />
        ) : lvmQ.isError ? (
          <ErrorState error={lvmQ.error} onRetry={() => lvmQ.refetch()} />
        ) : (
          <DataTable
            columns={[
              { key: 'name', header: 'VG', render: (g) => <span className="font-mono text-xs text-zinc-200">{str(g, 'name')}</span> },
              { key: 'size', header: 'Size', align: 'right', render: (g) => <span className="tabular-nums text-xs">{formatBytes(num(g, 'size'))}</span> },
              { key: 'free', header: 'Free', align: 'right', render: (g) => <span className="tabular-nums text-xs">{formatBytes(num(g, 'free'))}</span> },
            ]}
            rows={vgs}
            rowKey={(g) => str(g, 'name')}
            emptyMessage="No LVM volume groups."
          />
        )}
      </Section>

      <Section title="LVM-thin pools" icon={Layers}>
        {lvmthinQ.isLoading ? (
          <LoadingState label="Reading LVM-thin…" />
        ) : lvmthinQ.isError ? (
          <ErrorState error={lvmthinQ.error} onRetry={() => lvmthinQ.refetch()} />
        ) : (
          <DataTable
            columns={[
              { key: 'lv', header: 'Pool', render: (p) => <span className="font-mono text-xs text-zinc-200">{str(p, 'lv')}</span> },
              { key: 'vg', header: 'VG', render: (p) => <span className="font-mono text-xs text-zinc-400">{str(p, 'vg')}</span> },
              { key: 'size', header: 'Size', align: 'right', render: (p) => <span className="tabular-nums text-xs">{formatBytes(num(p, 'lv_size'))}</span> },
              { key: 'used', header: 'Used', align: 'right', render: (p) => <span className="tabular-nums text-xs">{formatBytes(num(p, 'used'))}</span> },
            ]}
            rows={lvmthinQ.data ?? []}
            rowKey={(p) => `${str(p, 'vg')}/${str(p, 'lv')}`}
            emptyMessage="No LVM-thin pools."
          />
        )}
      </Section>

      <Section title="ZFS pools" icon={Database}>
        {zfsQ.isLoading ? (
          <LoadingState label="Reading ZFS…" />
        ) : zfsQ.isError ? (
          <ErrorState error={zfsQ.error} onRetry={() => zfsQ.refetch()} />
        ) : (
          <DataTable
            columns={[
              { key: 'name', header: 'Pool', render: (p) => <span className="font-mono text-xs text-zinc-200">{str(p, 'name')}</span> },
              {
                key: 'health',
                header: 'Health',
                render: (p) => {
                  const h = str(p, 'health');
                  return <Badge tone={/online/i.test(h) ? 'success' : 'danger'}>{h || '—'}</Badge>;
                },
              },
              { key: 'size', header: 'Size', align: 'right', render: (p) => <span className="tabular-nums text-xs">{formatBytes(num(p, 'size'))}</span> },
              { key: 'alloc', header: 'Allocated', align: 'right', render: (p) => <span className="tabular-nums text-xs">{formatBytes(num(p, 'alloc'))}</span> },
              { key: 'free', header: 'Free', align: 'right', render: (p) => <span className="tabular-nums text-xs">{formatBytes(num(p, 'free'))}</span> },
            ]}
            rows={zfsQ.data ?? []}
            rowKey={(p) => str(p, 'name')}
            emptyMessage="No ZFS pools."
          />
        )}
      </Section>

      <Section title="Directory storage" icon={Database}>
        {dirQ.isLoading ? (
          <LoadingState label="Reading directories…" />
        ) : dirQ.isError ? (
          <ErrorState error={dirQ.error} onRetry={() => dirQ.refetch()} />
        ) : (
          <DataTable
            columns={[
              { key: 'path', header: 'Path', render: (d) => <span className="font-mono text-xs text-zinc-200">{str(d, 'path')}</span> },
              { key: 'device', header: 'Device', render: (d) => <span className="font-mono text-xs text-zinc-400">{str(d, 'device')}</span> },
              { key: 'type', header: 'FS', render: (d) => <span className="text-xs text-zinc-300">{str(d, 'type')}</span> },
            ]}
            rows={dirQ.data ?? []}
            rowKey={(d) => str(d, 'path')}
            emptyMessage="No directory storage."
          />
        )}
      </Section>

      {smartDisk && <SmartModal node={node} disk={smartDisk} onClose={() => setSmartDisk(null)} />}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof HardDrive; children: ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Icon className="h-4 w-4 text-zinc-400" aria-hidden /> {title}
      </h3>
      {children}
    </div>
  );
}

function SmartModal({ node, disk, onClose }: { node: string; disk: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['node', 'smart', node, disk],
    queryFn: () => pve.get<PveObj>(`/pve/nodes/${node}/disks/smart?disk=${encodeURIComponent(disk)}`),
    retry: false,
  });

  const health = str(q.data, 'health');
  // SMART comes back either as { attributes: [...] } or as { type: 'text', text }.
  const attributes = asArray(q.data?.attributes);
  const text = str(q.data, 'text');

  return (
    <Modal open onClose={onClose} size="lg" title={`SMART · ${disk}`}>
      {q.isLoading ? (
        <LoadingState label="Reading SMART data…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Health</span>
            <Badge tone={healthTone(health)}>{health || 'N/A'}</Badge>
          </div>

          {attributes.length > 0 ? (
            <div className="max-h-[55vh] overflow-auto rounded-lg bg-zinc-950 p-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-zinc-500">
                    <th className="px-2 py-1 font-medium">ID</th>
                    <th className="px-2 py-1 font-medium">Attribute</th>
                    <th className="px-2 py-1 text-right font-medium">Value</th>
                    <th className="px-2 py-1 text-right font-medium">Worst</th>
                    <th className="px-2 py-1 text-right font-medium">Threshold</th>
                    <th className="px-2 py-1 text-right font-medium">Raw</th>
                  </tr>
                </thead>
                <tbody>
                  {attributes.map((a, i) => (
                    <tr key={`${str(a, 'id')}-${i}`} className="border-t border-zinc-800/70">
                      <td className="px-2 py-1 tabular-nums text-zinc-500">{str(a, 'id')}</td>
                      <td className="px-2 py-1 text-zinc-200">{str(a, 'name')}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-zinc-300">{str(a, 'value')}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-zinc-400">{str(a, 'worst')}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-zinc-400">{str(a, 'threshold')}</td>
                      <td className={'px-2 py-1 text-right font-mono ' + (bool(a, 'fail') ? 'text-rose-400' : 'text-zinc-400')}>
                        {str(a, 'raw')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : text ? (
            <pre className="max-h-[55vh] overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-200">{text}</pre>
          ) : (
            <p className="py-4 text-center text-sm text-zinc-500">No SMART attributes reported.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
