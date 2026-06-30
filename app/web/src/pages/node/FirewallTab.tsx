import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldCheck } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { ErrorState, LoadingState } from '../../components/states';
import { bool, num, str, type PveObj } from './util';

export function FirewallTab({ node }: { node: string }) {
  const qc = useQueryClient();

  const optionsQ = useQuery({
    queryKey: ['node', 'fw-options', node],
    queryFn: () => pve.get<PveObj>(`/pve/nodes/${node}/firewall/options`),
  });

  const rulesQ = useQuery({
    queryKey: ['node', 'fw-rules', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/firewall/rules`),
  });

  const toggleMut = useMutation({
    mutationFn: (enable: boolean) =>
      pve.put(`/pve/nodes/${node}/firewall/options`, { enable: enable ? 1 : 0 }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['node', 'fw-options', node] }),
  });

  const enabled = bool(optionsQ.data, 'enable');

  const columns: Column<PveObj>[] = [
    { key: 'pos', header: '#', align: 'right', render: (r) => <span className="tabular-nums text-xs text-zinc-500">{num(r, 'pos') ?? '—'}</span> },
    {
      key: 'enable',
      header: 'On',
      render: (r) => <Badge tone={bool(r, 'enable') ? 'success' : 'neutral'}>{bool(r, 'enable') ? 'yes' : 'no'}</Badge>,
    },
    { key: 'type', header: 'Type', render: (r) => <span className="text-xs text-zinc-300">{str(r, 'type')}</span> },
    {
      key: 'action',
      header: 'Action',
      render: (r) => {
        const a = str(r, 'action');
        return <Badge tone={/accept/i.test(a) ? 'success' : /drop|reject|deny/i.test(a) ? 'danger' : 'neutral'}>{a}</Badge>;
      },
    },
    { key: 'proto', header: 'Proto', render: (r) => <span className="text-xs text-zinc-400">{str(r, 'proto') || '—'}</span> },
    { key: 'source', header: 'Source', render: (r) => <span className="font-mono text-xs text-zinc-400">{str(r, 'source') || 'any'}</span> },
    { key: 'dest', header: 'Dest', render: (r) => <span className="font-mono text-xs text-zinc-400">{str(r, 'dest') || 'any'}</span> },
    { key: 'dport', header: 'Dport', render: (r) => <span className="font-mono text-xs text-zinc-400">{str(r, 'dport') || '—'}</span> },
    { key: 'comment', header: 'Comment', render: (r) => <span className="text-xs text-zinc-500">{str(r, 'comment')}</span> },
  ];

  return (
    <div className="flex flex-col gap-px">
      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Shield className="h-4 w-4 text-zinc-400" aria-hidden /> Firewall options
        </h3>
        {optionsQ.isLoading ? (
          <LoadingState label="Reading firewall options…" />
        ) : optionsQ.isError ? (
          <ErrorState error={optionsQ.error} onRetry={() => optionsQ.refetch()} />
        ) : (
          <div className="flex items-center justify-between rounded-lg bg-zinc-950 px-4 py-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className={enabled ? 'h-5 w-5 text-emerald-500' : 'h-5 w-5 text-zinc-600'} aria-hidden />
              <div>
                <p className="text-sm font-medium text-zinc-100">Node firewall</p>
                <p className="text-xs text-zinc-500">{enabled ? 'Enabled' : 'Disabled'}</p>
              </div>
            </div>
            <button
              className={enabled ? 'btn-danger' : 'btn-primary'}
              onClick={() => toggleMut.mutate(!enabled)}
              disabled={toggleMut.isPending}
            >
              {toggleMut.isPending ? 'Working…' : enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        )}
        {/* TODO: expose advanced firewall options (policy_in/out, log_level, nf_conntrack). */}
      </div>

      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Shield className="h-4 w-4 text-zinc-400" aria-hidden /> Rules
        </h3>
        {rulesQ.isLoading ? (
          <LoadingState label="Reading firewall rules…" />
        ) : rulesQ.isError ? (
          <ErrorState error={rulesQ.error} onRetry={() => rulesQ.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={rulesQ.data ?? []}
            rowKey={(r) => str(r, 'pos')}
            emptyMessage="No node-level firewall rules."
          />
        )}
        {/* TODO: add/edit/delete rules via POST/PUT/DELETE /firewall/rules[/:pos]. */}
      </div>
    </div>
  );
}
