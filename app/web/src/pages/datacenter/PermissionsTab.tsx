import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  ListTree,
  Pencil,
  Plus,
  Server,
  Shield,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { cx } from '../../lib/format';
import {
  Banner,
  CopyField,
  IconBtn,
  Toggle,
  bool01,
  errMsg,
  num,
  str,
  type PveRow,
} from './util';

type SubTab = 'users' | 'groups' | 'roles' | 'acl' | 'tokens' | 'realms';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'users', label: 'Users', icon: UserCog },
  { id: 'groups', label: 'Groups', icon: Users },
  { id: 'roles', label: 'Roles', icon: Shield },
  { id: 'acl', label: 'Permissions', icon: ListTree },
  { id: 'tokens', label: 'API Tokens', icon: KeyRound },
  { id: 'realms', label: 'Realms', icon: Server },
];

export function PermissionsTab() {
  const [sub, setSub] = useState<SubTab>('users');

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSub(t.id)}
              className={cx(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                sub === t.id
                  ? 'bg-accent-500/15 text-accent-400'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      {sub === 'users' && <UsersSection />}
      {sub === 'groups' && <GroupsSection />}
      {sub === 'roles' && <RolesSection />}
      {sub === 'acl' && <AclSection />}
      {sub === 'tokens' && <TokensSection />}
      {sub === 'realms' && <RealmsSection />}
    </div>
  );
}

/* ---------- shared ---------- */

function unixToDate(sec: number): string {
  if (!sec) return '';
  try {
    return new Date(sec * 1000).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}
function dateToUnix(d: string): number {
  if (!d) return 0;
  const ms = Date.parse(d);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

function SectionToolbar({ title, onAdd, addLabel }: { title: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      {onAdd && (
        <button className="btn-primary" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden /> {addLabel}
        </button>
      )}
    </div>
  );
}

/* ---------- Users ---------- */

function UsersSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dc', 'users'], queryFn: () => pve.get<PveRow[]>('/pve/access/users') });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PveRow | null>(null);
  const [toDelete, setToDelete] = useState<PveRow | null>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => pve.del(`/pve/access/users/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'users'] }),
  });

  const columns: Column<PveRow>[] = [
    {
      key: 'userid',
      header: 'User',
      render: (u) => (
        <span className="flex items-center gap-2 font-medium text-zinc-100">
          <UserCog className="h-4 w-4 text-zinc-500" aria-hidden />
          {str(u.userid)}
        </span>
      ),
    },
    {
      key: 'enable',
      header: 'Status',
      render: (u) =>
        bool01(u.enable) || u.enable === undefined ? (
          <Badge tone="success">enabled</Badge>
        ) : (
          <Badge tone="neutral">disabled</Badge>
        ),
    },
    {
      key: 'groups',
      header: 'Groups',
      render: (u) => <span className="text-xs text-zinc-400">{str(u.groups) || '—'}</span>,
    },
    {
      key: 'expire',
      header: 'Expires',
      render: (u) => (
        <span className="text-xs text-zinc-400">{num(u.expire) ? unixToDate(num(u.expire)) : 'never'}</span>
      ),
    },
    { key: 'email', header: 'Email', render: (u) => <span className="text-xs text-zinc-400">{str(u.email) || '—'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-1">
          <IconBtn title="Edit" icon={Pencil} onClick={() => setEditing(u)} />
          <IconBtn
            title="Delete"
            icon={Trash2}
            danger
            disabled={str(u.userid) === 'root@pam'}
            onClick={() => setToDelete(u)}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <SectionToolbar title="Users" onAdd={() => setCreating(true)} addLabel="New user" />
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable
          columns={columns}
          rows={q.data ?? []}
          rowKey={(u) => str(u.userid)}
          emptyMessage={q.isPending ? 'Loading…' : 'No users.'}
        />
      )}
      {(creating || editing) && (
        <UserFormModal existing={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete user"
        message={<>Delete user <strong>{str(toDelete?.userid)}</strong>?</>}
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await delMut.mutateAsync(str(toDelete.userid));
          setToDelete(null);
        }}
      />
    </div>
  );
}

function UserFormModal({ existing, onClose }: { existing: PveRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const domainsQ = useQuery({ queryKey: ['dc', 'domains'], queryFn: () => pve.get<PveRow[]>('/pve/access/domains') });

  const existingId = str(existing?.userid);
  const atIdx = existingId.indexOf('@');
  const [name, setName] = useState(atIdx >= 0 ? existingId.slice(0, atIdx) : '');
  const [realm, setRealm] = useState(atIdx >= 0 ? existingId.slice(atIdx + 1) : 'pam');
  const [password, setPassword] = useState('');
  const [enable, setEnable] = useState(existing ? bool01(existing.enable) || existing.enable === undefined : true);
  const [expire, setExpire] = useState(unixToDate(num(existing?.expire)));
  const [groups, setGroups] = useState(str(existing?.groups));
  const [email, setEmail] = useState(str(existing?.email));
  const [comment, setComment] = useState(str(existing?.comment));
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? pve.put(`/pve/access/users/${encodeURIComponent(existingId)}`, payload)
        : pve.post('/pve/access/users', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dc', 'users'] }); onClose(); },
    onError: (e) => setError(errMsg(e, 'Failed to save user')),
  });

  const onSubmit = () => {
    setError(null);
    if (!isEdit && !name.trim()) return setError('A username is required.');
    const payload: Record<string, unknown> = {
      enable: enable ? 1 : 0,
      expire: dateToUnix(expire),
    };
    if (groups.trim()) payload.groups = groups.trim();
    if (email.trim()) payload.email = email.trim();
    if (comment.trim()) payload.comment = comment.trim();
    if (!isEdit) {
      payload.userid = `${name.trim()}@${realm}`;
      if (password) payload.password = password;
    }
    mut.mutate(payload);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit user · ${existingId}` : 'New user'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Username" required={!isEdit}>
          <input className="input" value={name} disabled={isEdit} onChange={(e) => setName(e.target.value)} placeholder="alice" />
        </FormField>
        <FormField label="Realm">
          <select className="input" value={realm} disabled={isEdit} onChange={(e) => setRealm(e.target.value)}>
            {(domainsQ.data ?? []).map((d) => (
              <option key={str(d.realm)} value={str(d.realm)}>{str(d.realm)}</option>
            ))}
          </select>
        </FormField>
      </div>
      {!isEdit && (
        <FormField label="Password" hint="Required for pve realm users; ignored for pam.">
          <input className="input" type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </FormField>
      )}
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Groups" hint="Comma-separated group IDs.">
          <input className="input" value={groups} onChange={(e) => setGroups(e.target.value)} placeholder="admins" />
        </FormField>
        <FormField label="Expires" hint="Blank = never.">
          <input className="input" type="date" value={expire} onChange={(e) => setExpire(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Email">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </FormField>
      <FormField label="Comment">
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </FormField>
      <Toggle label="Enabled" checked={enable} onChange={setEnable} />
    </Modal>
  );
}

/* ---------- Groups ---------- */

function GroupsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dc', 'groups'], queryFn: () => pve.get<PveRow[]>('/pve/access/groups') });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PveRow | null>(null);
  const [toDelete, setToDelete] = useState<PveRow | null>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => pve.del(`/pve/access/groups/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'groups'] }),
  });

  const columns: Column<PveRow>[] = [
    {
      key: 'groupid',
      header: 'Group',
      render: (g) => (
        <span className="flex items-center gap-2 font-medium text-zinc-100">
          <Users className="h-4 w-4 text-zinc-500" aria-hidden />
          {str(g.groupid)}
        </span>
      ),
    },
    { key: 'members', header: 'Members', render: (g) => <span className="text-xs text-zinc-400">{str(g.users) || '—'}</span> },
    { key: 'comment', header: 'Comment', render: (g) => <span className="text-xs text-zinc-400">{str(g.comment) || '—'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (g) => (
        <div className="flex justify-end gap-1">
          <IconBtn title="Edit" icon={Pencil} onClick={() => setEditing(g)} />
          <IconBtn title="Delete" icon={Trash2} danger onClick={() => setToDelete(g)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <SectionToolbar title="Groups" onAdd={() => setCreating(true)} addLabel="New group" />
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable columns={columns} rows={q.data ?? []} rowKey={(g) => str(g.groupid)} emptyMessage={q.isPending ? 'Loading…' : 'No groups.'} />
      )}
      {(creating || editing) && (
        <GroupFormModal existing={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete group"
        message={<>Delete group <strong>{str(toDelete?.groupid)}</strong>?</>}
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => { if (!toDelete) return; await delMut.mutateAsync(str(toDelete.groupid)); setToDelete(null); }}
      />
    </div>
  );
}

function GroupFormModal({ existing, onClose }: { existing: PveRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const [groupid, setGroupid] = useState(str(existing?.groupid));
  const [comment, setComment] = useState(str(existing?.comment));
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? pve.put(`/pve/access/groups/${encodeURIComponent(groupid)}`, payload)
        : pve.post('/pve/access/groups', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dc', 'groups'] }); onClose(); },
    onError: (e) => setError(errMsg(e, 'Failed to save group')),
  });

  const onSubmit = () => {
    setError(null);
    if (!isEdit && !groupid.trim()) return setError('A group ID is required.');
    const payload: Record<string, unknown> = { comment: comment.trim() };
    if (!isEdit) payload.groupid = groupid.trim();
    mut.mutate(payload);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit group · ${groupid}` : 'New group'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create group'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <FormField label="Group ID" required={!isEdit}>
        <input className="input" value={groupid} disabled={isEdit} onChange={(e) => setGroupid(e.target.value)} placeholder="admins" />
      </FormField>
      <FormField label="Comment">
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </FormField>
    </Modal>
  );
}

/* ---------- Roles ---------- */

function RolesSection() {
  const q = useQuery({ queryKey: ['dc', 'roles'], queryFn: () => pve.get<PveRow[]>('/pve/access/roles') });
  const [viewing, setViewing] = useState<PveRow | null>(null);

  const columns: Column<PveRow>[] = [
    {
      key: 'roleid',
      header: 'Role',
      render: (r) => (
        <span className="flex items-center gap-2 font-medium text-zinc-100">
          <Shield className="h-4 w-4 text-zinc-500" aria-hidden />
          {str(r.roleid)}
        </span>
      ),
    },
    { key: 'special', header: 'Built-in', render: (r) => (bool01(r.special) ? <Badge tone="info">built-in</Badge> : <Badge tone="neutral">custom</Badge>) },
    {
      key: 'privs',
      header: 'Privileges',
      render: (r) => <span className="line-clamp-1 font-mono text-xs text-zinc-400">{str(r.privs) || '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <button className="btn-secondary h-8 px-2 text-xs" onClick={() => setViewing(r)}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> View
        </button>
      ),
    },
  ];

  return (
    <div>
      <SectionToolbar title="Roles" />
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable columns={columns} rows={q.data ?? []} rowKey={(r) => str(r.roleid)} emptyMessage={q.isPending ? 'Loading…' : 'No roles.'} />
      )}
      {viewing && <RolePrivsModal roleid={str(viewing.roleid)} onClose={() => setViewing(null)} />}
    </div>
  );
}

function RolePrivsModal({ roleid, onClose }: { roleid: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['dc', 'role', roleid],
    queryFn: () => pve.get<PveRow>(`/pve/access/roles/${encodeURIComponent(roleid)}`),
  });
  // The endpoint returns a map of priv -> 1 for privileges the role grants.
  const privs = Object.keys(q.data ?? {}).filter((k) => bool01((q.data as PveRow)?.[k])).sort();

  return (
    <Modal open onClose={onClose} title={`Role · ${roleid}`} footer={<button className="btn-secondary" onClick={onClose}>Close</button>}>
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : q.isPending ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : privs.length === 0 ? (
        <p className="text-sm text-zinc-400">This role grants no privileges.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {privs.map((p) => (
            <Badge key={p} tone="neutral">{p}</Badge>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ---------- ACL ---------- */

function AclSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dc', 'acl'], queryFn: () => pve.get<PveRow[]>('/pve/access/acl') });
  const [adding, setAdding] = useState(false);
  const [toRemove, setToRemove] = useState<PveRow | null>(null);

  const removeMut = useMutation({
    mutationFn: (row: PveRow) => {
      const payload: Record<string, unknown> = {
        path: str(row.path),
        roles: str(row.roleid),
        propagate: bool01(row.propagate) ? 1 : 0,
        delete: 1,
      };
      const t = str(row.type);
      if (t === 'group') payload.groups = str(row.ugid);
      else if (t === 'token') payload.tokens = str(row.ugid);
      else payload.users = str(row.ugid);
      return pve.put('/pve/access/acl', payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'acl'] }),
  });

  const columns: Column<PveRow>[] = [
    { key: 'path', header: 'Path', render: (a) => <span className="font-mono text-xs text-zinc-100">{str(a.path)}</span> },
    { key: 'roleid', header: 'Role', render: (a) => <Badge tone="info">{str(a.roleid)}</Badge> },
    { key: 'type', header: 'Type', render: (a) => <Badge tone="neutral">{str(a.type)}</Badge> },
    { key: 'ugid', header: 'User / Group', render: (a) => <span className="text-xs text-zinc-300">{str(a.ugid)}</span> },
    { key: 'propagate', header: 'Propagate', render: (a) => (bool01(a.propagate) ? 'yes' : 'no') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (a) => (
        <div className="flex justify-end">
          <IconBtn title="Remove" icon={Trash2} danger onClick={() => setToRemove(a)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <SectionToolbar title="Permissions (ACL)" onAdd={() => setAdding(true)} addLabel="Add permission" />
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable
          columns={columns}
          rows={q.data ?? []}
          rowKey={(a) => `${str(a.path)}|${str(a.roleid)}|${str(a.type)}|${str(a.ugid)}`}
          emptyMessage={q.isPending ? 'Loading…' : 'No ACL entries.'}
        />
      )}
      {adding && <AclAddModal onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!toRemove}
        title="Remove permission"
        message={
          <>
            Remove <strong>{str(toRemove?.roleid)}</strong> for{' '}
            <strong>{str(toRemove?.ugid)}</strong> on <code>{str(toRemove?.path)}</code>?
          </>
        }
        confirmLabel="Remove"
        busy={removeMut.isPending}
        onCancel={() => setToRemove(null)}
        onConfirm={async () => { if (!toRemove) return; await removeMut.mutateAsync(toRemove); setToRemove(null); }}
      />
    </div>
  );
}

function AclAddModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const rolesQ = useQuery({ queryKey: ['dc', 'roles'], queryFn: () => pve.get<PveRow[]>('/pve/access/roles') });

  const [path, setPath] = useState('/');
  const [role, setRole] = useState('');
  const [kind, setKind] = useState<'user' | 'group' | 'token'>('user');
  const [ugid, setUgid] = useState('');
  const [propagate, setPropagate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const roles = rolesQ.data ?? [];
  const effectiveRole = role || str(roles[0]?.roleid);

  const mut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        path: path.trim(),
        roles: effectiveRole,
        propagate: propagate ? 1 : 0,
      };
      if (kind === 'group') payload.groups = ugid.trim();
      else if (kind === 'token') payload.tokens = ugid.trim();
      else payload.users = ugid.trim();
      return pve.put('/pve/access/acl', payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dc', 'acl'] }); onClose(); },
    onError: (e) => setError(errMsg(e, 'Failed to add permission')),
  });

  const onSubmit = () => {
    setError(null);
    if (!path.trim()) return setError('A path is required.');
    if (!effectiveRole) return setError('Select a role.');
    if (!ugid.trim()) return setError('Enter a user, group or token ID.');
    mut.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add permission"
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
      <FormField label="Path" required hint="e.g. / or /vms/100 or /storage/local.">
        <input className="input" value={path} onChange={(e) => setPath(e.target.value)} />
      </FormField>
      <FormField label="Role" required>
        <select className="input" value={effectiveRole} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={str(r.roleid)} value={str(r.roleid)}>{str(r.roleid)}</option>
          ))}
        </select>
      </FormField>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Member type">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="user">User</option>
            <option value="group">Group</option>
            <option value="token">Token</option>
          </select>
        </FormField>
        <FormField label={kind === 'group' ? 'Group ID' : kind === 'token' ? 'Token ID' : 'User ID'} required>
          <input
            className="input"
            value={ugid}
            onChange={(e) => setUgid(e.target.value)}
            placeholder={kind === 'group' ? 'admins' : kind === 'token' ? 'user@pve!tokenname' : 'alice@pam'}
          />
        </FormField>
      </div>
      <Toggle label="Propagate to sub-paths" checked={propagate} onChange={setPropagate} />
    </Modal>
  );
}

/* ---------- API Tokens ---------- */

function TokensSection() {
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ['dc', 'users'], queryFn: () => pve.get<PveRow[]>('/pve/access/users') });
  const [userid, setUserid] = useState('');
  const effectiveUser = userid || str(usersQ.data?.[0]?.userid);

  const tokensQ = useQuery({
    queryKey: ['dc', 'tokens', effectiveUser],
    queryFn: () => pve.get<PveRow[]>(`/pve/access/users/${encodeURIComponent(effectiveUser)}/token`),
    enabled: !!effectiveUser,
  });

  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [toDelete, setToDelete] = useState<PveRow | null>(null);

  const delMut = useMutation({
    mutationFn: (tokenid: string) =>
      pve.del(`/pve/access/users/${encodeURIComponent(effectiveUser)}/token/${encodeURIComponent(tokenid)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dc', 'tokens', effectiveUser] }),
  });

  const columns: Column<PveRow>[] = [
    {
      key: 'tokenid',
      header: 'Token',
      render: (t) => (
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-100">
          <KeyRound className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
          {str(t.tokenid)}
        </span>
      ),
    },
    { key: 'comment', header: 'Comment', render: (t) => <span className="text-xs text-zinc-400">{str(t.comment) || '—'}</span> },
    { key: 'privsep', header: 'Priv. separation', render: (t) => (bool01(t.privsep) ? 'yes' : 'no') },
    {
      key: 'expire',
      header: 'Expires',
      render: (t) => <span className="text-xs text-zinc-400">{num(t.expire) ? unixToDate(num(t.expire)) : 'never'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => (
        <div className="flex justify-end">
          <IconBtn title="Delete" icon={Trash2} danger onClick={() => setToDelete(t)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-72">
          <label className="label">User</label>
          <select className="input" value={effectiveUser} onChange={(e) => setUserid(e.target.value)}>
            {(usersQ.data ?? []).map((u) => (
              <option key={str(u.userid)} value={str(u.userid)}>{str(u.userid)}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={!effectiveUser} onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden /> New token
        </button>
      </div>

      {tokensQ.isError ? (
        <Banner tone="error">{errMsg(tokensQ.error)}</Banner>
      ) : (
        <DataTable
          columns={columns}
          rows={tokensQ.data ?? []}
          rowKey={(t) => str(t.tokenid)}
          emptyMessage={tokensQ.isPending ? 'Loading…' : 'No tokens for this user.'}
        />
      )}

      {creating && (
        <TokenCreateModal
          userid={effectiveUser}
          onClose={() => setCreating(false)}
          onCreated={(id, value) => { setCreating(false); setSecret({ id, value }); }}
        />
      )}

      <Modal
        open={!!secret}
        onClose={() => setSecret(null)}
        title="API token created"
        footer={<button className="btn-secondary" onClick={() => setSecret(null)}>Done</button>}
      >
        <Banner tone="success">Copy this secret now — it is shown only once and cannot be retrieved later.</Banner>
        <p className="label">Token ID</p>
        <p className="mb-3 font-mono text-xs text-zinc-300">{secret?.id}</p>
        <p className="label">Secret</p>
        <CopyField value={secret?.value ?? ''} />
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete token"
        message={<>Delete token <strong>{str(toDelete?.tokenid)}</strong> for {effectiveUser}?</>}
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => { if (!toDelete) return; await delMut.mutateAsync(str(toDelete.tokenid)); setToDelete(null); }}
      />
    </div>
  );
}

function TokenCreateModal({
  userid,
  onClose,
  onCreated,
}: {
  userid: string;
  onClose: () => void;
  onCreated: (id: string, value: string) => void;
}) {
  const [tokenid, setTokenid] = useState('');
  const [comment, setComment] = useState('');
  const [privsep, setPrivsep] = useState(true);
  const [expire, setExpire] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { privsep: privsep ? 1 : 0 };
      if (comment.trim()) payload.comment = comment.trim();
      if (expire) payload.expire = dateToUnix(expire);
      return pve.post<PveRow>(
        `/pve/access/users/${encodeURIComponent(userid)}/token/${encodeURIComponent(tokenid.trim())}`,
        payload,
      );
    },
    onSuccess: (res) => {
      const id = str(res?.['full-tokenid']) || `${userid}!${tokenid.trim()}`;
      onCreated(id, str(res?.value));
    },
    onError: (e) => setError(errMsg(e, 'Failed to create token')),
  });

  const onSubmit = () => {
    setError(null);
    if (!tokenid.trim()) return setError('A token ID is required.');
    mut.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`New token · ${userid}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Create token'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <FormField label="Token ID" required>
        <input className="input" value={tokenid} onChange={(e) => setTokenid(e.target.value)} placeholder="automation" />
      </FormField>
      <FormField label="Comment">
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </FormField>
      <FormField label="Expires" hint="Blank = never.">
        <input className="input" type="date" value={expire} onChange={(e) => setExpire(e.target.value)} />
      </FormField>
      <Toggle
        label="Privilege separation (token limited to its own ACLs)"
        checked={privsep}
        onChange={setPrivsep}
      />
    </Modal>
  );
}

/* ---------- Realms ---------- */

function RealmsSection() {
  const q = useQuery({ queryKey: ['dc', 'domains'], queryFn: () => pve.get<PveRow[]>('/pve/access/domains') });

  const columns: Column<PveRow>[] = [
    {
      key: 'realm',
      header: 'Realm',
      render: (d) => (
        <span className="flex items-center gap-2 font-medium text-zinc-100">
          <Server className="h-4 w-4 text-zinc-500" aria-hidden />
          {str(d.realm)}
        </span>
      ),
    },
    { key: 'type', header: 'Type', render: (d) => <Badge tone="info">{str(d.type)}</Badge> },
    { key: 'comment', header: 'Comment', render: (d) => <span className="text-xs text-zinc-400">{str(d.comment) || '—'}</span> },
  ];

  return (
    <div>
      <SectionToolbar title="Authentication realms" />
      {q.isError ? (
        <Banner tone="error">{errMsg(q.error)}</Banner>
      ) : (
        <DataTable columns={columns} rows={q.data ?? []} rowKey={(d) => str(d.realm)} emptyMessage={q.isPending ? 'Loading…' : 'No realms.'} />
      )}
    </div>
  );
}
