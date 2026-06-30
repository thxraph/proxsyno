import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  Banner,
  IconBtn,
  TabHeader,
  Toggle,
  bool01,
  errMsg,
  str,
  type PveRow,
} from './util';

const MODES = ['snapshot', 'suspend', 'stop'];
const COMPRESS = ['0', 'gzip', 'lzo', 'zstd'];
type Selection = 'all' | 'include' | 'exclude';

export function BackupTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dc', 'backup'],
    queryFn: () => pve.get<PveRow[]>('/pve/cluster/backup'),
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PveRow | null>(null);
  const [toDelete, setToDelete] = useState<PveRow | null>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => pve.del(`/pve/cluster/backup/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'backup'] }),
  });

  const columns: Column<PveRow>[] = [
    {
      key: 'schedule',
      header: 'Schedule',
      render: (j) => (
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-100">
          <Clock className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
          {str(j.schedule) || '—'}
        </span>
      ),
    },
    { key: 'storage', header: 'Storage', render: (j) => str(j.storage) },
    {
      key: 'selection',
      header: 'Selection',
      render: (j) => {
        if (bool01(j.all) && str(j.exclude)) return <Badge tone="warning">all except {str(j.exclude)}</Badge>;
        if (bool01(j.all)) return <Badge tone="info">all guests</Badge>;
        if (str(j.vmid)) return <span className="text-xs text-zinc-400">{str(j.vmid)}</span>;
        if (str(j.pool)) return <Badge tone="neutral">pool: {str(j.pool)}</Badge>;
        return <span className="text-xs text-zinc-500">—</span>;
      },
    },
    { key: 'mode', header: 'Mode', render: (j) => <Badge tone="neutral">{str(j.mode) || 'snapshot'}</Badge> },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (j) =>
        bool01(j.enabled) || j.enabled === undefined ? (
          <Badge tone="success">enabled</Badge>
        ) : (
          <Badge tone="neutral">disabled</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (j) => (
        <div className="flex justify-end gap-1">
          <IconBtn title="Edit" icon={Pencil} onClick={() => setEditing(j)} />
          <IconBtn title="Delete" icon={Trash2} danger onClick={() => setToDelete(j)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <TabHeader
        title="Backup jobs"
        icon={Archive}
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add job
          </button>
        }
      />

      {q.isPending ? (
        <DataTable columns={columns} rows={[]} rowKey={() => ''} emptyMessage="Loading…" />
      ) : q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable
          columns={columns}
          rows={q.data ?? []}
          rowKey={(j) => str(j.id)}
          emptyMessage="No backup jobs scheduled."
        />
      )}

      {(creating || editing) && (
        <BackupFormModal
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete backup job"
        message={
          <>
            Delete the backup job scheduled <strong>{str(toDelete?.schedule)}</strong>?
          </>
        }
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await delMut.mutateAsync(str(toDelete.id));
          setToDelete(null);
        }}
      />
    </div>
  );
}

function initialSelection(row: PveRow | null): Selection {
  if (!row) return 'all';
  if (bool01(row.all) && str(row.exclude)) return 'exclude';
  if (str(row.vmid)) return 'include';
  return 'all';
}

function BackupFormModal({ existing, onClose }: { existing: PveRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!existing;

  const storagesQ = useQuery({
    queryKey: ['dc', 'storage'],
    queryFn: () => pve.get<PveRow[]>('/pve/storage'),
  });
  const backupStores = (storagesQ.data ?? []).filter((s) => str(s.content).includes('backup'));

  const [schedule, setSchedule] = useState(str(existing?.schedule) || 'mon..fri 02:00');
  const [storage, setStorage] = useState(str(existing?.storage));
  const [selection, setSelection] = useState<Selection>(initialSelection(existing));
  const [vmids, setVmids] = useState(str(existing?.vmid) || str(existing?.exclude));
  const [mode, setMode] = useState(str(existing?.mode) || 'snapshot');
  const [compress, setCompress] = useState(str(existing?.compress) || 'zstd');
  const [enabled, setEnabled] = useState(
    existing ? bool01(existing.enabled) || existing.enabled === undefined : true,
  );
  const [error, setError] = useState<string | null>(null);

  const effectiveStorage = storage || str(backupStores[0]?.storage);

  const mut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? pve.put(`/pve/cluster/backup/${encodeURIComponent(str(existing!.id))}`, payload)
        : pve.post('/pve/cluster/backup', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dc', 'backup'] });
      onClose();
    },
    onError: (e) => setError(errMsg(e, 'Failed to save backup job')),
  });

  const onSubmit = () => {
    setError(null);
    if (!schedule.trim()) return setError('A schedule is required.');
    if (!effectiveStorage) return setError('A backup-capable storage is required.');
    if (selection !== 'all' && !vmids.trim()) return setError('Enter at least one VMID.');

    const payload: Record<string, unknown> = {
      schedule: schedule.trim(),
      storage: effectiveStorage,
      mode,
      compress,
      enabled: enabled ? 1 : 0,
    };

    // Selection: mutually exclusive params; clear the unused ones on edit.
    const selKeys = ['all', 'vmid', 'exclude'];
    if (selection === 'all') payload.all = 1;
    else if (selection === 'include') payload.vmid = vmids.trim();
    else {
      payload.all = 1;
      payload.exclude = vmids.trim();
    }
    if (isEdit) {
      const dropped = selKeys.filter((k) => !(k in payload));
      if (dropped.length) payload.delete = dropped.join(',');
    }

    mut.mutate(payload);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit backup job' : 'Add backup job'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}

      <FormField
        label="Schedule"
        required
        hint="systemd calendar event, e.g. 'mon..fri 02:00' or '*-*-* 02:00:00'."
      >
        <input className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
      </FormField>

      <FormField label="Target storage" required>
        <select className="input" value={effectiveStorage} onChange={(e) => setStorage(e.target.value)}>
          {backupStores.length === 0 && <option value="">No backup-capable storage</option>}
          {backupStores.map((s) => (
            <option key={str(s.storage)} value={str(s.storage)}>
              {str(s.storage)}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Guest selection">
        <select
          className="input"
          value={selection}
          onChange={(e) => setSelection(e.target.value as Selection)}
        >
          <option value="all">All guests</option>
          <option value="include">Only selected (include)</option>
          <option value="exclude">All except selected (exclude)</option>
        </select>
      </FormField>

      {selection !== 'all' && (
        <FormField label="VMIDs" required hint="Comma-separated, e.g. 100, 101, 102.">
          <input
            className="input"
            value={vmids}
            onChange={(e) => setVmids(e.target.value)}
            placeholder="100, 101"
          />
        </FormField>
      )}

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Mode">
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Compression">
          <select className="input" value={compress} onChange={(e) => setCompress(e.target.value)}>
            {COMPRESS.map((c) => (
              <option key={c} value={c}>
                {c === '0' ? 'none' : c}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <Toggle label="Enabled" checked={enabled} onChange={setEnabled} />
      {/* TODO: mailto / notification target, retention (prune-backups), per-pool selection. */}
    </Modal>
  );
}
