import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Database, Play } from 'lucide-react';
import { pve, errMsg } from '../../api/client';
import type { GuestRef, PveStorage, PveStorageContent } from '../../lib/types';
import { DataTable, type Column } from '../../components/DataTable';
import { FormField } from '../../components/FormField';
import { ErrorState, LoadingState } from '../../components/states';
import { formatBytes, formatUnix } from '../../lib/format';
import { guestKey, cfgStr } from './util';

interface BackupListResult {
  storages: string[];
  backups: PveStorageContent[];
}

export function GuestBackupTab({ guest }: { guest: GuestRef }) {
  const qc = useQueryClient();
  const [storage, setStorage] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const backupsQ = useQuery({
    queryKey: guestKey(guest, 'backups'),
    queryFn: async (): Promise<BackupListResult> => {
      const storages = await pve.get<PveStorage[]>(`/pve/nodes/${guest.node}/storage`);
      const backupStores = storages.filter((s) => (s.content ?? '').includes('backup'));
      const lists = await Promise.all(
        backupStores.map((s) =>
          pve
            .get<PveStorageContent[]>(
              `/pve/nodes/${guest.node}/storage/${s.storage}/content?content=backup`,
            )
            .catch(() => [] as PveStorageContent[]),
        ),
      );
      const backups = lists
        .flat()
        .filter((b) => Number(b.vmid) === guest.vmid)
        .sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0));
      return { storages: backupStores.map((s) => s.storage), backups };
    },
  });

  const vzdumpMut = useMutation({
    mutationFn: () =>
      pve.post(`/pve/nodes/${guest.node}/vzdump`, { vmid: guest.vmid, storage }),
    onSuccess: () => {
      setNote('Backup task started — check the Task Log tab for progress.');
      qc.invalidateQueries({ queryKey: guestKey(guest, 'backups') });
      qc.invalidateQueries({ queryKey: guestKey(guest, 'tasks') });
    },
    onError: (e) => setSubmitError(errMsg(e, 'Failed to start backup')),
  });

  const storages = backupsQ.data?.storages ?? [];
  const effectiveStorage = storage || storages[0] || '';

  const columns: Column<PveStorageContent>[] = [
    {
      key: 'volid',
      header: 'Volume',
      render: (b) => (
        <span className="flex items-center gap-2 break-all font-mono text-xs text-slate-700 dark:text-slate-200">
          <Archive className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          {b.volid}
        </span>
      ),
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      render: (b) => <span className="tabular-nums text-xs">{formatBytes(b.size)}</span>,
    },
    {
      key: 'ctime',
      header: 'Created',
      render: (b) => <span className="text-xs tabular-nums text-slate-500">{formatUnix(b.ctime)}</span>,
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (b) => <span className="text-xs text-slate-500">{cfgStr(b.notes) || '—'}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Database className="h-4 w-4 text-accent-500" aria-hidden /> Backup now
        </p>
        {submitError && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            {submitError}
          </div>
        )}
        {note && (
          <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            {note}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField label="Target storage" className="mb-0 flex-1">
            <select
              className="input"
              value={effectiveStorage}
              onChange={(e) => setStorage(e.target.value)}
            >
              {storages.length === 0 && <option value="">No backup-capable storage</option>}
              {storages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
          <button
            className="btn-primary"
            disabled={!effectiveStorage || vzdumpMut.isPending}
            onClick={() => {
              setSubmitError(null);
              setNote(null);
              vzdumpMut.mutate();
            }}
          >
            <Play className="h-4 w-4" />
            {vzdumpMut.isPending ? 'Starting…' : 'Backup now'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Runs vzdump with default mode. Progress appears in the Task Log tab.
        </p>
      </div>

      {backupsQ.isLoading ? (
        <LoadingState label="Loading backups…" />
      ) : backupsQ.isError ? (
        <ErrorState error={backupsQ.error} onRetry={() => backupsQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={backupsQ.data?.backups ?? []}
          rowKey={(b) => b.volid}
          emptyMessage="No backups found for this guest."
        />
      )}
    </div>
  );
}
