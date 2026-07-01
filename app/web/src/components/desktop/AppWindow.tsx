import {
  Suspense,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Maximize2, Minus, Minimize2, X } from 'lucide-react';
import { cx } from '../../lib/format';
import { LoadingState } from '../states';
import { APP_MAP } from './appRegistry';
import { useWindows, type WindowState } from './windowManager';

const MIN_W = 360;
const MIN_H = 240;

interface Dir {
  l: boolean;
  r: boolean;
  t: boolean;
  b: boolean;
}

type Gesture =
  | { kind: 'move'; px: number; py: number; ox: number; oy: number }
  | {
      kind: 'resize';
      dir: Dir;
      px: number;
      py: number;
      ox: number;
      oy: number;
      ow: number;
      oh: number;
    };

// Hand-rolled drag/resize via Pointer Events. A single gesture ref drives both:
// setPointerCapture routes pointermove/up back to the element that started the
// gesture, so the same move/up handlers (shared across the titlebar and every
// resize handle) can read the active gesture and update the window's bounds.
export function AppWindow({ win }: { win: WindowState }) {
  const { focus, move, resize, minimize, toggleMaximize, close } = useWindows();
  const gesture = useRef<Gesture | null>(null);

  const app = APP_MAP[win.appKey];
  const Body = app?.component;
  // Memoize the body element: drag/resize dispatches on every pointermove and
  // rebuilds the windows array, re-rendering every AppWindow. Reusing the same
  // element lets React skip the app subtree when only geometry/chrome changed.
  const body = useMemo(() => (Body ? <Body /> : null), [Body]);
  if (!app) return null;
  const Icon = app.icon;

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;

    if (g.kind === 'move') {
      move(win.id, Math.max(0, g.ox + dx), Math.max(0, g.oy + dy));
      return;
    }

    let { ox: x, oy: y, ow: w, oh: h } = g;
    if (g.dir.r) w = g.ow + dx;
    if (g.dir.b) h = g.oh + dy;
    if (g.dir.l) {
      w = g.ow - dx;
      x = g.ox + dx;
    }
    if (g.dir.t) {
      h = g.oh - dy;
      y = g.oy + dy;
    }
    // Min-size guard: when shrinking from the left/top, pin the opposite edge.
    if (w < MIN_W) {
      if (g.dir.l) x = g.ox + (g.ow - MIN_W);
      w = MIN_W;
    }
    if (h < MIN_H) {
      if (g.dir.t) y = g.oy + (g.oh - MIN_H);
      h = MIN_H;
    }
    resize(win.id, { x: Math.max(0, x), y: Math.max(0, y), w, h });
  };

  const endGesture = (e: ReactPointerEvent) => {
    if (!gesture.current) return;
    gesture.current = null;
    // On pointercancel the browser has already released capture; guard the call.
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const startDrag = (e: ReactPointerEvent) => {
    if (win.maximized) return;
    focus(win.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind: 'move', px: e.clientX, py: e.clientY, ox: win.x, oy: win.y };
  };

  const startResize = (e: ReactPointerEvent, dir: Dir) => {
    e.stopPropagation();
    if (win.maximized) return;
    focus(win.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      kind: 'resize',
      dir,
      px: e.clientX,
      py: e.clientY,
      ox: win.x,
      oy: win.y,
      ow: win.w,
      oh: win.h,
    };
  };

  const positionStyle = win.maximized
    ? { inset: 0, zIndex: win.z }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  return (
    <div
      className={cx(
        'absolute flex flex-col overflow-hidden bg-zinc-900 shadow-2xl shadow-black/50',
        // Hide (don't unmount) when minimized so app state — terminal PTYs,
        // form input — survives; display:none also keeps it out of focus/hit-testing.
        win.minimized && 'hidden',
        win.maximized ? 'rounded-none' : 'rounded-lg',
        win.focused ? 'ring-1 ring-orange-500/60' : 'ring-1 ring-black/40',
      )}
      style={positionStyle}
      onPointerDown={() => focus(win.id)}
    >
      {/* Titlebar */}
      <div
        className={cx(
          'flex h-9 shrink-0 select-none items-center gap-2 px-3',
          win.maximized ? 'cursor-default' : 'cursor-move',
          win.focused ? 'bg-zinc-800' : 'bg-zinc-900',
        )}
        onPointerDown={startDrag}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onDoubleClick={() => toggleMaximize(win.id)}
      >
        <Icon
          className={cx('h-3.5 w-3.5 shrink-0', win.focused ? 'text-orange-400' : 'text-zinc-500')}
          aria-hidden
        />
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-xs font-medium',
            win.focused ? 'text-zinc-100' : 'text-zinc-400',
          )}
        >
          {win.title}
        </span>
        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <TitleButton label="Minimize" onClick={() => minimize(win.id)}>
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </TitleButton>
          <TitleButton label={win.maximized ? 'Restore' : 'Maximize'} onClick={() => toggleMaximize(win.id)}>
            {win.maximized ? (
              <Minimize2 className="h-3 w-3" aria-hidden />
            ) : (
              <Maximize2 className="h-3 w-3" aria-hidden />
            )}
          </TitleButton>
          <TitleButton label="Close" danger onClick={() => close(win.id)}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </TitleButton>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-4">
        <Suspense fallback={<LoadingState label="Loading…" />}>{body}</Suspense>
      </div>

      {/* Resize handles (hidden when maximized) */}
      {!win.maximized && (
        <>
          <Handle cls="top-0 left-2 right-2 h-1 cursor-ns-resize" dir={{ t: true, l: false, r: false, b: false }} start={startResize} move={onPointerMove} end={endGesture} />
          <Handle cls="bottom-0 left-2 right-2 h-1 cursor-ns-resize" dir={{ b: true, l: false, r: false, t: false }} start={startResize} move={onPointerMove} end={endGesture} />
          <Handle cls="left-0 top-2 bottom-2 w-1 cursor-ew-resize" dir={{ l: true, r: false, t: false, b: false }} start={startResize} move={onPointerMove} end={endGesture} />
          <Handle cls="right-0 top-2 bottom-2 w-1 cursor-ew-resize" dir={{ r: true, l: false, t: false, b: false }} start={startResize} move={onPointerMove} end={endGesture} />
          <Handle cls="top-0 left-0 h-3 w-3 cursor-nwse-resize" dir={{ t: true, l: true, r: false, b: false }} start={startResize} move={onPointerMove} end={endGesture} />
          <Handle cls="top-0 right-0 h-3 w-3 cursor-nesw-resize" dir={{ t: true, r: true, l: false, b: false }} start={startResize} move={onPointerMove} end={endGesture} />
          <Handle cls="bottom-0 left-0 h-3 w-3 cursor-nesw-resize" dir={{ b: true, l: true, r: false, t: false }} start={startResize} move={onPointerMove} end={endGesture} />
          <Handle cls="bottom-0 right-0 h-3 w-3 cursor-nwse-resize" dir={{ b: true, r: true, l: false, t: false }} start={startResize} move={onPointerMove} end={endGesture} />
        </>
      )}
    </div>
  );
}

function TitleButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors',
        danger ? 'hover:bg-rose-500 hover:text-white' : 'hover:bg-zinc-700 hover:text-zinc-100',
      )}
    >
      {children}
    </button>
  );
}

function Handle({
  cls,
  dir,
  start,
  move,
  end,
}: {
  cls: string;
  dir: Dir;
  start: (e: ReactPointerEvent, dir: Dir) => void;
  move: (e: ReactPointerEvent) => void;
  end: (e: ReactPointerEvent) => void;
}) {
  return (
    <div
      className={cx('absolute z-10', cls)}
      onPointerDown={(e) => start(e, dir)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}
