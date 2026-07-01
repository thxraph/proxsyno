import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Globe, LocateFixed, Save } from 'lucide-react';
import { pve, ApiError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { ErrorState, LoadingState } from '../../components/states';
import { str, type PveObj } from './util';

// The full IANA timezone list, straight from the browser. supportedValuesOf is
// in every evergreen browser (Chrome 99+, Firefox 93+, Safari 15.4+); fall back
// to a tiny list on the off chance it's missing.
const TIMEZONES: string[] = (() => {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    if (typeof intl.supportedValuesOf === 'function') return intl.supportedValuesOf('timeZone');
  } catch {
    /* fall through */
  }
  return ['UTC', 'Europe/Paris', 'Europe/London', 'America/New_York', 'America/Los_Angeles'];
})();

/** The browser's current timezone, e.g. "Europe/Paris". */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function DnsTimeTab({ node }: { node: string }) {
  return (
    <div className="flex flex-col gap-px">
      <DnsCard node={node} />
      <TimeCard node={node} />
    </div>
  );
}

function DnsCard({ node }: { node: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['node', 'dns', node],
    queryFn: () => pve.get<PveObj>(`/pve/nodes/${node}/dns`),
  });

  const [search, setSearch] = useState('');
  const [dns1, setDns1] = useState('');
  const [dns2, setDns2] = useState('');
  const [dns3, setDns3] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setSearch(str(q.data, 'search'));
    setDns1(str(q.data, 'dns1'));
    setDns2(str(q.data, 'dns2'));
    setDns3(str(q.data, 'dns3'));
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = { search };
      if (dns1) params.dns1 = dns1;
      if (dns2) params.dns2 = dns2;
      if (dns3) params.dns3 = dns3;
      return pve.put(`/pve/nodes/${node}/dns`, params);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['node', 'dns', node] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to save DNS settings'),
  });

  return (
    <div className="card p-4">
      <CardHeader icon={Globe} title="DNS" />
      {q.isLoading ? (
        <LoadingState label="Reading DNS configuration…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="max-w-lg">
          {error && <SaveError message={error} />}
          <FormField label="Search domain">
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="example.com" />
          </FormField>
          <FormField label="DNS server 1">
            <input className="input" value={dns1} onChange={(e) => setDns1(e.target.value)} placeholder="1.1.1.1" />
          </FormField>
          <FormField label="DNS server 2">
            <input className="input" value={dns2} onChange={(e) => setDns2(e.target.value)} placeholder="optional" />
          </FormField>
          <FormField label="DNS server 3">
            <input className="input" value={dns3} onChange={(e) => setDns3(e.target.value)} placeholder="optional" />
          </FormField>
          <button
            className="btn-primary"
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={mut.isPending}
          >
            <Save className="h-4 w-4" aria-hidden /> {mut.isPending ? 'Saving…' : 'Save DNS'}
          </button>
        </div>
      )}
    </div>
  );
}

function TimeCard({ node }: { node: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['node', 'time', node],
    queryFn: () => pve.get<PveObj>(`/pve/nodes/${node}/time`),
  });

  const [timezone, setTimezone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) setTimezone(str(q.data, 'timezone'));
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () => pve.put(`/pve/nodes/${node}/time`, { timezone }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['node', 'time', node] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to save timezone'),
  });

  const localtime = q.data ? Number(q.data.localtime) : undefined;
  const localStr = localtime ? new Date(localtime * 1000).toLocaleString() : '—';

  // Ensure the node's current value is always selectable, even if it somehow
  // isn't in the browser's IANA list.
  const options = useMemo(
    () => (timezone && !TIMEZONES.includes(timezone) ? [timezone, ...TIMEZONES] : TIMEZONES),
    [timezone],
  );

  return (
    <div className="card p-4">
      <CardHeader icon={Clock} title="Time" />
      {q.isLoading ? (
        <LoadingState label="Reading time configuration…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="max-w-lg">
          {error && <SaveError message={error} />}
          <p className="mb-3 text-sm text-zinc-400">
            Node local time: <span className="font-mono text-zinc-200">{localStr}</span>
          </p>
          <FormField label="Timezone" hint="Pick an IANA timezone, or autodetect this browser's.">
            <div className="flex gap-2">
              <select
                className="input flex-1"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {options.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => {
                  setError(null);
                  setTimezone(detectTimezone());
                }}
                title="Set to this browser's timezone"
              >
                <LocateFixed className="h-4 w-4" aria-hidden /> Autodetect
              </button>
            </div>
          </FormField>
          <button
            className="btn-primary"
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={mut.isPending || !timezone}
          >
            <Save className="h-4 w-4" aria-hidden /> {mut.isPending ? 'Saving…' : 'Save timezone'}
          </button>
        </div>
      )}
    </div>
  );
}

function CardHeader({ icon: Icon, title }: { icon: typeof Globe; title: string }) {
  return (
    <h3 className="mb-4 flex items-center gap-2 border-b border-zinc-800 pb-3 text-sm font-semibold text-zinc-100">
      <Icon className="h-4 w-4 text-zinc-400" aria-hidden /> {title}
    </h3>
  );
}

function SaveError({ message }: { message: string }) {
  return (
    <div className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">{message}</div>
  );
}
