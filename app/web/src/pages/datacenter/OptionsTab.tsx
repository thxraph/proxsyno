import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, SlidersHorizontal } from 'lucide-react';
import { pve } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Banner, QueryGate, TabHeader, str, type PveRow } from './util';

// Common datacenter options surfaced as editable fields (Proxmox returns many more).
interface OptField {
  key: string;
  label: string;
  hint?: string;
  options?: string[]; // present => <select>
}

const KEYBOARD = ['', 'en-us', 'en-gb', 'de', 'de-ch', 'fr', 'fr-be', 'fr-ca', 'fr-ch', 'it', 'es', 'pt', 'pt-br', 'da', 'nl', 'no', 'pl', 'sv', 'fi', 'hu', 'sl', 'tr', 'ja'];
const CONSOLE = ['', 'applet', 'vv', 'html5', 'xtermjs'];

const FIELDS: OptField[] = [
  { key: 'keyboard', label: 'Keyboard layout', options: KEYBOARD },
  { key: 'console', label: 'Default console viewer', options: CONSOLE },
  { key: 'language', label: 'Web UI language', hint: 'e.g. en, de — blank for browser default.' },
  { key: 'email_from', label: 'Email from address' },
  { key: 'http_proxy', label: 'HTTP proxy', hint: 'http://host:port' },
  { key: 'mac_prefix', label: 'MAC address prefix' },
  { key: 'migration', label: 'Migration settings', hint: 'Property string, e.g. type=secure,network=10.0.0.0/24.' },
  { key: 'bwlimit', label: 'Bandwidth limits', hint: 'Property string, e.g. migration=100000,restore=50000.' },
];

export function OptionsTab() {
  const q = useQuery({
    queryKey: ['dc', 'options'],
    queryFn: () => pve.get<PveRow>('/pve/cluster/options'),
  });

  return (
    <div>
      <TabHeader title="Datacenter options" icon={SlidersHorizontal} />
      <QueryGate query={q} loading="Loading options…">
        {(data) => <OptionsForm initial={data} />}
      </QueryGate>
    </div>
  );
}

function OptionsForm({ initial }: { initial: PveRow }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of FIELDS) v[f.key] = str(initial[f.key]);
    return v;
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      const del: string[] = [];
      for (const f of FIELDS) {
        const cur = values[f.key].trim();
        const orig = str(initial[f.key]);
        if (cur === orig) continue;
        if (cur) payload[f.key] = cur;
        else del.push(f.key); // cleared a previously-set option
      }
      if (del.length) payload.delete = del.join(',');
      return pve.put('/pve/cluster/options', payload);
    },
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['dc', 'options'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save options'),
  });

  const set = (k: string, val: string) => {
    setValues((prev) => ({ ...prev, [k]: val }));
    setSaved(false);
  };

  return (
    <div className="card max-w-2xl p-5">
      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="success">Options saved.</Banner>}

      {FIELDS.map((f) => (
        <FormField key={f.key} label={f.label} hint={f.hint}>
          {f.options ? (
            <select className="input" value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
              {f.options.map((o) => (
                <option key={o} value={o}>{o || '(default)'}</option>
              ))}
            </select>
          ) : (
            <input className="input" value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} />
          )}
        </FormField>
      ))}

      <div className="mt-2 flex justify-end">
        <button className="btn-primary" onClick={() => { setError(null); mut.mutate(); }} disabled={mut.isPending}>
          <Save className="h-4 w-4" aria-hidden /> {mut.isPending ? 'Saving…' : 'Save options'}
        </button>
      </div>
    </div>
  );
}
