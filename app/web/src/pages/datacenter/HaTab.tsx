import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartPulse, Plus, Trash2, Users } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Banner, IconBtn, TabHeader, Toggle, bool01, errMsg, str, type PveRow } from './util';

const HA_STATES = ['started', 'stopped', 'ignored', 'disabled'];

export function HaTab() {
  return (
    <div className="space-y-8">
      <ResourcesSection />
      <GroupsSection />
    </div>
  );
}

/* ---------- HA resources ---------- */

function ResourcesSection() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dc', 'ha', 'resources'],
    queryFn: () => pve.get<PveRow[]>('/pve/cluster/ha/resources'),
  });
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<PveRow | null>(null);

  const delMut = useMutation({
    mutationFn: (sid: string) => pve.del(`/pve/cluster/ha/resources/${encodeURIComponent(sid)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'ha', 'resources'] }),
  });

  const columns: Column<PveRow>[] = [
    {
      key: 'sid',
      header: 'Resource',
      render: (r) => (
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-100">
          <HeartPulse className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
          {str(r.sid)}
        </span>
      ),
    },
    { key: 'state', header: 'State', render: (r) => <Badge tone={str(r.state) === 'started' ? 'success' : 'neutral'}>{str(r.state) || 'started'}</Badge> },
    { key: 'group', header: 'Group', render: (r) => str(r.group) || '—' },
    { key: 'max_restart', header: 'Max restart', align: 'right', render: (r) => <span className="tabular-nums">{str(r.max_restart) || '1'}</span> },
    { key: 'max_relocate', header: 'Max relocate', align: 'right', render: (r) => <span className="tabular-nums">{str(r.max_relocate) || '1'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end">
          <IconBtn title="Remove" icon={Trash2} danger onClick={() => setToDelete(r)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <TabHeader
        title="HA resources"
        icon={HeartPulse}
        actions={
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add resource
          </button>
        }
      />
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable columns={columns} rows={q.data ?? []} rowKey={(r) => str(r.sid)} emptyMessage={q.isPending ? 'Loading…' : 'No HA-managed resources.'} />
      )}
      {adding && <ResourceAddModal onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!toDelete}
        title="Remove HA resource"
        message={<>Stop managing <strong>{str(toDelete?.sid)}</strong> with HA?</>}
        confirmLabel="Remove"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => { if (!toDelete) return; await delMut.mutateAsync(str(toDelete.sid)); setToDelete(null); }}
      />
    </div>
  );
}

function ResourceAddModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const groupsQ = useQuery({ queryKey: ['dc', 'ha', 'groups'], queryFn: () => pve.get<PveRow[]>('/pve/cluster/ha/groups') });

  const [type, setType] = useState<'vm' | 'ct'>('vm');
  const [vmid, setVmid] = useState('');
  const [state, setState] = useState('started');
  const [group, setGroup] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { sid: `${type}:${vmid.trim()}`, state };
      if (group) payload.group = group;
      if (comment.trim()) payload.comment = comment.trim();
      return pve.post('/pve/cluster/ha/resources', payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dc', 'ha', 'resources'] }); onClose(); },
    onError: (e) => setError(errMsg(e, 'Failed to add HA resource')),
  });

  const onSubmit = () => {
    setError(null);
    if (!/^\d+$/.test(vmid.trim())) return setError('Enter a numeric VMID.');
    mut.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add HA resource"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Add'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="vm">VM</option>
            <option value="ct">Container</option>
          </select>
        </FormField>
        <FormField label="VMID" required>
          <input className="input" value={vmid} onChange={(e) => setVmid(e.target.value)} placeholder="100" />
        </FormField>
      </div>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Requested state">
          <select className="input" value={state} onChange={(e) => setState(e.target.value)}>
            {HA_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <FormField label="HA group" hint="Optional.">
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">none</option>
            {(groupsQ.data ?? []).map((g) => (
              <option key={str(g.group)} value={str(g.group)}>{str(g.group)}</option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Comment">
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </FormField>
      {/* TODO: max_restart / max_relocate tuning. */}
    </Modal>
  );
}

/* ---------- HA groups ---------- */

function GroupsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dc', 'ha', 'groups'], queryFn: () => pve.get<PveRow[]>('/pve/cluster/ha/groups') });
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<PveRow | null>(null);

  const delMut = useMutation({
    mutationFn: (group: string) => pve.del(`/pve/cluster/ha/groups/${encodeURIComponent(group)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'ha', 'groups'] }),
  });

  const columns: Column<PveRow>[] = [
    {
      key: 'group',
      header: 'Group',
      render: (g) => (
        <span className="flex items-center gap-2 font-medium text-zinc-100">
          <Users className="h-4 w-4 text-zinc-500" aria-hidden />
          {str(g.group)}
        </span>
      ),
    },
    { key: 'nodes', header: 'Nodes', render: (g) => <span className="font-mono text-xs text-zinc-400">{str(g.nodes)}</span> },
    { key: 'restricted', header: 'Restricted', render: (g) => (bool01(g.restricted) ? 'yes' : 'no') },
    { key: 'nofailback', header: 'No failback', render: (g) => (bool01(g.nofailback) ? 'yes' : 'no') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (g) => (
        <div className="flex justify-end">
          <IconBtn title="Remove" icon={Trash2} danger onClick={() => setToDelete(g)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <TabHeader
        title="HA groups"
        icon={Users}
        actions={
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add group
          </button>
        }
      />
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable columns={columns} rows={q.data ?? []} rowKey={(g) => str(g.group)} emptyMessage={q.isPending ? 'Loading…' : 'No HA groups.'} />
      )}
      {adding && <GroupAddModal onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!toDelete}
        title="Remove HA group"
        message={<>Delete HA group <strong>{str(toDelete?.group)}</strong>?</>}
        confirmLabel="Remove"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => { if (!toDelete) return; await delMut.mutateAsync(str(toDelete.group)); setToDelete(null); }}
      />
    </div>
  );
}

function GroupAddModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [group, setGroup] = useState('');
  const [nodes, setNodes] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [nofailback, setNofailback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      pve.post('/pve/cluster/ha/groups', {
        group: group.trim(),
        nodes: nodes.trim(),
        restricted: restricted ? 1 : 0,
        nofailback: nofailback ? 1 : 0,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dc', 'ha', 'groups'] }); onClose(); },
    onError: (e) => setError(errMsg(e, 'Failed to add HA group')),
  });

  const onSubmit = () => {
    setError(null);
    if (!group.trim()) return setError('A group ID is required.');
    if (!nodes.trim()) return setError('At least one node is required.');
    mut.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add HA group"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Add'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <FormField label="Group ID" required>
        <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="primary" />
      </FormField>
      <FormField label="Nodes" required hint="Comma-separated, optional priority: node1:2, node2:1.">
        <input className="input" value={nodes} onChange={(e) => setNodes(e.target.value)} placeholder="pve1, pve2" />
      </FormField>
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
        <Toggle label="Restricted" checked={restricted} onChange={setRestricted} />
        <Toggle label="No failback" checked={nofailback} onChange={setNofailback} />
      </div>
    </Modal>
  );
}
