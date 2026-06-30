import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Banner, IconBtn, TabHeader, Toggle, bool01, errMsg, str, type PveRow } from './util';

export function ReplicationTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dc', 'replication'],
    queryFn: () => pve.get<PveRow[]>('/pve/cluster/replication'),
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PveRow | null>(null);
  const [toDelete, setToDelete] = useState<PveRow | null>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => pve.del(`/pve/cluster/replication/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'replication'] }),
  });

  const columns: Column<PveRow>[] = [
    {
      key: 'id',
      header: 'Job',
      render: (r) => (
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-100">
          <Copy className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
          {str(r.id)}
        </span>
      ),
    },
    { key: 'guest', header: 'Guest', render: (r) => str(r.guest) || '—' },
    { key: 'target', header: 'Target', render: (r) => <Badge tone="info">{str(r.target)}</Badge> },
    { key: 'schedule', header: 'Schedule', render: (r) => <span className="font-mono text-xs text-zinc-400">{str(r.schedule) || '*/15'}</span> },
    { key: 'rate', header: 'Rate', render: (r) => <span className="text-xs text-zinc-400">{str(r.rate) ? `${str(r.rate)} MB/s` : '—'}</span> },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (r) => (bool01(r.disable) ? <Badge tone="neutral">disabled</Badge> : <Badge tone="success">enabled</Badge>),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <IconBtn title="Edit" icon={Pencil} onClick={() => setEditing(r)} />
          <IconBtn title="Delete" icon={Trash2} danger onClick={() => setToDelete(r)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <TabHeader
        title="Replication jobs"
        icon={Copy}
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add job
          </button>
        }
      />
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable columns={columns} rows={q.data ?? []} rowKey={(r) => str(r.id)} emptyMessage={q.isPending ? 'Loading…' : 'No replication jobs.'} />
      )}
      {(creating || editing) && (
        <ReplicationFormModal existing={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete replication job"
        message={<>Delete replication job <strong>{str(toDelete?.id)}</strong>?</>}
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => { if (!toDelete) return; await delMut.mutateAsync(str(toDelete.id)); setToDelete(null); }}
      />
    </div>
  );
}

function ReplicationFormModal({ existing, onClose }: { existing: PveRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!existing;

  const [id, setId] = useState(str(existing?.id));
  const [target, setTarget] = useState(str(existing?.target));
  const [schedule, setSchedule] = useState(str(existing?.schedule) || '*/15');
  const [rate, setRate] = useState(str(existing?.rate));
  const [comment, setComment] = useState(str(existing?.comment));
  const [enabled, setEnabled] = useState(!bool01(existing?.disable));
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? pve.put(`/pve/cluster/replication/${encodeURIComponent(id)}`, payload)
        : pve.post('/pve/cluster/replication', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dc', 'replication'] }); onClose(); },
    onError: (e) => setError(errMsg(e, 'Failed to save replication job')),
  });

  const onSubmit = () => {
    setError(null);
    if (!isEdit && !/^\d+-\d+$/.test(id.trim())) return setError('Job ID must be <vmid>-<number>, e.g. 100-0.');
    if (!target.trim()) return setError('A target node is required.');
    const payload: Record<string, unknown> = {
      target: target.trim(),
      schedule: schedule.trim(),
      comment: comment.trim(),
      disable: enabled ? 0 : 1,
    };
    if (rate.trim()) payload.rate = rate.trim();
    if (!isEdit) {
      payload.id = id.trim();
      payload.type = 'local';
    }
    mut.mutate(payload);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit replication · ${id}` : 'Add replication job'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Job ID" required={!isEdit} hint="<vmid>-<number>, e.g. 100-0.">
          <input className="input" value={id} disabled={isEdit} onChange={(e) => setId(e.target.value)} placeholder="100-0" />
        </FormField>
        <FormField label="Target node" required>
          <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="pve2" />
        </FormField>
      </div>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Schedule" hint="systemd calendar event.">
          <input className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="*/15" />
        </FormField>
        <FormField label="Rate limit (MB/s)" hint="Blank = unlimited.">
          <input className="input" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="10" />
        </FormField>
      </div>
      <FormField label="Comment">
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </FormField>
      <Toggle label="Enabled" checked={enabled} onChange={setEnabled} />
    </Modal>
  );
}
