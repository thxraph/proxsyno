import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Network, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { pve, ApiError } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../../components/states';
import { bool, str, type PveObj } from './util';

// The interface types we let users create here. Proxmox supports more
// (OVS*, etc.) — TODO: extend once the common cases are validated.
const CREATABLE_TYPES = ['bridge', 'bond', 'vlan', 'eth'] as const;
type IfaceType = (typeof CREATABLE_TYPES)[number];

const TYPE_TONE: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  bridge: 'accent',
  bond: 'info',
  vlan: 'warning',
  eth: 'neutral',
};

export function NetworkTab({ node }: { node: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['node', 'network', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/network`),
  });

  const [editing, setEditing] = useState<PveObj | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['node', 'network', node] });

  // PUT with no iface reloads (applies) pending network config.
  const applyMut = useMutation({
    mutationFn: () => pve.put(`/pve/nodes/${node}/network`),
    onSettled: invalidate,
  });
  // DELETE with no iface reverts pending changes.
  const revertMut = useMutation({
    mutationFn: () => pve.del(`/pve/nodes/${node}/network`),
    onSettled: invalidate,
  });
  const delMut = useMutation({
    mutationFn: (iface: string) => pve.del(`/pve/nodes/${node}/network/${iface}`),
    onSettled: invalidate,
  });

  const columns: Column<PveObj>[] = [
    {
      key: 'iface',
      header: 'Interface',
      render: (i) => (
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-200">
          <Network className="h-3.5 w-3.5 text-zinc-500" aria-hidden /> {str(i, 'iface')}
        </span>
      ),
    },
    { key: 'type', header: 'Type', render: (i) => <Badge tone={TYPE_TONE[str(i, 'type')] ?? 'neutral'}>{str(i, 'type')}</Badge> },
    {
      key: 'active',
      header: 'Active',
      render: (i) => <Badge tone={bool(i, 'active') ? 'success' : 'neutral'}>{bool(i, 'active') ? 'up' : 'down'}</Badge>,
    },
    {
      key: 'autostart',
      header: 'Autostart',
      render: (i) => (bool(i, 'autostart') ? <Badge tone="success">yes</Badge> : <span className="text-xs text-zinc-500">no</span>),
    },
    { key: 'cidr', header: 'Address', render: (i) => <span className="font-mono text-xs text-zinc-300">{str(i, 'cidr') || str(i, 'address') || '—'}</span> },
    { key: 'gateway', header: 'Gateway', render: (i) => <span className="font-mono text-xs text-zinc-400">{str(i, 'gateway') || '—'}</span> },
    {
      key: 'ports',
      header: 'Ports / slaves',
      render: (i) => <span className="font-mono text-xs text-zinc-400">{str(i, 'bridge_ports') || str(i, 'bond_slaves') || str(i, 'slaves') || '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (i) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost h-8 w-8 p-0" title="Edit" onClick={() => setEditing(i)}>
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
          <button
            className="btn-ghost h-8 w-8 p-0 text-rose-400 hover:bg-rose-500/10"
            title="Delete"
            onClick={() => setToDelete(str(i, 'iface'))}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Network className="h-4 w-4 text-zinc-400" aria-hidden /> Network interfaces
        </h3>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setConfirmRevert(true)} disabled={revertMut.isPending}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Revert
          </button>
          <button className="btn-secondary" onClick={() => setConfirmApply(true)} disabled={applyMut.isPending}>
            <Check className="h-4 w-4" aria-hidden /> Apply configuration
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Create
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-zinc-500">
        Changes are staged. Click <span className="text-zinc-300">Apply configuration</span> to reload
        networking, or <span className="text-zinc-300">Revert</span> to discard pending edits.
      </p>

      {q.isLoading ? (
        <LoadingState label="Reading network configuration…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable columns={columns} rows={q.data ?? []} rowKey={(i) => str(i, 'iface')} emptyMessage="No interfaces found." />
      )}

      {(creating || editing) && (
        <IfaceFormModal
          node={node}
          iface={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete interface"
        message={
          <>
            Delete interface <strong>{toDelete}</strong>? You must Apply the configuration afterwards
            for it to take effect.
          </>
        }
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await delMut.mutateAsync(toDelete);
          setToDelete(null);
        }}
      />

      <ConfirmDialog
        open={confirmApply}
        destructive={false}
        title="Apply network configuration"
        message="Reload networking on the host to apply all pending changes. A misconfiguration can drop your connection to the node."
        confirmLabel="Apply"
        busy={applyMut.isPending}
        onCancel={() => setConfirmApply(false)}
        onConfirm={async () => {
          await applyMut.mutateAsync();
          setConfirmApply(false);
        }}
      />

      <ConfirmDialog
        open={confirmRevert}
        title="Revert pending changes"
        message="Discard all staged network changes that have not been applied yet?"
        confirmLabel="Revert"
        busy={revertMut.isPending}
        onCancel={() => setConfirmRevert(false)}
        onConfirm={async () => {
          await revertMut.mutateAsync();
          setConfirmRevert(false);
        }}
      />
    </div>
  );
}

function IfaceFormModal({
  node,
  iface,
  onClose,
  onSaved,
}: {
  node: string;
  iface: PveObj | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!iface;
  const [name, setName] = useState(str(iface ?? undefined, 'iface'));
  const [type, setType] = useState<IfaceType>(((iface && str(iface, 'type')) || 'bridge') as IfaceType);
  const [ports, setPorts] = useState(str(iface ?? undefined, 'bridge_ports') || str(iface ?? undefined, 'bond_slaves'));
  const [address, setAddress] = useState(str(iface ?? undefined, 'address'));
  const [netmask, setNetmask] = useState(str(iface ?? undefined, 'netmask'));
  const [gateway, setGateway] = useState(str(iface ?? undefined, 'gateway'));
  const [vlanTag, setVlanTag] = useState(str(iface ?? undefined, 'vlan-id'));
  const [autostart, setAutostart] = useState(iface ? bool(iface, 'autostart') : true);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = {
        type,
        autostart: autostart ? 1 : 0,
      };
      if (address) {
        params.address = address;
        if (netmask) params.netmask = netmask;
        if (gateway) params.gateway = gateway;
      }
      if (type === 'bridge' && ports) params.bridge_ports = ports;
      if (type === 'bond' && ports) params.bond_slaves = ports;
      if (type === 'vlan' && vlanTag) params['vlan-id'] = Number(vlanTag);

      if (isEdit) {
        return pve.put(`/pve/nodes/${node}/network/${name}`, params);
      }
      return pve.post(`/pve/nodes/${node}/network`, { iface: name, ...params });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to save interface'),
  });

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError('An interface name is required.');
      return;
    }
    mut.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit interface · ${name}` : 'Create interface'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">{error}</div>}

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Interface name" hint={isEdit ? undefined : 'e.g. vmbr1, bond0, eth0.100'}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit} placeholder="vmbr1" />
        </FormField>
        <FormField label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as IfaceType)} disabled={isEdit}>
            {CREATABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {type === 'bridge' && (
        <FormField label="Bridge ports" hint="Space-separated, e.g. eth0 eth1">
          <input className="input" value={ports} onChange={(e) => setPorts(e.target.value)} placeholder="eth0" />
        </FormField>
      )}
      {type === 'bond' && (
        <FormField label="Bond slaves" hint="Space-separated physical interfaces">
          <input className="input" value={ports} onChange={(e) => setPorts(e.target.value)} placeholder="eth0 eth1" />
        </FormField>
      )}
      {type === 'vlan' && (
        <FormField label="VLAN tag">
          <input className="input" type="number" value={vlanTag} onChange={(e) => setVlanTag(e.target.value)} placeholder="100" />
        </FormField>
      )}

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Address (IPv4)">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.2" />
        </FormField>
        <FormField label="Netmask">
          <input className="input" value={netmask} onChange={(e) => setNetmask(e.target.value)} placeholder="255.255.255.0" />
        </FormField>
      </div>

      <FormField label="Gateway">
        <input className="input" value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="192.168.1.1" />
      </FormField>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={autostart} onChange={(e) => setAutostart(e.target.checked)} className="h-4 w-4 accent-orange-500" />
        Start on boot (autostart)
      </label>
    </Modal>
  );
}
