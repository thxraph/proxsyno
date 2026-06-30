import { useMemo, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Cctv,
  Container,
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  LayoutDashboard,
  Network,
  Server,
  StickyNote,
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
import { NodeApp } from '../../pages/node/NodeApp';
import { DatacenterApp } from '../../pages/datacenter/DatacenterApp';
import { DockerApp } from '../../pages/docker/DockerApp';
import { DownloadStation } from '../../pages/downloads/DownloadStation';
import { Photos } from '../../pages/photos/Photos';
import { NoteStation } from '../../pages/notes/NoteStation';
import { Surveillance } from '../../pages/surveillance/Surveillance';

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
  {
    key: 'node',
    title: 'Node',
    icon: Cpu,
    component: NodeApp,
    defaultSize: { w: 1080, h: 720 },
  },
  {
    key: 'datacenter',
    title: 'Datacenter',
    icon: Building2,
    component: DatacenterApp,
    defaultSize: { w: 1100, h: 740 },
  },
  {
    key: 'docker',
    title: 'Docker',
    icon: Container,
    component: DockerApp,
    defaultSize: { w: 1040, h: 700 },
  },
  {
    key: 'downloads',
    title: 'Download Station',
    icon: Download,
    component: DownloadStation,
    defaultSize: { w: 1000, h: 660 },
  },
  {
    key: 'photos',
    title: 'Photos',
    icon: ImageIcon,
    component: Photos,
    defaultSize: { w: 1040, h: 720 },
  },
  {
    key: 'notes',
    title: 'Note Station',
    icon: StickyNote,
    component: NoteStation,
    defaultSize: { w: 1100, h: 720 },
  },
  {
    key: 'surveillance',
    title: 'Surveillance',
    icon: Cctv,
    component: Surveillance,
    defaultSize: { w: 1040, h: 720 },
  },
];

// Apps that only make sense on a Proxmox host (hidden otherwise).
const PROXMOX_APPS = new Set(['virtualization', 'node', 'datacenter', 'docker']);

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
    () => (isProxmox ? APPS : APPS.filter((a) => !PROXMOX_APPS.has(a.key))),
    [isProxmox],
  );
}
