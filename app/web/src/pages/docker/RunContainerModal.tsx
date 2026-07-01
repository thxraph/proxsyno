import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import type { Guest } from '../../lib/types';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import type { RunContainerInput, RunPortInput, RunVolumeInput, RunEnvInput } from './types';

const IMAGE_RE = /^[a-z0-9][a-z0-9._/:@-]*$/;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type PortRow = { hostPort: string; containerPort: string; proto: 'tcp' | 'udp' };
type VolumeRow = { hostPath: string; containerPath: string; readOnly: boolean };
type EnvRow = { key: string; value: string };

export function RunContainerModal({ guest, onClose }: { guest: Guest; onClose: () => void }) {
  const qc = useQueryClient();

  const [image, setImage] = useState('');
  const [name, setName] = useState('');
  const [restart, setRestart] = useState('');
  const [network, setNetwork] = useState('');
  const [command, setCommand] = useState('');
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [volumes, setVolumes] = useState<VolumeRow[]>([]);
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: RunContainerInput) =>
      api.post<{ id: string }>(`/docker/${guest.type}/${guest.vmid}/containers`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['docker', 'containers', guest.type, guest.vmid] });
      onClose();
    },
    onError: (e) => setSubmitError(errMsg(e, 'Failed to create container')),
  });

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!IMAGE_RE.test(image.trim())) next.image = 'A valid image reference is required (e.g. nginx:latest).';
    if (name.trim() && !NAME_RE.test(name.trim())) next.name = 'Letters, digits, dot, dash, underscore.';
    ports.forEach((p, i) => {
      const h = Number(p.hostPort);
      const c = Number(p.containerPort);
      if (!(h >= 1 && h <= 65535) || !(c >= 1 && c <= 65535)) next[`port${i}`] = 'Ports must be 1–65535.';
    });
    volumes.forEach((v, i) => {
      if (!v.hostPath.startsWith('/') || !v.containerPath.startsWith('/'))
        next[`vol${i}`] = 'Both paths must be absolute.';
    });
    env.forEach((e, i) => {
      if (!ENV_KEY_RE.test(e.key)) next[`env${i}`] = 'Invalid variable name.';
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = () => {
    setSubmitError(null);
    if (!validate()) return;
    const payload: RunContainerInput = { image: image.trim() };
    if (name.trim()) payload.name = name.trim();
    if (restart) payload.restart = restart as RunContainerInput['restart'];
    if (network.trim()) payload.network = network.trim();
    const cmd = command.trim().split(/\s+/).filter(Boolean);
    if (cmd.length) payload.command = cmd;
    if (ports.length)
      payload.ports = ports.map<RunPortInput>((p) => ({
        hostPort: Number(p.hostPort),
        containerPort: Number(p.containerPort),
        proto: p.proto,
      }));
    if (volumes.length)
      payload.volumes = volumes.map<RunVolumeInput>((v) => ({
        hostPath: v.hostPath.trim(),
        containerPath: v.containerPath.trim(),
        readOnly: v.readOnly,
      }));
    if (env.length)
      payload.env = env.map<RunEnvInput>((e) => ({ key: e.key.trim(), value: e.value }));
    mut.mutate(payload);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Run container · ${guest.name || `guest-${guest.vmid}`}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Run container'}
          </button>
        </>
      }
    >
      {submitError && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {submitError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Image" required error={errors.image}>
          <input className="input" value={image} onChange={(e) => setImage(e.target.value)} placeholder="nginx:latest" />
        </FormField>
        <FormField label="Name" error={errors.name} hint="Optional.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label="Restart policy">
          <select className="input" value={restart} onChange={(e) => setRestart(e.target.value)}>
            <option value="">Default (no)</option>
            <option value="always">always</option>
            <option value="unless-stopped">unless-stopped</option>
            <option value="on-failure">on-failure</option>
          </select>
        </FormField>
        <FormField label="Network" hint="Optional — e.g. host or a user network.">
          <input className="input" value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="bridge" />
        </FormField>
      </div>

      <RepeatableSection
        label="Port mappings"
        rows={ports}
        onAdd={() => setPorts((p) => [...p, { hostPort: '', containerPort: '', proto: 'tcp' }])}
        onRemove={(i) => setPorts((p) => p.filter((_, idx) => idx !== i))}
        render={(row, i) => (
          <>
            <input
              className="input"
              type="number"
              placeholder="host"
              value={row.hostPort}
              onChange={(e) => setPorts((p) => patch(p, i, { hostPort: e.target.value }))}
            />
            <input
              className="input"
              type="number"
              placeholder="container"
              value={row.containerPort}
              onChange={(e) => setPorts((p) => patch(p, i, { containerPort: e.target.value }))}
            />
            <select
              className="input w-24"
              value={row.proto}
              onChange={(e) => setPorts((p) => patch(p, i, { proto: e.target.value as 'tcp' | 'udp' }))}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
          </>
        )}
        error={(i) => errors[`port${i}`]}
      />

      <RepeatableSection
        label="Volume mounts"
        rows={volumes}
        onAdd={() => setVolumes((v) => [...v, { hostPath: '', containerPath: '', readOnly: false }])}
        onRemove={(i) => setVolumes((v) => v.filter((_, idx) => idx !== i))}
        render={(row, i) => (
          <>
            <input
              className="input"
              placeholder="/host/path"
              value={row.hostPath}
              onChange={(e) => setVolumes((v) => patch(v, i, { hostPath: e.target.value }))}
            />
            <input
              className="input"
              placeholder="/container/path"
              value={row.containerPath}
              onChange={(e) => setVolumes((v) => patch(v, i, { containerPath: e.target.value }))}
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                checked={row.readOnly}
                onChange={(e) => setVolumes((v) => patch(v, i, { readOnly: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
              />
              ro
            </label>
          </>
        )}
        error={(i) => errors[`vol${i}`]}
      />

      <RepeatableSection
        label="Environment variables"
        rows={env}
        onAdd={() => setEnv((e) => [...e, { key: '', value: '' }])}
        onRemove={(i) => setEnv((e) => e.filter((_, idx) => idx !== i))}
        render={(row, i) => (
          <>
            <input
              className="input"
              placeholder="KEY"
              value={row.key}
              onChange={(e) => setEnv((v) => patch(v, i, { key: e.target.value }))}
            />
            <input
              className="input"
              placeholder="value"
              value={row.value}
              onChange={(e) => setEnv((v) => patch(v, i, { value: e.target.value }))}
            />
          </>
        )}
        error={(i) => errors[`env${i}`]}
      />

      <FormField label="Command" hint="Optional — overrides the image's default command (space-separated).">
        <input className="input" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="" />
      </FormField>
    </Modal>
  );
}

function patch<T>(rows: T[], i: number, change: Partial<T>): T[] {
  return rows.map((r, idx) => (idx === i ? { ...r, ...change } : r));
}

function RepeatableSection<T>({
  label,
  rows,
  onAdd,
  onRemove,
  render,
  error,
}: {
  label: string;
  rows: T[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  render: (row: T, i: number) => ReactNode;
  error: (i: number) => string | undefined;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label mb-0">{label}</span>
        <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">None.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                {render(row, i)}
                <button
                  type="button"
                  className="btn-ghost h-8 w-8 shrink-0 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                  onClick={() => onRemove(i)}
                  aria-label="Remove"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {error(i) && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error(i)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
