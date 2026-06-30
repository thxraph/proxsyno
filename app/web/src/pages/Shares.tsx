import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type {
  NfsExport,
  NfsExportInput,
  SharesResponse,
  SmbShare,
  SmbShareInput,
} from '../lib/types';
import { cx } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../components/states';

const SHARE_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$/;

type Tab = 'smb' | 'nfs';

export function Shares() {
  const [tab, setTab] = useState<Tab>('smb');

  const sharesQ = useQuery({
    queryKey: ['shares'],
    queryFn: () => api.get<SharesResponse>('/shares'),
  });

  return (
    <div>
      <PageHeader title="Shares" description="Expose folders over SMB and NFS" />

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        <TabButton active={tab === 'smb'} onClick={() => setTab('smb')} icon={Network} label="SMB" />
        <TabButton active={tab === 'nfs'} onClick={() => setTab('nfs')} icon={Server} label="NFS" />
      </div>

      {sharesQ.isLoading ? (
        <LoadingState label="Loading shares…" />
      ) : sharesQ.isError ? (
        <ErrorState error={sharesQ.error} onRetry={() => sharesQ.refetch()} />
      ) : tab === 'smb' ? (
        <SmbSection shares={sharesQ.data?.smb ?? []} />
      ) : (
        <NfsSection exports={sharesQ.data?.nfs ?? []} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Network;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-accent-600 text-white'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

/* ---------------------------------- SMB ---------------------------------- */

function SmbSection({ shares }: { shares: SmbShare[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SmbShare | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<SmbShare | null>(null);

  const delMut = useMutation({
    mutationFn: (name: string) => api.del<void>(`/shares/smb/${encodeURIComponent(name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shares'] }),
  });

  const columns: Column<SmbShare>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (s) => <span className="font-medium text-slate-800 dark:text-slate-100">{s.name}</span>,
    },
    {
      key: 'path',
      header: 'Path',
      render: (s) => (
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{s.path}</span>
      ),
    },
    { key: 'comment', header: 'Comment', render: (s) => s.comment || '—' },
    {
      key: 'access',
      header: 'Access',
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={s.readOnly ? 'warning' : 'success'}>{s.readOnly ? 'Read only' : 'Read/write'}</Badge>
          {s.guestOk && <Badge tone="info">Guest OK</Badge>}
        </div>
      ),
    },
    {
      key: 'users',
      header: 'Valid users',
      render: (s) =>
        s.validUsers.length ? (
          <span className="text-xs">{s.validUsers.join(', ')}</span>
        ) : (
          <span className="text-xs text-slate-400">everyone</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost h-8 w-8 p-0" onClick={() => setEditing(s)} title="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost h-8 w-8 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            onClick={() => setToDelete(s)}
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New SMB share
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={shares}
        rowKey={(s) => s.name}
        emptyMessage="No SMB shares yet. Create one to expose a folder over the network."
      />

      {(creating || editing) && (
        <SmbFormModal
          share={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete SMB share"
        message={
          <>
            Remove the share <strong>{toDelete?.name}</strong>? The underlying folder is not deleted.
          </>
        }
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await delMut.mutateAsync(toDelete.name);
          setToDelete(null);
        }}
      />
    </div>
  );
}

function SmbFormModal({ share, onClose }: { share: SmbShare | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!share;
  const [name, setName] = useState(share?.name ?? '');
  const [path, setPath] = useState(share?.path ?? '');
  const [comment, setComment] = useState(share?.comment ?? '');
  const [readOnly, setReadOnly] = useState(share?.readOnly ?? false);
  const [guestOk, setGuestOk] = useState(share?.guestOk ?? false);
  const [validUsers, setValidUsers] = useState((share?.validUsers ?? []).join(', '));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: SmbShareInput) =>
      isEdit
        ? api.put<{ share: SmbShare }>(`/shares/smb/${encodeURIComponent(share!.name)}`, payload)
        : api.post<{ share: SmbShare }>('/shares/smb', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shares'] });
      onClose();
    },
    onError: (e) => setSubmitError(e instanceof ApiError ? e.message : 'Failed to save share'),
  });

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!SHARE_NAME_RE.test(name))
      next.name = 'Letters, digits, underscore and dash; 1–32 chars; must start alphanumeric/_.';
    if (!path.startsWith('/')) next.path = 'Enter an absolute path (e.g. /mnt/raid/media).';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = () => {
    setSubmitError(null);
    if (!validate()) return;
    const users = validUsers
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    mut.mutate({
      name: name.trim(),
      path: path.trim(),
      comment: comment.trim() || undefined,
      readOnly,
      guestOk,
      validUsers: users,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit share · ${share!.name}` : 'New SMB share'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create share'}
          </button>
        </>
      }
    >
      {submitError && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {submitError}
        </div>
      )}

      <FormField label="Share name" required error={errors.name}>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isEdit}
          placeholder="media"
        />
      </FormField>

      <FormField label="Folder path" required error={errors.path} hint="Absolute path on the host">
        <input
          className="input font-mono"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/mnt/raid/media"
        />
      </FormField>

      <FormField label="Comment">
        <input
          className="input"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional description"
        />
      </FormField>

      <FormField
        label="Valid users"
        hint="Comma-separated usernames. Leave empty to allow everyone."
      >
        <input
          className="input"
          value={validUsers}
          onChange={(e) => setValidUsers(e.target.value)}
          placeholder="alice, bob"
        />
      </FormField>

      <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
        <Toggle label="Read only" checked={readOnly} onChange={setReadOnly} />
        <Toggle label="Allow guest access" checked={guestOk} onChange={setGuestOk} />
      </div>
    </Modal>
  );
}

/* ---------------------------------- NFS ---------------------------------- */

function NfsSection({ exports }: { exports: NfsExport[] }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<NfsExport | null>(null);

  const delMut = useMutation({
    mutationFn: (path: string) => api.del<void>(`/shares/nfs?path=${encodeURIComponent(path)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shares'] }),
  });

  const columns: Column<NfsExport>[] = [
    {
      key: 'path',
      header: 'Export path',
      render: (e) => (
        <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{e.path}</span>
      ),
    },
    {
      key: 'clients',
      header: 'Clients',
      render: (e) =>
        e.clients.length ? (
          <div className="flex flex-col gap-1">
            {e.clients.map((c, i) => (
              <span key={i} className="text-xs">
                <span className="font-medium">{c.host}</span>
                {c.options && (
                  <span className="ml-1 text-slate-400">({c.options})</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-400">none</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) => (
        <button
          className="btn-ghost h-8 w-8 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
          onClick={() => setToDelete(e)}
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New NFS export
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={exports}
        rowKey={(e) => e.path}
        emptyMessage="No NFS exports yet."
      />

      {creating && <NfsFormModal onClose={() => setCreating(false)} />}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete NFS export"
        message={
          <>
            Remove the export <strong>{toDelete?.path}</strong>?
          </>
        }
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await delMut.mutateAsync(toDelete.path);
          setToDelete(null);
        }}
      />
    </div>
  );
}

interface ClientRow {
  host: string;
  options: string;
}

function NfsFormModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const [clients, setClients] = useState<ClientRow[]>([{ host: '*', options: 'rw,sync,no_subtree_check' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: NfsExportInput) => api.post<{ export: NfsExport }>('/shares/nfs', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shares'] });
      onClose();
    },
    onError: (e) => setSubmitError(e instanceof ApiError ? e.message : 'Failed to save export'),
  });

  const updateClient = (i: number, patch: Partial<ClientRow>) =>
    setClients((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!path.startsWith('/')) next.path = 'Enter an absolute path.';
    if (clients.every((c) => !c.host.trim())) next.clients = 'Add at least one client host.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = () => {
    setSubmitError(null);
    if (!validate()) return;
    mut.mutate({
      path: path.trim(),
      clients: clients
        .filter((c) => c.host.trim())
        .map((c) => ({ host: c.host.trim(), options: c.options.trim() || undefined })),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New NFS export"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Create export'}
          </button>
        </>
      }
    >
      {submitError && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {submitError}
        </div>
      )}

      <FormField label="Export path" required error={errors.path}>
        <input
          className="input font-mono"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/mnt/raid/backups"
        />
      </FormField>

      <FormField label="Clients" required error={errors.clients} hint="Host pattern and export options">
        <div className="space-y-2">
          {clients.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="input"
                value={c.host}
                onChange={(e) => updateClient(i, { host: e.target.value })}
                placeholder="192.168.1.0/24 or *"
              />
              <input
                className="input font-mono"
                value={c.options}
                onChange={(e) => updateClient(i, { options: e.target.value })}
                placeholder="rw,sync,no_subtree_check"
              />
              <button
                type="button"
                className="btn-ghost h-9 w-9 shrink-0 p-0 text-red-500"
                onClick={() => setClients((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={clients.length === 1}
                title="Remove client"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setClients((prev) => [...prev, { host: '', options: 'rw,sync,no_subtree_check' }])}
          >
            <Plus className="h-4 w-4" /> Add client
          </button>
        </div>
      </FormField>
    </Modal>
  );
}

/* ------------------------------ shared bits ------------------------------ */

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-accent-600' : 'bg-slate-300 dark:bg-slate-700',
        )}
      >
        <span
          className={cx(
            'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
      {label}
    </label>
  );
}
