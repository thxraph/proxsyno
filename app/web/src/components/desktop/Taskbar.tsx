import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Cpu, LayoutGrid, LogOut, MemoryStick, Settings } from 'lucide-react';
import type { Notification, Severity, User } from '../../lib/types';
import { api } from '../../api/client';
import { useLogout } from '../../hooks/useAuth';
import { useSystemWs } from '../../hooks/useSystemWs';
import { cx } from '../../lib/format';
import { useApps, APP_MAP } from './appRegistry';
import { useWindows } from './windowManager';
import { NotificationSettingsModal } from './NotificationSettingsModal';

// Compact relative time ("just now", "5m ago", "3h ago", "2d ago").
function relTime(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-rose-500',
  warning: 'bg-amber-400',
  info: 'bg-sky-400',
};

export function Taskbar({ me }: { me: User }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const apps = useApps();
  const { windows, open, focus, minimize, restore } = useWindows();
  const { sample } = useSystemWs();
  const qc = useQueryClient();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherRef = useRef<HTMLDivElement>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const notifs = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ items: Notification[]; unreadCount: number }>('/notifications'),
    refetchInterval: 30_000,
  });
  const items = notifs.data?.items ?? [];
  const unreadCount = notifs.data?.unreadCount ?? 0;

  const markAllRead = async () => {
    await api.post('/notifications/read');
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Close the launcher when clicking elsewhere.
  useEffect(() => {
    if (!launcherOpen) return;
    const onDown = (e: MouseEvent) => {
      if (launcherRef.current && !launcherRef.current.contains(e.target as Node)) {
        setLauncherOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [launcherOpen]);

  // Close the notifications panel when clicking elsewhere.
  useEffect(() => {
    if (!bellOpen) return;
    const onDown = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [bellOpen]);

  const cpuPct = sample?.cpuPct ?? 0;
  const memPct =
    sample && sample.mem.totalKb > 0 ? (sample.mem.usedKb / sample.mem.totalKb) * 100 : 0;

  const onLogout = async () => {
    try {
      await logout.mutateAsync();
    } finally {
      navigate('/login');
    }
  };

  const onWindowButton = (id: string, minimized: boolean, focused: boolean) => {
    if (minimized) restore(id);
    else if (focused) minimize(id);
    else focus(id);
  };

  return (
    <div
      className="absolute inset-x-0 bottom-0 flex h-12 items-center gap-2 bg-zinc-900/95 px-2 backdrop-blur"
      style={{ zIndex: 100000 }}
    >
      {/* Launcher */}
      <div ref={launcherRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setLauncherOpen((v) => !v)}
          className={cx(
            'flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition-colors',
            launcherOpen
              ? 'bg-orange-500 text-white'
              : 'text-zinc-200 hover:bg-zinc-800',
          )}
        >
          <LayoutGrid className="h-4 w-4" aria-hidden />
          Apps
        </button>

        {launcherOpen && (
          <div className="absolute bottom-12 left-0 w-72 rounded-lg bg-zinc-900 p-2 shadow-2xl shadow-black/60 ring-1 ring-zinc-800">
            <div className="grid grid-cols-3 gap-px">
              {apps.map((app) => {
                const Icon = app.icon;
                return (
                  <button
                    key={app.key}
                    type="button"
                    onClick={() => {
                      open(app.key, { title: app.title, ...app.defaultSize });
                      setLauncherOpen(false);
                    }}
                    className="flex flex-col items-center gap-1.5 rounded p-3 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-orange-400"
                  >
                    <Icon className="h-6 w-6" aria-hidden />
                    <span className="text-[11px]">{app.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Open-window buttons */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {windows.map((w) => {
          const Icon = APP_MAP[w.appKey]?.icon ?? LayoutGrid;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => onWindowButton(w.id, w.minimized, w.focused)}
              title={w.title}
              className={cx(
                'flex h-9 max-w-[160px] items-center gap-2 rounded px-3 text-xs font-medium transition-colors',
                w.focused && !w.minimized
                  ? 'bg-zinc-800 text-orange-400 ring-1 ring-orange-500/50'
                  : w.minimized
                    ? 'text-zinc-500 hover:bg-zinc-800'
                    : 'text-zinc-300 hover:bg-zinc-800',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{w.title}</span>
            </button>
          );
        })}
      </div>

      {/* Live CPU / mem readout */}
      <div className="hidden items-center gap-3 px-2 text-xs text-zinc-400 sm:flex">
        <span className="flex items-center gap-1 tabular-nums" title="CPU usage">
          <Cpu className="h-3.5 w-3.5 text-orange-400" aria-hidden />
          {cpuPct.toFixed(0)}%
        </span>
        <span className="flex items-center gap-1 tabular-nums" title="Memory usage">
          <MemoryStick className="h-3.5 w-3.5 text-orange-400" aria-hidden />
          {memPct.toFixed(0)}%
        </span>
      </div>

      {/* Notifications */}
      <div ref={bellRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setBellOpen((v) => !v)}
          title="Notifications"
          aria-label="Notifications"
          className={cx(
            'relative flex h-9 w-9 items-center justify-center rounded transition-colors',
            bellOpen ? 'bg-zinc-800 text-orange-400' : 'text-zinc-300 hover:bg-zinc-800',
          )}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {bellOpen && (
          <div className="absolute bottom-12 right-0 w-96 rounded-lg bg-zinc-900 shadow-2xl shadow-black/60 ring-1 ring-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
              <span className="text-sm font-semibold text-zinc-100">Notifications</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-orange-400 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-300"
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                  Mark all read
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(true);
                    setBellOpen(false);
                  }}
                  title="Notification settings"
                  aria-label="Notification settings"
                  className="flex h-7 w-7 items-center justify-center rounded text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-orange-400"
                >
                  <Settings className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-auto">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-zinc-500">No notifications.</p>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {items.map((n) => (
                    <li key={n.id} className="flex gap-2.5 px-3 py-2.5">
                      <span
                        className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[n.severity])}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-100">{n.title}</p>
                        <p className="text-xs text-zinc-400">{n.message}</p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                          {n.source} · {relTime(n.ts)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {settingsOpen && <NotificationSettingsModal onClose={() => setSettingsOpen(false)} />}

      {/* User + logout */}
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-xs font-medium text-zinc-200">{me.name}</p>
        <p className="text-[10px] text-zinc-500">{me.isAdmin ? 'Administrator' : 'User'}</p>
      </div>
      <button
        type="button"
        onClick={onLogout}
        disabled={logout.isPending}
        title="Log out"
        aria-label="Log out"
        className="flex h-9 w-9 items-center justify-center rounded text-zinc-300 transition-colors hover:bg-rose-500 hover:text-white disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>

      {/* Clock */}
      <div className="shrink-0 px-2 text-right leading-tight">
        <p className="text-xs font-medium tabular-nums text-zinc-200">
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="text-[10px] text-zinc-500">
          {now.toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </p>
      </div>
    </div>
  );
}
