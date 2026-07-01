import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { System, User } from '../../lib/types';
import { useMe } from '../../hooks/useAuth';
import { useIsMobile } from '../../hooks/useIsMobile';
import { LoadingState } from '../states';
import { useApps } from './appRegistry';
import { AppWindow } from './AppWindow';
import { DesktopIcons } from './DesktopIcons';
import { MobileShell } from './MobileShell';
import { Taskbar } from './Taskbar';
import { WindowProvider, useWindows } from './windowManager';

// The single authenticated surface. Everything that isn't /login renders here.
// Phones get a full-screen launcher shell; larger screens get the window manager.
export function Desktop() {
  const { data: me, isLoading } = useMe();
  const isMobile = useIsMobile();

  // Put the node name in the tab title ("<node> - proxsyno") so it's obvious
  // which host a tab belongs to. Shares the ['system'] cache with the Dashboard.
  const sysQ = useQuery({
    queryKey: ['system'],
    queryFn: () => api.get<System>('/system'),
    enabled: !!me,
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    const host = sysQ.data?.hostname;
    document.title = host ? `${host} - proxsyno` : 'proxsyno';
  }, [sysQ.data]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <LoadingState label="Checking session…" />
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;

  if (isMobile) return <MobileShell me={me} />;

  return (
    <WindowProvider>
      <DesktopShell me={me} />
    </WindowProvider>
  );
}

function DesktopShell({ me }: { me: User }) {
  const apps = useApps();
  const { windows } = useWindows();

  return (
    <div className="fixed inset-0 overflow-hidden bg-zinc-950">
      {/* Subtle wallpaper: radial glow over a dark zinc base. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1200px 800px at 20% 0%, rgba(249,115,22,0.10), transparent 60%), radial-gradient(900px 700px at 100% 100%, rgba(39,39,42,0.8), transparent 55%)',
        }}
        aria-hidden
      />

      {/* Window layer (sits above icons, below the taskbar). */}
      <div className="absolute inset-x-0 bottom-12 top-0">
        <DesktopIcons apps={apps} />
        {windows.map((w) => (
          <AppWindow key={w.id} win={w} />
        ))}
      </div>

      <Taskbar me={me} />
    </div>
  );
}
