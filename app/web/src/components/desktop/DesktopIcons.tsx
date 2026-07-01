import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cx } from '../../lib/format';
import type { AppDef } from './appRegistry';
import { useWindows } from './windowManager';

// Icon grid geometry (px). Cells are laid out top-to-bottom, then wrap into the
// next column so the set never runs off the bottom of the screen.
const CELL_W = 88;
const CELL_H = 96;
const ORIGIN = 16;
const DRAG_THRESHOLD = 5; // px of movement before a press becomes a drag (vs a click)
const STORAGE_KEY = 'proxsyno.desktop.icons';

interface Pos {
  x: number;
  y: number;
}
type PosMap = Record<string, Pos>;

function loadSaved(): PosMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PosMap = {};
    for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const { x, y } = v as Record<string, unknown>;
        if (typeof x === 'number' && typeof y === 'number') out[key] = { x, y };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function persist(map: PosMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — positions just won't survive reload */
  }
}

// Default auto-flow slot for an icon: fill a column top-to-bottom, then wrap.
function defaultPos(index: number, containerH: number): Pos {
  const rows = Math.max(1, Math.floor((containerH - ORIGIN * 2) / CELL_H));
  const col = Math.floor(index / rows);
  const row = index % rows;
  return { x: ORIGIN + col * CELL_W, y: ORIGIN + row * CELL_H };
}

// Snap a freely-dragged position to the nearest grid cell, clamped on-screen.
function snap(p: Pos, w: number, h: number): Pos {
  const col = Math.max(0, Math.round((p.x - ORIGIN) / CELL_W));
  const row = Math.max(0, Math.round((p.y - ORIGIN) / CELL_H));
  const maxX = Math.max(ORIGIN, w - CELL_W);
  const maxY = Math.max(ORIGIN, h - CELL_H);
  return {
    x: Math.min(ORIGIN + col * CELL_W, maxX),
    y: Math.min(ORIGIN + row * CELL_H, maxY),
  };
}

// Draggable desktop icons. Icons auto-arrange into as many columns as fit the
// desktop height; a drag repositions one and persists it to localStorage. Only
// user-moved icons are stored — the rest keep flowing responsively.
export function DesktopIcons({ apps }: { apps: AppDef[] }) {
  const { open } = useWindows();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [positions, setPositions] = useState<PosMap>(() => loadSaved());
  const [dragKey, setDragKey] = useState<string | null>(null);

  const drag = useRef<{
    key: string;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);
  // Set on pointerup after a real drag so the trailing click doesn't open the app.
  const justDragged = useRef(false);

  // Measure the icon layer before paint so the first render already flows into
  // the right number of columns.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const posFor = (app: AppDef, index: number): Pos =>
    positions[app.key] ?? defaultPos(index, size.h);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, pos: Pos, key: string) => {
    if (e.button !== 0) return; // primary button only
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      key,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragKey(d.key);
    }
    setPositions((prev) => ({ ...prev, [d.key]: { x: d.baseX + dx, y: d.baseY + dy } }));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    if (!d.moved) return; // a plain click; onClick will open the app
    justDragged.current = true;
    setDragKey(null);
    setPositions((prev) => {
      const p = prev[d.key];
      if (!p) return prev;
      const next = { ...prev, [d.key]: snap(p, size.w, size.h) };
      persist(next);
      return next;
    });
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      {apps.map((app, i) => {
        const Icon = app.icon;
        const pos = posFor(app, i);
        return (
          <button
            key={app.key}
            type="button"
            onPointerDown={(e) => onPointerDown(e, pos, app.key)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={() => {
              if (justDragged.current) {
                justDragged.current = false;
                return;
              }
              open(app.key, { title: app.title, ...app.defaultSize });
            }}
            style={{ left: pos.x, top: pos.y, width: CELL_W, zIndex: dragKey === app.key ? 10 : undefined }}
            className={cx(
              'group absolute flex select-none flex-col items-center gap-1 rounded-lg p-2 text-center transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-500',
              dragKey === app.key ? 'cursor-grabbing' : 'cursor-grab',
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900/80 text-zinc-300 ring-1 ring-zinc-800 transition-colors group-hover:text-orange-400">
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <span className="w-full truncate text-[11px] font-medium text-zinc-300 drop-shadow">
              {app.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
