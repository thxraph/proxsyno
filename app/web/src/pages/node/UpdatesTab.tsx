import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, RefreshCw, Server } from 'lucide-react';
import { pve } from '../../api/client';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { ErrorState, LoadingState } from '../../components/states';
import { asArray, num, str, type PveObj } from './util';

export function UpdatesTab({ node }: { node: string }) {
  const qc = useQueryClient();

  const updatesQ = useQuery({
    queryKey: ['node', 'apt-update', node],
    queryFn: () => pve.get<PveObj[]>(`/pve/nodes/${node}/apt/update`),
  });

  const reposQ = useQuery({
    queryKey: ['node', 'apt-repos', node],
    queryFn: () => pve.get<PveObj>(`/pve/nodes/${node}/apt/repositories`),
  });

  // POST refreshes the package index (apt update); it does NOT upgrade anything.
  const refreshMut = useMutation({
    mutationFn: () => pve.post(`/pve/nodes/${node}/apt/update`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['node', 'apt-update', node] }),
  });

  const updateColumns: Column<PveObj>[] = [
    {
      key: 'pkg',
      header: 'Package',
      render: (p) => <span className="font-mono text-xs text-zinc-200">{str(p, 'Package')}</span>,
    },
    {
      key: 'version',
      header: 'New version',
      render: (p) => <span className="font-mono text-xs text-emerald-400">{str(p, 'Version')}</span>,
    },
    {
      key: 'old',
      header: 'Installed',
      render: (p) => <span className="font-mono text-xs text-zinc-500">{str(p, 'OldVersion') || '—'}</span>,
    },
    {
      key: 'title',
      header: 'Description',
      render: (p) => <span className="text-zinc-400">{str(p, 'Title') || str(p, 'Description')}</span>,
    },
  ];

  // Repositories are returned as { files: [{ path, repositories: [...] }], ... }.
  const repoFiles = asArray(reposQ.data?.files);

  return (
    <div className="flex flex-col gap-px">
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Package className="h-4 w-4 text-zinc-400" aria-hidden /> Available updates
            {updatesQ.data && <Badge tone={updatesQ.data.length ? 'warning' : 'success'}>{updatesQ.data.length}</Badge>}
          </h3>
          <button className="btn-secondary" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {refreshMut.isPending ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {updatesQ.isLoading ? (
          <LoadingState label="Reading available updates…" />
        ) : updatesQ.isError ? (
          <ErrorState error={updatesQ.error} onRetry={() => updatesQ.refetch()} />
        ) : (
          <DataTable
            columns={updateColumns}
            rows={updatesQ.data ?? []}
            rowKey={(p) => str(p, 'Package')}
            emptyMessage="System is up to date."
          />
        )}
      </div>

      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Server className="h-4 w-4 text-zinc-400" aria-hidden /> APT repositories
        </h3>
        {reposQ.isLoading ? (
          <LoadingState label="Reading repositories…" />
        ) : reposQ.isError ? (
          <ErrorState error={reposQ.error} onRetry={() => reposQ.refetch()} />
        ) : repoFiles.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No repository files reported.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {repoFiles.map((file, fi) => (
              <div key={str(file, 'path') || fi}>
                <p className="mb-1 font-mono text-xs text-zinc-500">{str(file, 'path')}</p>
                <div className="flex flex-col gap-1">
                  {asArray(file.repositories).map((repo, ri) => (
                    <RepoRow key={ri} repo={repo} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RepoRow({ repo }: { repo: PveObj }) {
  const enabled = num(repo, 'Enabled') !== 0;
  const uris = asArray<string>(repo.URIs).join(' ');
  const suites = asArray<string>(repo.Suites).join(' ');
  const comps = asArray<string>(repo.Components).join(' ');
  return (
    <div className="flex items-center gap-2 rounded-md bg-zinc-950 px-3 py-2">
      <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'enabled' : 'disabled'}</Badge>
      <span className="truncate font-mono text-xs text-zinc-300" title={`${uris} ${suites} ${comps}`}>
        {uris} <span className="text-zinc-500">{suites}</span> <span className="text-zinc-600">{comps}</span>
      </span>
    </div>
  );
}
