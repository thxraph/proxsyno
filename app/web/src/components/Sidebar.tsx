import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Network,
  Server,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '../lib/format';
import { api } from '../api/client';
import type { ProxmoxAvailable } from '../lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/storage', label: 'Storage', icon: HardDrive },
  { to: '/shares', label: 'Shares', icon: Network },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/files', label: 'Files', icon: FolderOpen },
];

const VIRTUALIZATION_ITEM: NavItem = {
  to: '/virtualization',
  label: 'Virtualization',
  icon: Server,
};

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  // Only show Virtualization when the host is actually running Proxmox.
  const proxmoxQ = useQuery({
    queryKey: ['proxmox', 'available'],
    queryFn: () => api.get<ProxmoxAvailable>('/proxmox/available'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const items = proxmoxQ.data?.isProxmox ? [...NAV, VIRTUALIZATION_ITEM] : NAV;

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-slate-900 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 text-white">
              <HardDrive className="h-4 w-4" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              proxsyno
            </span>
          </div>
          <button
            type="button"
            className="btn-ghost h-8 w-8 rounded-lg p-0 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-400'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400 dark:border-slate-800">
          NAS management for Proxmox
        </div>
      </aside>
    </>
  );
}
