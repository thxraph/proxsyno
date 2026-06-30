import { lazy, Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  Container,
  MonitorPlay,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Square,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type {
  Guest,
  GuestAction,
  LxcCreateInput,
  ProxmoxAvailable,
  ProxmoxOptions,
  ScriptMeta,
  VmCreateInput,
} from '../lib/types';
import { cx, formatBytes, formatUptime } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { ProgressBar } from '../components/ProgressBar';
// xterm is heavy and only needed when a community-script console opens — code-split it.
const Terminal = lazy(() =>
  import('../components/Terminal').then((m) => ({ default: m.Terminal })),
);
import { Toggle } from './Shares';

const GUESTS_REFETCH_MS = 5000;

// Actions that change a running guest in a disruptive way → confirm first.
const CONFIRM_ACTIONS: GuestAction[] = ['stop', 'reboot', 'shutdown'];

export function Virtualization() {
  const availQ = useQuery({
    queryKey: ['proxmox', 'available'],
    queryFn: () => api.get<ProxmoxAvailable>('/proxmox/available'),
    staleTime: 60_000,
  });

  const [activeScript, setActiveScript] = useState<ScriptMeta | null>(null);

  if (availQ.isLoading) {
    return (
      <div>
        <PageHeader title="Virtualization" description="VMs, containers and community scripts" />
        <LoadingState label="Checking for Proxmox…" />
      </div>
    );
  }

  if (availQ.isError) {
    return (
      <div>
        <PageHeader title="Virtualization" description="VMs, containers and community scripts" />
        <ErrorState error={availQ.error} onRetry={() => availQ.refetch()} />
      </div>
    );
  }

  if (!availQ.data?.isProxmox) {
    return (
      <div>
        <PageHeader title="Virtualization" description="VMs, containers and community scripts" />
        <EmptyState
          icon={Server}
          title="Proxmox not detected"
          message="This host is not running Proxmox VE (qm / pct were not found), so virtualization management is unavailable."
        />
      </div>
    );
  }

  // Active community-script terminal takes over the page until closed.
  if (activeScript) {
    return (
      <div>
        <PageHeader
          title="Virtualization"
          description="Running community script"
          actions={
            <button className="btn-secondary" onClick={() => setActiveScript(null)}>
              Back to guests
            </button>
          }
        />
        <Suspense fallback={<div className="p-4 text-sm text-zinc-400">Loading terminal…</div>}>
          <Terminal
            slug={activeScript.slug}
            name={activeScript.name}
            onClose={() => setActiveScript(null)}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <GuestsView
      node={availQ.data.node}
      pveVersion={availQ.data.pveVersion}
      onLaunchScript={setActiveScript}
    />
  );
}

function GuestsView({
  node,
  pveVersion,
  onLaunchScript,
}: {
  node: string;
  pveVersion?: string;
  onLaunchScript: (s: ScriptMeta) => void;
}) {
  const qc = useQueryClient();
  const guestsQ = useQuery({
    queryKey: ['proxmox', 'guests'],
    queryFn: () => api.get<Guest[]>('/proxmox/guests'),
    refetchInterval: GUESTS_REFETCH_MS,
  });

  const [creating, setCreating] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ guest: Guest; action: GuestAction } | null>(
    null,
  );

  const actionMut = useMutation({
    mutationFn: ({ guest, action }: { guest: Guest; action: GuestAction }) =>
      api.post<{ ok: true }>(
        `/proxmox/guests/${guest.type}/${guest.vmid}/${action}`,
        undefined,
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ['proxmox', 'guests'] }),
  });

  const runAction = (guest: Guest, action: GuestAction) => {
    if (CONFIRM_ACTIONS.includes(action)) {
      setPendingAction({ guest, action });
    } else {
      actionMut.mutate({ guest, action });
    }
  };

  const columns: Column<Guest>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (g) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          {g.type === 'qemu' ? (
            <MonitorPlay className="h-4 w-4 text-slate-400" />
          ) : (
            <Container className="h-4 w-4 text-slate-400" />
          )}
          {g.name || `guest-${g.vmid}`}
          {g.template && <Badge tone="neutral">template</Badge>}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (g) => (
        <Badge tone={g.type === 'qemu' ? 'accent' : 'info'}>
          {g.type === 'qemu' ? 'VM' : 'LXC'}
        </Badge>
      ),
    },
    {
      key: 'vmid',
      header: 'VMID',
      align: 'right',
      render: (g) => <span className="tabular-nums">{g.vmid}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (g) => <StatusBadge status={g.status} />,
    },
    {
      key: 'cpu',
      header: 'CPU',
      render: (g) => (
        <div className="w-32">
          <ProgressBar value={g.cpu * 100} showLabel autoTone />
        </div>
      ),
    },
    {
      key: 'mem',
      header: 'Memory',
      render: (g) => (
        <div className="w-40">
          <ProgressBar value={g.maxmem ? (g.mem / g.maxmem) * 100 : 0} showLabel autoTone />
          <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
            {formatBytes(g.mem)} / {formatBytes(g.maxmem)}
          </p>
        </div>
      ),
    },
    {
      key: 'uptime',
      header: 'Uptime',
      render: (g) =>
        g.status === 'running' ? (
          <span className="tabular-nums text-xs">{formatUptime(g.uptimeSec)}</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (g) => <GuestActions guest={g} onAction={runAction} busy={actionMut.isPending} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Virtualization"
        description={`Node ${node}${pveVersion ? ` · PVE ${pveVersion}` : ''}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => guestsQ.refetch()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Create
            </button>
          </>
        }
      />

      {guestsQ.isLoading ? (
        <LoadingState label="Loading guests…" />
      ) : guestsQ.isError ? (
        <ErrorState error={guestsQ.error} onRetry={() => guestsQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={guestsQ.data ?? []}
          rowKey={(g) => `${g.type}-${g.vmid}`}
          emptyMessage="No VMs or containers yet. Create one to get started."
        />
      )}

      {creating && (
        <CreateWizard
          onClose={() => setCreating(false)}
          onLaunchScript={(s) => {
            setCreating(false);
            onLaunchScript(s);
          }}
        />
      )}

      <ConfirmDialog
        open={!!pendingAction}
        title={pendingAction ? `${actionTitle(pendingAction.action)} guest` : ''}
        message={
          pendingAction ? (
            <>
              {actionTitle(pendingAction.action)} <strong>{pendingAction.guest.name}</strong> (
              {pendingAction.guest.type === 'qemu' ? 'VM' : 'LXC'} {pendingAction.guest.vmid})?
            </>
          ) : (
            ''
          )
        }
        confirmLabel={pendingAction ? actionTitle(pendingAction.action) : 'Confirm'}
        busy={actionMut.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction) return;
          await actionMut.mutateAsync(pendingAction);
          setPendingAction(null);
        }}
      />
    </div>
  );
}

function actionTitle(a: GuestAction): string {
  return a.charAt(0).toUpperCase() + a.slice(1);
}

function StatusBadge({ status }: { status: Guest['status'] }) {
  const tone =
    status === 'running' ? 'success' : status === 'paused' ? 'warning' : status === 'stopped' ? 'neutral' : 'danger';
  return <Badge tone={tone}>{status}</Badge>;
}

function GuestActions({
  guest,
  onAction,
  busy,
}: {
  guest: Guest;
  onAction: (g: Guest, a: GuestAction) => void;
  busy: boolean;
}) {
  const running = guest.status === 'running';
  return (
    <div className="flex justify-end gap-1">
      {running ? (
        <>
          <IconAction
            title="Reboot"
            disabled={busy}
            onClick={() => onAction(guest, 'reboot')}
            icon={RotateCcw}
          />
          <IconAction
            title="Shutdown"
            disabled={busy}
            onClick={() => onAction(guest, 'shutdown')}
            icon={Power}
          />
          <IconAction
            title="Stop"
            disabled={busy}
            danger
            onClick={() => onAction(guest, 'stop')}
            icon={Square}
          />
        </>
      ) : (
        <IconAction
          title="Start"
          disabled={busy}
          onClick={() => onAction(guest, 'start')}
          icon={Play}
        />
      )}
    </div>
  );
}

function IconAction({
  title,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  title: string;
  icon: typeof Play;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'btn-ghost h-8 w-8 p-0',
        danger && 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/* ------------------------------ create wizard ----------------------------- */

type WizardTab = 'vm' | 'lxc' | 'script';

function CreateWizard({
  onClose,
  onLaunchScript,
}: {
  onClose: () => void;
  onLaunchScript: (s: ScriptMeta) => void;
}) {
  const [tab, setTab] = useState<WizardTab>('vm');

  const optionsQ = useQuery({
    queryKey: ['proxmox', 'options'],
    queryFn: () => api.get<ProxmoxOptions>('/proxmox/options'),
    enabled: tab === 'vm' || tab === 'lxc',
    staleTime: 30_000,
  });

  return (
    <Modal open onClose={onClose} size="lg" title="Create guest">
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        <WizardTabButton active={tab === 'vm'} onClick={() => setTab('vm')} icon={MonitorPlay} label="Virtual Machine" />
        <WizardTabButton active={tab === 'lxc'} onClick={() => setTab('lxc')} icon={Boxes} label="LXC Container" />
        <WizardTabButton active={tab === 'script'} onClick={() => setTab('script')} icon={TerminalIcon} label="Community Script" />
      </div>

      {tab === 'script' ? (
        <ScriptTab onLaunch={onLaunchScript} />
      ) : optionsQ.isLoading ? (
        <LoadingState label="Loading Proxmox options…" />
      ) : optionsQ.isError ? (
        <ErrorState error={optionsQ.error} onRetry={() => optionsQ.refetch()} />
      ) : optionsQ.data ? (
        tab === 'vm' ? (
          <VmForm options={optionsQ.data} onClose={onClose} />
        ) : (
          <LxcForm options={optionsQ.data} onClose={onClose} />
        )
      ) : null}
    </Modal>
  );
}

function WizardTabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof MonitorPlay;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
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

function SubmitError({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
      {message}
    </div>
  );
}

// Storages capable of holding a given content type.
function storagesFor(options: ProxmoxOptions, content: string) {
  return options.storages.filter((s) => s.content.includes(content));
}

/* --------------------------------- VM form -------------------------------- */

function VmForm({ options, onClose }: { options: ProxmoxOptions; onClose: () => void }) {
  const qc = useQueryClient();
  const imageStorages = useMemo(() => storagesFor(options, 'images'), [options]);

  const [name, setName] = useState('');
  const [cores, setCores] = useState('1');
  const [memoryMB, setMemoryMB] = useState('2048');
  const [diskGB, setDiskGB] = useState('32');
  const [storage, setStorage] = useState(imageStorages[0]?.name ?? '');
  const [isoVolid, setIsoVolid] = useState('');
  const [bridge, setBridge] = useState(options.bridges[0]?.name ?? '');
  const [ostype, setOstype] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: VmCreateInput) => api.post<{ vmid: number }>('/proxmox/vm', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proxmox', 'guests'] });
      onClose();
    },
    onError: (e) => setSubmitError(e instanceof ApiError ? e.message : 'Failed to create VM'),
  });

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'A name is required.';
    if (!(Number(cores) >= 1)) next.cores = 'At least 1 core.';
    if (!(Number(memoryMB) >= 16)) next.memoryMB = 'At least 16 MB.';
    if (!(Number(diskGB) >= 1)) next.diskGB = 'At least 1 GB.';
    if (!storage) next.storage = 'Select a storage.';
    if (!bridge) next.bridge = 'Select a bridge.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = () => {
    setSubmitError(null);
    if (!validate()) return;
    const payload: VmCreateInput = {
      name: name.trim(),
      cores: Number(cores),
      memoryMB: Number(memoryMB),
      diskGB: Number(diskGB),
      storage,
      bridge,
    };
    if (isoVolid) payload.isoVolid = isoVolid;
    if (ostype) payload.ostype = ostype;
    mut.mutate(payload);
  };

  return (
    <div>
      {submitError && <SubmitError message={submitError} />}

      <FormField label="Name" required error={errors.name}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-vm" />
      </FormField>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        <FormField label="Cores" required error={errors.cores}>
          <input className="input" type="number" min={1} value={cores} onChange={(e) => setCores(e.target.value)} />
        </FormField>
        <FormField label="RAM (MB)" required error={errors.memoryMB}>
          <input className="input" type="number" min={16} step={16} value={memoryMB} onChange={(e) => setMemoryMB(e.target.value)} />
        </FormField>
        <FormField label="Disk (GB)" required error={errors.diskGB}>
          <input className="input" type="number" min={1} value={diskGB} onChange={(e) => setDiskGB(e.target.value)} />
        </FormField>
      </div>

      <FormField label="Storage" required error={errors.storage} hint="Where the VM disk is created.">
        <select className="input" value={storage} onChange={(e) => setStorage(e.target.value)}>
          {imageStorages.length === 0 && <option value="">No image-capable storage</option>}
          {imageStorages.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({formatBytes(s.availBytes)} free)
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Installation ISO" hint="Optional — mounted as a CD-ROM for install.">
        <select className="input" value={isoVolid} onChange={(e) => setIsoVolid(e.target.value)}>
          <option value="">No ISO</option>
          {options.isos.map((iso) => (
            <option key={iso.volid} value={iso.volid}>
              {iso.volid} ({formatBytes(iso.sizeBytes)})
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Network bridge" required error={errors.bridge}>
          <select className="input" value={bridge} onChange={(e) => setBridge(e.target.value)}>
            {options.bridges.length === 0 && <option value="">No bridges</option>}
            {options.bridges.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="OS type" hint="Optional.">
          <select className="input" value={ostype} onChange={(e) => setOstype(e.target.value)}>
            <option value="">Default</option>
            {options.osTypes.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
        <p className="text-xs text-slate-400">Next VMID: {options.nextId}</p>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Create VM'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- LXC form -------------------------------- */

const HOSTNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;

function LxcForm({ options, onClose }: { options: ProxmoxOptions; onClose: () => void }) {
  const qc = useQueryClient();
  const rootfsStorages = useMemo(() => storagesFor(options, 'rootdir'), [options]);

  const [hostname, setHostname] = useState('');
  const [templateVolid, setTemplateVolid] = useState(options.templates[0]?.volid ?? '');
  const [cores, setCores] = useState('1');
  const [memoryMB, setMemoryMB] = useState('512');
  const [diskGB, setDiskGB] = useState('8');
  const [storage, setStorage] = useState(rootfsStorages[0]?.name ?? '');
  const [bridge, setBridge] = useState(options.bridges[0]?.name ?? '');
  const [password, setPassword] = useState('');
  const [unprivileged, setUnprivileged] = useState(true);
  const [startOnCreate, setStartOnCreate] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: LxcCreateInput) => api.post<{ vmid: number }>('/proxmox/lxc', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proxmox', 'guests'] });
      onClose();
    },
    onError: (e) => setSubmitError(e instanceof ApiError ? e.message : 'Failed to create container'),
  });

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!HOSTNAME_RE.test(hostname)) next.hostname = 'Letters, digits and dashes; 1–63 chars.';
    if (!templateVolid) next.templateVolid = 'Select a template.';
    if (!(Number(cores) >= 1)) next.cores = 'At least 1 core.';
    if (!(Number(memoryMB) >= 16)) next.memoryMB = 'At least 16 MB.';
    if (!(Number(diskGB) >= 1)) next.diskGB = 'At least 1 GB.';
    if (!storage) next.storage = 'Select a storage.';
    if (!bridge) next.bridge = 'Select a bridge.';
    if (password.length < 5) next.password = 'At least 5 characters.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = () => {
    setSubmitError(null);
    if (!validate()) return;
    mut.mutate({
      hostname: hostname.trim(),
      templateVolid,
      cores: Number(cores),
      memoryMB: Number(memoryMB),
      diskGB: Number(diskGB),
      storage,
      bridge,
      password,
      unprivileged,
      startOnCreate,
    });
  };

  return (
    <div>
      {submitError && <SubmitError message={submitError} />}

      <FormField label="Hostname" required error={errors.hostname}>
        <input className="input" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="my-container" />
      </FormField>

      <FormField label="Template" required error={errors.templateVolid} hint="OS template (downloaded via pveam).">
        <select className="input" value={templateVolid} onChange={(e) => setTemplateVolid(e.target.value)}>
          {options.templates.length === 0 && <option value="">No templates available</option>}
          {options.templates.map((t) => (
            <option key={t.volid} value={t.volid}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        <FormField label="Cores" required error={errors.cores}>
          <input className="input" type="number" min={1} value={cores} onChange={(e) => setCores(e.target.value)} />
        </FormField>
        <FormField label="RAM (MB)" required error={errors.memoryMB}>
          <input className="input" type="number" min={16} step={16} value={memoryMB} onChange={(e) => setMemoryMB(e.target.value)} />
        </FormField>
        <FormField label="Disk (GB)" required error={errors.diskGB}>
          <input className="input" type="number" min={1} value={diskGB} onChange={(e) => setDiskGB(e.target.value)} />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Storage" required error={errors.storage}>
          <select className="input" value={storage} onChange={(e) => setStorage(e.target.value)}>
            {rootfsStorages.length === 0 && <option value="">No rootdir-capable storage</option>}
            {rootfsStorages.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({formatBytes(s.availBytes)} free)
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Network bridge" required error={errors.bridge}>
          <select className="input" value={bridge} onChange={(e) => setBridge(e.target.value)}>
            {options.bridges.length === 0 && <option value="">No bridges</option>}
            {options.bridges.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Root password" required error={errors.password} hint="Used for the container root account.">
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </FormField>

      <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
        <Toggle label="Unprivileged container" checked={unprivileged} onChange={setUnprivileged} />
        <Toggle label="Start after create" checked={startOnCreate} onChange={setStartOnCreate} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
        <p className="text-xs text-slate-400">Next VMID: {options.nextId}</p>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Create container'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- script tab ------------------------------- */

function ScriptTab({ onLaunch }: { onLaunch: (s: ScriptMeta) => void }) {
  const scriptsQ = useQuery({
    queryKey: ['proxmox', 'scripts'],
    queryFn: () => api.get<ScriptMeta[]>('/proxmox/scripts'),
    staleTime: 6 * 60 * 60 * 1000,
  });

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<ScriptMeta | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of scriptsQ.data ?? []) if (s.category) set.add(s.category);
    return Array.from(set).sort();
  }, [scriptsQ.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (scriptsQ.data ?? []).filter((s) => {
      if (category && s.category !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [scriptsQ.data, query, category]);

  if (selected) {
    return (
      <div>
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                ⚠ This runs as root on the host
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300/90">
                The selected community script is fetched and executed with full root privileges on
                this Proxmox host. Only proceed if you trust the source.
              </p>
            </div>
          </div>
        </div>

        <div className="mb-4 space-y-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Script</p>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{selected.name}</p>
          </div>
          {selected.description && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Description</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">{selected.description}</p>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Source URL</p>
            <a
              href={selected.url}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all font-mono text-xs text-accent-600 hover:underline dark:text-accent-400"
            >
              {selected.url}
            </a>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <button className="btn-secondary" onClick={() => setSelected(null)}>
            Back
          </button>
          <button className="btn-primary" onClick={() => onLaunch(selected)}>
            <TerminalIcon className="h-4 w-4" /> Run in terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scripts…"
          />
        </div>
        {categories.length > 0 && (
          <select
            className="input sm:w-48"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {scriptsQ.isLoading ? (
        <LoadingState label="Loading script catalog…" />
      ) : scriptsQ.isError ? (
        <ErrorState error={scriptsQ.error} onRetry={() => scriptsQ.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No scripts found" message="Try a different search term." />
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5 dark:border-slate-800">
          {filtered.map((s) => (
            <li key={s.slug}>
              <button
                type="button"
                onClick={() => setSelected(s)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {s.name}
                  </span>
                  {s.category && <Badge tone="neutral">{s.category}</Badge>}
                </span>
                {s.description && (
                  <span className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                    {s.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
