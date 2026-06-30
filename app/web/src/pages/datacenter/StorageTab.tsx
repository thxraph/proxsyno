import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Pencil, Plus, Trash2 } from 'lucide-react';
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

const STORAGE_TYPES = ['dir', 'lvm', 'lvmthin', 'zfspool', 'nfs', 'cifs'] as const;
type StorageType = (typeof STORAGE_TYPES)[number];

interface StorageField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  // create-only fields can't be changed by PUT in Proxmox.
  createOnly?: boolean;
  password?: boolean;
}

const TYPE_FIELDS: Record<StorageType, StorageField[]> = {
  dir: [{ key: 'path', label: 'Directory path', placeholder: '/mnt/data', required: true, createOnly: true }],
  lvm: [{ key: 'vgname', label: 'Volume group', required: true, createOnly: true }],
  lvmthin: [
    { key: 'vgname', label: 'Volume group', required: true, createOnly: true },
    { key: 'thinpool', label: 'Thin pool', required: true, createOnly: true },
  ],
  zfspool: [{ key: 'pool', label: 'ZFS pool', placeholder: 'tank/data', required: true, createOnly: true }],
  nfs: [
    { key: 'server', label: 'Server', placeholder: '10.0.0.1', required: true },
    { key: 'export', label: 'Export path', placeholder: '/export/share', required: true, createOnly: true },
  ],
  cifs: [
    { key: 'server', label: 'Server', placeholder: '10.0.0.1', required: true },
    { key: 'share', label: 'Share', required: true, createOnly: true },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', password: true },
  ],
};

function normType(t: string): StorageType {
  return (STORAGE_TYPES as readonly string[]).includes(t) ? (t as StorageType) : 'dir';
}

const ALL_CONTENT = ['images', 'rootdir', 'vztmpl', 'iso', 'backup', 'snippets'];
const BLOCK_CONTENT = ['images', 'rootdir'];
function contentFor(type: StorageType): string[] {
  return type === 'lvm' || type === 'lvmthin' || type === 'zfspool' ? BLOCK_CONTENT : ALL_CONTENT;
}

export function StorageTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dc', 'storage'],
    queryFn: () => pve.get<PveRow[]>('/pve/storage'),
  });

  const [editing, setEditing] = useState<PveRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<PveRow | null>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => pve.del(`/pve/storage/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'storage'] }),
  });

  const columns: Column<PveRow>[] = [
    {
      key: 'storage',
      header: 'ID',
      render: (s) => (
        <span className="flex items-center gap-2 font-medium text-zinc-100">
          <Database className="h-4 w-4 text-zinc-500" aria-hidden />
          {str(s.storage)}
        </span>
      ),
    },
    { key: 'type', header: 'Type', render: (s) => <Badge tone="info">{str(s.type)}</Badge> },
    {
      key: 'content',
      header: 'Content',
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {str(s.content)
            .split(',')
            .filter(Boolean)
            .map((c) => (
              <Badge key={c} tone="neutral">
                {c}
              </Badge>
            ))}
        </div>
      ),
    },
    {
      key: 'nodes',
      header: 'Nodes',
      render: (s) => <span className="text-xs text-zinc-400">{str(s.nodes) || 'all'}</span>,
    },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (s) =>
        bool01(s.disable) ? (
          <Badge tone="neutral">disabled</Badge>
        ) : (
          <Badge tone="success">enabled</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <div className="flex justify-end gap-1">
          <IconBtn title="Edit" icon={Pencil} onClick={() => setEditing(s)} />
          <IconBtn title="Delete" icon={Trash2} danger onClick={() => setToDelete(s)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <TabHeader
        title="Storage"
        icon={Database}
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add storage
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
          rowKey={(s) => str(s.storage)}
          emptyMessage="No storages configured."
        />
      )}

      {(creating || editing) && (
        <StorageFormModal
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete storage"
        message={
          <>
            Remove storage <strong>{str(toDelete?.storage)}</strong> from the cluster
            configuration? This does not erase the underlying data.
          </>
        }
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await delMut.mutateAsync(str(toDelete.storage));
          setToDelete(null);
        }}
      />
    </div>
  );
}

function StorageFormModal({ existing, onClose }: { existing: PveRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!existing;

  const [id, setId] = useState(str(existing?.storage));
  const [type, setType] = useState<StorageType>(normType(str(existing?.type)));
  const [content, setContent] = useState<string[]>(
    str(existing?.content).split(',').filter(Boolean),
  );
  const [nodes, setNodes] = useState(str(existing?.nodes));
  const [enabled, setEnabled] = useState(!bool01(existing?.disable));
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of TYPE_FIELDS[normType(str(existing?.type))]) {
      init[f.key] = str(existing?.[f.key]);
    }
    return init;
  });
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? pve.put(`/pve/storage/${encodeURIComponent(id)}`, payload)
        : pve.post('/pve/storage', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dc', 'storage'] });
      onClose();
    },
    onError: (e) => setError(errMsg(e, 'Failed to save storage')),
  });

  const onTypeChange = (t: StorageType) => {
    setType(t);
    setContent((prev) => prev.filter((c) => contentFor(t).includes(c)));
    const init: Record<string, string> = {};
    for (const f of TYPE_FIELDS[t]) init[f.key] = '';
    setFields(init);
  };

  const toggleContent = (c: string) =>
    setContent((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const onSubmit = () => {
    setError(null);
    if (!isEdit && !id.trim()) return setError('A storage ID is required.');
    for (const f of TYPE_FIELDS[type]) {
      if (f.required && !isEdit && !fields[f.key]?.trim()) {
        return setError(`${f.label} is required.`);
      }
    }
    const payload: Record<string, unknown> = {
      content: content.join(','),
      disable: enabled ? 0 : 1,
    };
    if (nodes.trim()) payload.nodes = nodes.trim();
    if (!isEdit) {
      payload.storage = id.trim();
      payload.type = type;
    }
    for (const f of TYPE_FIELDS[type]) {
      // create-only fields are immutable on edit; password only sent when set.
      if (isEdit && f.createOnly) continue;
      const val = fields[f.key]?.trim();
      if (val) payload[f.key] = val;
    }
    mut.mutate(payload);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit storage · ${id}` : 'Add storage'}
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

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Storage ID" required={!isEdit}>
          <input
            className="input"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={isEdit}
            placeholder="local-data"
          />
        </FormField>
        <FormField label="Type" required>
          <select
            className="input"
            value={type}
            disabled={isEdit}
            onChange={(e) => onTypeChange(e.target.value as StorageType)}
          >
            {STORAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {TYPE_FIELDS[type].map((f) => (
        <FormField
          key={f.key}
          label={f.label}
          required={f.required && !isEdit}
          hint={isEdit && f.createOnly ? 'Cannot be changed after creation.' : undefined}
        >
          <input
            className="input"
            type={f.password ? 'password' : 'text'}
            value={fields[f.key] ?? ''}
            disabled={isEdit && f.createOnly}
            placeholder={f.placeholder}
            onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
        </FormField>
      ))}

      <FormField label="Content" hint="What this storage may hold.">
        <div className="flex flex-wrap gap-2">
          {contentFor(type).map((c) => {
            const active = content.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleContent(c)}
                className={
                  active
                    ? 'rounded-lg bg-accent-500/15 px-2.5 py-1 text-xs font-medium text-accent-400 ring-1 ring-inset ring-accent-500/30'
                    : 'rounded-lg bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-400 ring-1 ring-inset ring-zinc-700'
                }
              >
                {c}
              </button>
            );
          })}
        </div>
      </FormField>

      <FormField label="Nodes" hint="Comma-separated; leave blank for all nodes.">
        <input
          className="input"
          value={nodes}
          onChange={(e) => setNodes(e.target.value)}
          placeholder="pve, pve2"
        />
      </FormField>

      <Toggle label="Enabled" checked={enabled} onChange={setEnabled} />
    </Modal>
  );
}
