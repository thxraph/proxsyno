import { useMemo, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Network,
  Server,
  Users as UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../api/client';
import type { ProxmoxAvailable } from '../../lib/types';
import { Dashboard } from '../../pages/Dashboard';
import { Storage } from '../../pages/Storage';
import { Shares } from '../../pages/Shares';
import { Users } from '../../pages/Users';
import { Files } from '../../pages/Files';
import { Virtualization } from '../../pages/Virtualization';

export interface AppDef {
  key: string;
  title: string;
  icon: LucideIcon;
  component: ComponentType;
  defaultSize: { w: number; h: number };
}

// Every registerable app. The launcher/desktop-icon list is a *filtered* view of
// this (see useApps); window bodies always resolve through APP_MAP so a gated app
// that's already open still renders. A "docker" app slots in here later.
export const APPS: AppDef[] = [
  {
    key: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    component: Dashboard,
    defaultSize: { w: 980, h: 680 },
  },
  {
    key: 'storage',
    title: 'Storage',
    icon: HardDrive,
    component: Storage,
    defaultSize: { w: 960, h: 660 },
  },
  {
    key: 'shares',
    title: 'Shares',
    icon: Network,
    component: Shares,
    defaultSize: { w: 900, h: 600 },
  },
  {
    key: 'users',
    title: 'Users',
    icon: UsersIcon,
    component: Users,
    defaultSize: { w: 880, h: 600 },
  },
  {
    key: 'files',
    title: 'Files',
    icon: FolderOpen,
    component: Files,
    defaultSize: { w: 1000, h: 680 },
  },
  {
    key: 'virtualization',
    title: 'Virtualization',
    icon: Server,
    component: Virtualization,
    defaultSize: { w: 1040, h: 700 },
  },
];

export const APP_MAP: Record<string, AppDef> = Object.fromEntries(
  APPS.map((a) => [a.key, a]),
);

// Apps available to launch. Virtualization only when the host runs Proxmox
// (carried over from the old Sidebar gate).
export function useApps(): AppDef[] {
  const proxmoxQ = useQuery({
    queryKey: ['proxmox', 'available'],
    queryFn: () => api.get<ProxmoxAvailable>('/proxmox/available'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const isProxmox = proxmoxQ.data?.isProxmox ?? false;
  return useMemo(
    () => (isProxmox ? APPS : APPS.filter((a) => a.key !== 'virtualization')),
    [isProxmox],
  );
}
