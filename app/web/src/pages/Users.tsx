import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UserCog, Users as UsersIcon } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { Group, NasUser, UserCreateInput, UserUpdateInput } from '../lib/types';
import { cx } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, LoadingState } from '../components/states';
import { Toggle } from './Shares';

const USERNAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$/;

export function Users() {
  const qc = useQueryClient();
  const usersQ = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<NasUser[]>('/users'),
  });
  const groupsQ = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get<Group[]>('/groups'),
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<NasUser | null>(null);
  const [toDelete, setToDelete] = useState<NasUser | null>(null);
  const [deleteHome, setDeleteHome] = useState(false);

  const delMut = useMutation({
    mutationFn: ({ name, home }: { name: string; home: boolean }) =>
      api.del<void>(`/users/${encodeURIComponent(name)}?deleteHome=${home}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const columns: Column<NasUser>[] = [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          <UserCog className="h-4 w-4 text-slate-400" />
          {u.name}
        </span>
      ),
    },
    { key: 'uid', header: 'UID', align: 'right', render: (u) => <span className="tabular-nums">{u.uid}</span> },
    {
      key: 'groups',
      header: 'Groups',
      render: (u) =>
        u.groups.length ? (
          <div className="flex flex-wrap gap-1">
            {u.groups.map((g) => (
              <Badge key={g} tone="neutral">
                {g}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: 'samba',
      header: 'SMB',
      render: (u) => (u.hasSamba ? <Badge tone="success">Enabled</Badge> : <Badge tone="neutral">Off</Badge>),
    },
    {
      key: 'home',
      header: 'Home',
      render: (u) => (
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{u.home}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost h-8 w-8 p-0" onClick={() => setEditing(u)} title="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost h-8 w-8 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            onClick={() => {
              setDeleteHome(false);
              setToDelete(u);
            }}
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
      <PageHeader
        title="Users"
        description="NAS accounts and group membership"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New user
          </button>
        }
      />

      {usersQ.isLoading ? (
        <LoadingState label="Loading users…" />
      ) : usersQ.isError ? (
        <ErrorState error={usersQ.error} onRetry={() => usersQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={usersQ.data ?? []}
          rowKey={(u) => u.name}
          emptyMessage="No NAS users yet."
        />
      )}

      {(creating || editing) && (
        <UserFormModal
          user={editing}
          groups={groupsQ.data ?? []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete user"
        message={
          <div className="space-y-3">
            <p>
              Delete the account <strong>{toDelete?.name}</strong>?
            </p>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={deleteHome}
                onChange={(e) => setDeleteHome(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
              />
              Also delete the home directory
            </label>
          </div>
        }
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await delMut.mutateAsync({ name: toDelete.name, home: deleteHome });
          setToDelete(null);
        }}
      />
    </div>
  );
}

function UserFormModal({
  user,
  groups,
  onClose,
}: {
  user: NasUser | null;
  groups: Group[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!user;
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>(user?.groups ?? []);
  const [sambaEnabled, setSambaEnabled] = useState(user?.hasSamba ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: UserCreateInput | UserUpdateInput) =>
      isEdit
        ? api.put<void>(`/users/${encodeURIComponent(user!.name)}`, payload)
        : api.post<void>('/users', payload as UserCreateInput),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) => setSubmitError(e instanceof ApiError ? e.message : 'Failed to save user'),
  });

  const toggleGroup = (g: string) =>
    setSelectedGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!isEdit && !USERNAME_RE.test(name))
      next.name = 'Letters, digits, underscore and dash; 1–32 chars.';
    if (!isEdit && password.length < 1) next.password = 'A password is required for new users.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = () => {
    setSubmitError(null);
    if (!validate()) return;
    if (isEdit) {
      const payload: UserUpdateInput = {
        groups: selectedGroups,
        sambaEnabled,
      };
      if (password) payload.password = password;
      mut.mutate(payload);
    } else {
      const payload: UserCreateInput = {
        name: name.trim(),
        password,
        groups: selectedGroups,
        sambaEnabled,
      };
      mut.mutate(payload);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit user · ${user!.name}` : 'New user'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
          </button>
        </>
      }
    >
      {submitError && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {submitError}
        </div>
      )}

      <FormField label="Username" required={!isEdit} error={errors.name}>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isEdit}
          placeholder="alice"
        />
      </FormField>

      <FormField
        label={isEdit ? 'New password' : 'Password'}
        required={!isEdit}
        error={errors.password}
        hint={isEdit ? 'Leave blank to keep the current password.' : undefined}
      >
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </FormField>

      <FormField label="Groups" hint="Select the supplementary groups this user belongs to.">
        {groups.length === 0 ? (
          <p className="text-sm text-slate-400">No groups available.</p>
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {groups.map((g) => {
                const active = selectedGroups.includes(g.name);
                return (
                  <button
                    type="button"
                    key={g.name}
                    onClick={() => toggleGroup(g.name)}
                    className={cx(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      active
                        ? 'bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-400'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                  >
                    <span
                      className={cx(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        active
                          ? 'border-accent-500 bg-accent-500 text-white'
                          : 'border-slate-300 dark:border-slate-600',
                      )}
                    >
                      {active && <UsersIcon className="h-2.5 w-2.5" />}
                    </span>
                    <span className="truncate">{g.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </FormField>

      <div className="mt-2">
        <Toggle label="Enable SMB access (smbpasswd)" checked={sambaEnabled} onChange={setSambaEnabled} />
      </div>
    </Modal>
  );
}
