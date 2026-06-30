import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LogOut, Menu, Server } from 'lucide-react';
import { api } from '../api/client';
import type { System } from '../lib/types';
import { useLogout, useMe } from '../hooks/useAuth';
import { ThemeToggle } from './ThemeToggle';
import { Badge } from './Badge';

interface TopBarProps {
  onToggleSidebar: () => void;
}

export function TopBar({ onToggleSidebar }: TopBarProps) {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const logout = useLogout();

  const { data: system } = useQuery({
    queryKey: ['system'],
    queryFn: () => api.get<System>('/system'),
    staleTime: 60_000,
  });

  const onLogout = async () => {
    try {
      await logout.mutateAsync();
    } finally {
      navigate('/login');
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <button
        type="button"
        className="btn-ghost h-9 w-9 rounded-lg p-0 lg:hidden"
        onClick={onToggleSidebar}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <Server className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="truncate font-medium text-slate-700 dark:text-slate-200">
          {system?.hostname ?? 'proxsyno'}
        </span>
        {system?.isProxmox && (
          <Badge tone="accent" className="hidden sm:inline-flex">
            Proxmox{system.pveVersion ? ` ${system.pveVersion}` : ''}
          </Badge>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {me?.name ?? '—'}
          </p>
          <p className="text-xs text-slate-400">{me?.isAdmin ? 'Administrator' : 'User'}</p>
        </div>
        <button
          type="button"
          className="btn-secondary h-9"
          onClick={onLogout}
          disabled={logout.isPending}
          title="Log out"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
