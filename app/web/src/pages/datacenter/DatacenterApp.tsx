import { useState } from 'react';
import {
  Activity,
  Archive,
  Copy,
  Database,
  HeartPulse,
  Network,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../../lib/format';
import { SummaryTab } from './SummaryTab';
import { StorageTab } from './StorageTab';
import { BackupTab } from './BackupTab';
import { PermissionsTab } from './PermissionsTab';
import { ReplicationTab } from './ReplicationTab';
import { HaTab } from './HaTab';
import { OptionsTab } from './OptionsTab';

type TabId = 'summary' | 'storage' | 'backup' | 'permissions' | 'replication' | 'ha' | 'options';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'summary', label: 'Summary', icon: Activity },
  { id: 'storage', label: 'Storage', icon: Database },
  { id: 'backup', label: 'Backup', icon: Archive },
  { id: 'permissions', label: 'Permissions', icon: Shield },
  { id: 'replication', label: 'Replication', icon: Copy },
  { id: 'ha', label: 'HA', icon: HeartPulse },
  { id: 'options', label: 'Options', icon: SlidersHorizontal },
];

export function DatacenterApp() {
  const [tab, setTab] = useState<TabId>('summary');

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center gap-2">
        <Network className="h-5 w-5 text-accent-500" aria-hidden />
        <h1 className="text-xl font-semibold text-zinc-100">Datacenter</h1>
      </div>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-800">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cx(
                '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-accent-500 text-accent-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {t.label}
            </button>
          );
        })}
      </nav>

      <div>
        {tab === 'summary' && <SummaryTab />}
        {tab === 'storage' && <StorageTab />}
        {tab === 'backup' && <BackupTab />}
        {tab === 'permissions' && <PermissionsTab />}
        {tab === 'replication' && <ReplicationTab />}
        {tab === 'ha' && <HaTab />}
        {tab === 'options' && <OptionsTab />}
      </div>
    </div>
  );
}
