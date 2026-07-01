import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, History, Plus, Trash2 } from 'lucide-react';
import { pve, errMsg } from '../../api/client';
import type { GuestRef, PveSnapshot } from '../../lib/types';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../../components/states';
import { formatUnix } from '../../lib/format';
import { guestBase, guestKey, cfgStr } from './util';

const SNAPNAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export function GuestSnapshotsTab({ guest }: { guest: GuestRef }) {
  const qc = useQueryClient();
  const snapQ = useQuery({
    queryKey: guestKey(guest, 'snapshots'),
    queryFn: () => pve.get<PveSnapshot[]>(`${guestBase(guest)}/snapshot`),
  });

  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<{ snap: PveSnapshot; op: 'rollback' | 'delete' } | null>(
    null,
  );

  const opMut = useMutation({
    mutationFn: ({ snap, op }: { snap: PveSnapshot; op: 'rollback' | 'delete' }) =>
      op === 'rollback'
        ? pve.post(`${guestBase(guest)}/snapshot/${snap.name}/rollback`)
        : pve.del(`${guestBase(guest)}/snapshot/${snap.name}`),
    onSettled: () => qc.invalidateQueries({ queryKey: guestKey(guest, 'snapshots') }),
  });

  // Proxmox includes a synthetic "current" pseudo-snapshot; drop it from the list.
  const snapshots = (snapQ.data ?? []).filter((s) => s.name !== 'current');

  const columns: Column<PveSnapshot>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (s) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          <Camera className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          {s.name}
          {s.vmstate ? <Badge tone="info">RAM</Badge> : null}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (s) => <span className="text-slate-600 dark:text-slate-300">{cfgStr(s.description) || '—'}</span>,
    },
    { key: 'parent', header: 'Parent', render: (s) => <span className="text-xs text-slate-400">{cfgStr(s.parent) || '—'}</span> },
    {
      key: 'snaptime',
      header: 'Created',
      render: (s) => <span className="text-xs tabular-nums text-slate-500">{formatUnix(s.snaptime)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            className="btn-ghost h-8 w-8 p-0"
            title="Rollback"
            aria-label="Rollback"
            disabled={opMut.isPending}
            onClick={() => setPending({ snap: s, op: 'rollback' })}
          >
            <History className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost h-8 w-8 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            title="Delete"
            aria-label="Delete"
            disabled={opMut.isPending}
            onClick={() => setPending({ snap: s, op: 'delete' })}
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
          <Plus className="h-4 w-4" /> Take snapshot
        </button>
      </div>

      {snapQ.isLoading ? (
        <LoadingState label="Loading snapshots…" />
      ) : snapQ.isError ? (
        <ErrorState error={snapQ.error} onRetry={() => snapQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={snapshots}
          rowKey={(s) => s.name}
          emptyMessage="No snapshots yet."
        />
      )}

      {creating && (
        <CreateSnapshotModal guest={guest} onClose={() => setCreating(false)} />
      )}

      <ConfirmDialog
        open={!!pending}
        title={pending?.op === 'rollback' ? 'Rollback snapshot' : 'Delete snapshot'}
        message={
          pending ? (
            <>
              {pending.op === 'rollback' ? 'Roll back to' : 'Permanently delete'}{' '}
              <strong>{pending.snap.name}</strong>?
              {pending.op === 'rollback' && ' The current state will be lost.'}
            </>
          ) : (
            ''
          )
        }
        confirmLabel={pending?.op === 'rollback' ? 'Rollback' : 'Delete'}
        busy={opMut.isPending}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          await opMut.mutateAsync(pending);
          setPending(null);
        }}
      />
    </div>
  );
}

function CreateSnapshotModal({ guest, onClose }: { guest: GuestRef; onClose: () => void }) {
  const qc = useQueryClient();
  const [snapname, setSnapname] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      pve.post(`${guestBase(guest)}/snapshot`, {
        snapname,
        ...(description ? { description } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: guestKey(guest, 'snapshots') });
      onClose();
    },
    onError: (e) => setError(errMsg(e, 'Failed to create snapshot')),
  });

  const submit = () => {
    setError(null);
    if (!SNAPNAME_RE.test(snapname)) {
      setError('Name must start with a letter; letters, digits, _ and - only (max 40).');
      return;
    }
    mut.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-accent-500" aria-hidden /> Take snapshot
        </span>
      }
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}
      <FormField label="Name" required>
        <input
          className="input"
          value={snapname}
          onChange={(e) => setSnapname(e.target.value)}
          placeholder="before-upgrade"
          autoFocus
        />
      </FormField>
      <FormField label="Description">
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional note"
        />
      </FormField>
    </Modal>
  );
}
