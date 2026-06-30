import { Navigate } from 'react-router-dom';
import type { User } from '../../lib/types';
import { useMe } from '../../hooks/useAuth';
import { LoadingState } from '../states';
import { useApps, type AppDef } from './appRegistry';
import { AppWindow } from './AppWindow';
import { Taskbar } from './Taskbar';
import { WindowProvider, useWindows } from './windowManager';

// The single authenticated surface. Everything that isn't /login renders here.
export function Desktop() {
  const { data: me, isLoading } = useMe();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <LoadingState label="Checking session…" />
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;

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

function DesktopIcons({ apps }: { apps: AppDef[] }) {
  const { open } = useWindows();
  return (
    <div className="absolute left-4 top-4 grid w-20 auto-rows-min gap-2">
      {apps.map((app) => {
        const Icon = app.icon;
        return (
          <button
            key={app.key}
            type="button"
            onClick={() => open(app.key, { title: app.title, ...app.defaultSize })}
            className="group flex flex-col items-center gap-1 rounded-lg p-2 text-center transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-500"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900/80 text-zinc-300 ring-1 ring-zinc-800 transition-colors group-hover:text-orange-400">
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-[11px] font-medium text-zinc-300 drop-shadow">{app.title}</span>
          </button>
        );
      })}
    </div>
  );
}
