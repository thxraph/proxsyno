import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { pve, errMsg } from '../../api/client';
import type { GuestRef, PveConfig } from '../../lib/types';
import { FormField } from '../../components/FormField';
import { Toggle } from '../Shares';
import { ErrorState, LoadingState } from '../../components/states';
import { cx } from '../../lib/format';
import { guestBase, guestKey, cfgStr, cfgBool } from './util';

export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'toggle' | 'select';
  options?: string[];
  hint?: string;
  // Toggle stores Proxmox `1`/`0`; placeholder for text/number inputs.
  placeholder?: string;
}

interface ConfigEditorProps {
  guest: GuestRef;
  fields: FieldDef[];
  // Render read-only extras (hardware lines, raw keys) below the editable form.
  renderExtra?: (config: PveConfig, editableKeys: Set<string>) => ReactNode;
}

export function ConfigEditor({ guest, fields, renderExtra }: ConfigEditorProps) {
  const qc = useQueryClient();
  const cfgQ = useQuery({
    queryKey: guestKey(guest, 'config'),
    queryFn: () => pve.get<PveConfig>(`${guestBase(guest)}/config`),
  });

  // Draft holds string values for edited keys only (toggles store '1'/'0').
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const config = cfgQ.data ?? {};
  const editableKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);

  const original = (key: string): string => cfgStr(config[key]);
  const value = (key: string): string => (key in draft ? draft[key] : original(key));
  const set = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v }));

  const changed = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(draft)) {
      if (draft[key] !== original(key)) out[key] = draft[key];
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, config]);

  const dirty = Object.keys(changed).length > 0;

  const mut = useMutation({
    mutationFn: (payload: Record<string, string>) =>
      pve.put(`${guestBase(guest)}/config`, payload),
    onSuccess: () => {
      setDraft({});
      qc.invalidateQueries({ queryKey: guestKey(guest, 'config') });
    },
    onError: (e) => setSubmitError(errMsg(e, 'Failed to save config')),
  });

  if (cfgQ.isLoading) return <LoadingState label="Loading config…" />;
  if (cfgQ.isError) return <ErrorState error={cfgQ.error} onRetry={() => cfgQ.refetch()} />;

  return (
    <div className="card p-5">
      {submitError && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {submitError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {fields.map((f) => (
          <FormField key={f.key} label={f.label} hint={f.hint}>
            {f.kind === 'toggle' ? (
              <Toggle
                label=""
                checked={cfgBool(value(f.key))}
                onChange={(v) => set(f.key, v ? '1' : '0')}
              />
            ) : f.kind === 'select' ? (
              <select className="input" value={value(f.key)} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">Default</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                type={f.kind === 'number' ? 'number' : 'text'}
                value={value(f.key)}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </FormField>
        ))}
      </div>

      <div className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-800">
        <button
          className={cx('btn-primary', !dirty && 'opacity-50')}
          disabled={!dirty || mut.isPending}
          onClick={() => {
            setSubmitError(null);
            mut.mutate(changed);
          }}
        >
          <Save className="h-4 w-4" />
          {mut.isPending ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
        </button>
      </div>

      {renderExtra && <div className="mt-5">{renderExtra(config, editableKeys)}</div>}
    </div>
  );
}

// Render a list of read-only config keys (hardware lines, leftover raw keys).
export function ReadOnlyKeys({
  title,
  config,
  keys,
}: {
  title: string;
  config: PveConfig;
  keys: string[];
}) {
  if (keys.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </p>
      <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {keys.map((k) => (
          <div key={k} className="flex gap-4 px-3 py-2 text-sm">
            <dt className="w-32 shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className="break-all font-mono text-xs text-slate-700 dark:text-slate-200">
              {cfgStr(config[k]) || '—'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
