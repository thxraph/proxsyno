import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Cpu, LogOut, MemoryStick } from 'lucide-react';
import type { User } from '../../lib/types';
import { useLogout } from '../../hooks/useAuth';
import { useSystemWs } from '../../hooks/useSystemWs';
import { useApps, APP_MAP } from './appRegistry';

// Full-screen mobile shell: a home launcher (app grid) and one full-screen app at
// a time with a back-to-home bar. No windows, drag, or resize — those don't work
// on touch. Reuses the exact same app components as the desktop window bodies.
export function MobileShell({ me }: { me: User }) {
  const apps = useApps();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // If the active app gets gated away (e.g. Proxmox availability resolves), fall
  // back to the launcher rather than render a blank screen.
  useEffect(() => {
    if (activeKey && !apps.some((a) => a.key === activeKey)) setActiveKey(null);
  }, [activeKey, apps]);

  const active = activeKey ? APP_MAP[activeKey] : undefined;

  if (active) {
    const Body = active.component;
    const Icon = active.icon;
    return (
      <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-2">
          <button
            type="button"
            onClick={() => setActiveKey(null)}
            aria-label="Back to home"
            className="flex h-10 items-center gap-1 rounded-lg px-2 text-zinc-300 transition-colors active:bg-zinc-800"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
            <span className="text-sm">Home</span>
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-orange-400" aria-hidden />
            <span className="truncate text-sm font-semibold">{active.title}</span>
          </div>
          {/* Spacer to keep the title visually centered against the back button. */}
          <div className="h-10 w-16 shrink-0" aria-hidden />
        </header>
        <main className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-3">
          <Body />
        </main>
      </div>
    );
  }

  return <MobileHome me={me} apps={apps} onOpen={setActiveKey} />;
}

function MobileHome({
  me,
  apps,
  onOpen,
}: {
  me: User;
  apps: ReturnType<typeof useApps>;
  onOpen: (key: string) => void;
}) {
  const navigate = useNavigate();
  const logout = useLogout();
  const { sample } = useSystemWs();

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

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100">
      {/* Subtle wallpaper glow, matching the desktop shell. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 500px at 30% 0%, rgba(249,115,22,0.10), transparent 60%)',
        }}
        aria-hidden
      />

      <header className="relative flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-3 backdrop-blur">
        <span className="text-base font-semibold tracking-tight">
          prox<span className="text-orange-400">syno</span>
        </span>
        <div className="flex flex-1 items-center justify-end gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1 tabular-nums" title="CPU usage">
            <Cpu className="h-3.5 w-3.5 text-orange-400" aria-hidden />
            {cpuPct.toFixed(0)}%
          </span>
          <span className="flex items-center gap-1 tabular-nums" title="Memory usage">
            <MemoryStick className="h-3.5 w-3.5 text-orange-400" aria-hidden />
            {memPct.toFixed(0)}%
          </span>
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.key}
                type="button"
                onClick={() => onOpen(app.key)}
                className="flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors active:bg-white/5"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800">
                  <Icon className="h-7 w-7" aria-hidden />
                </span>
                <span className="text-[11px] font-medium leading-tight text-zinc-300">
                  {app.title}
                </span>
              </button>
            );
          })}
        </div>
      </main>

      <footer className="relative flex h-14 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-900/90 px-4 backdrop-blur">
        <div className="leading-tight">
          <p className="text-sm font-medium text-zinc-200">{me.name}</p>
          <p className="text-[10px] text-zinc-500">{me.isAdmin ? 'Administrator' : 'User'}</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          disabled={logout.isPending}
          className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-zinc-300 transition-colors active:bg-rose-500 active:text-white disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Log out
        </button>
      </footer>
    </div>
  );
}
