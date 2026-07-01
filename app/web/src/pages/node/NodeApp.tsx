import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  HardDrive,
  ListChecks,
  Network,
  Package,
  Server,
  Shield,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../../api/client';
import { cx } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { SummaryTab } from './SummaryTab';
import { NetworkTab } from './NetworkTab';
import { DnsTimeTab } from './DnsTimeTab';
import { UpdatesTab } from './UpdatesTab';
import { ServicesTab } from './ServicesTab';
import { DisksTab } from './DisksTab';
import { TasksTab } from './TasksTab';
import { FirewallTab } from './FirewallTab';
import { HostShellTab } from './HostShellTab';

// `/api/proxmox/available` is NOT wrapped in a `{ data }` envelope.
interface ProxmoxAvailable {
  isProxmox: boolean;
  node: string;
}

interface TabDef {
  key: string;
  label: string;
  icon: LucideIcon;
  render: (node: string) => JSX.Element;
}

const TABS: TabDef[] = [
  { key: 'summary', label: 'Summary', icon: Server, render: (n) => <SummaryTab node={n} /> },
  { key: 'network', label: 'Network', icon: Network, render: (n) => <NetworkTab node={n} /> },
  { key: 'dns', label: 'DNS & Time', icon: Clock, render: (n) => <DnsTimeTab node={n} /> },
  { key: 'updates', label: 'Updates', icon: Package, render: (n) => <UpdatesTab node={n} /> },
  { key: 'services', label: 'Services', icon: Wrench, render: (n) => <ServicesTab node={n} /> },
  { key: 'disks', label: 'Disks', icon: HardDrive, render: (n) => <DisksTab node={n} /> },
  { key: 'tasks', label: 'Tasks', icon: ListChecks, render: (n) => <TasksTab node={n} /> },
  { key: 'firewall', label: 'Firewall', icon: Shield, render: (n) => <FirewallTab node={n} /> },
  { key: 'shell', label: 'Shell', icon: TerminalSquare, render: () => <HostShellTab /> },
];

export function NodeApp() {
  const availQ = useQuery({
    queryKey: ['proxmox', 'available'],
    queryFn: () => api.get<ProxmoxAvailable>('/proxmox/available'),
    staleTime: 60_000,
  });

  const [active, setActive] = useState(TABS[0].key);

  const header = <PageHeader title="Node" description="Proxmox host management" />;

  if (availQ.isLoading) {
    return (
      <div>
        {header}
        <LoadingState label="Checking for Proxmox…" />
      </div>
    );
  }
  if (availQ.isError) {
    return (
      <div>
        {header}
        <ErrorState error={availQ.error} onRetry={() => availQ.refetch()} />
      </div>
    );
  }
  if (!availQ.data?.isProxmox || !availQ.data.node) {
    return (
      <div>
        {header}
        <EmptyState
          icon={Server}
          title="Proxmox not detected"
          message="This host is not running Proxmox VE, so node management is unavailable."
        />
      </div>
    );
  }

  const node = availQ.data.node;
  const activeTab = TABS.find((t) => t.key === active) ?? TABS[0];

  return (
    <div>
      <PageHeader title="Node" description={`Proxmox host · ${node}`} />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-zinc-800">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={cx(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-orange-500 text-orange-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      {activeTab.render(node)}
    </div>
  );
}

export default NodeApp;
