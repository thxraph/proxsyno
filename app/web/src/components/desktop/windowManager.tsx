import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

// In-memory window manager. Tracks every open window and the ops the desktop
// shell needs to drive them. Persists nothing across reloads (MVP).

export interface WindowState {
  id: string;
  appKey: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
}

export interface OpenOptions {
  title: string;
  w: number;
  h: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ManagerState {
  windows: WindowState[];
  zCounter: number;
  openCount: number;
}

type Action =
  | { type: 'open'; appKey: string; opts: OpenOptions }
  | { type: 'close'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'resize'; id: string; bounds: Bounds }
  | { type: 'minimize'; id: string }
  | { type: 'toggleMaximize'; id: string }
  | { type: 'restore'; id: string };

const CASCADE_ORIGIN = { x: 72, y: 48 };
const CASCADE_STEP = 28;
const CASCADE_WRAP = 6;

// Marks `id` focused (and raised) while clearing focus on every other window.
function focusWindow(state: ManagerState, id: string): ManagerState {
  const z = state.zCounter + 1;
  return {
    ...state,
    zCounter: z,
    windows: state.windows.map((w) =>
      w.id === id ? { ...w, focused: true, z } : w.focused ? { ...w, focused: false } : w,
    ),
  };
}

// After a window leaves the foreground (close/minimize), hand focus to the
// top-most window that's still visible.
function focusTopVisible(state: ManagerState): ManagerState {
  const candidates = state.windows.filter((w) => !w.minimized);
  if (candidates.length === 0) {
    return { ...state, windows: state.windows.map((w) => ({ ...w, focused: false })) };
  }
  const top = candidates.reduce((a, b) => (b.z > a.z ? b : a));
  return {
    ...state,
    windows: state.windows.map((w) => ({ ...w, focused: w.id === top.id })),
  };
}

function reducer(state: ManagerState, action: Action): ManagerState {
  switch (action.type) {
    case 'open': {
      // Single instance per app: re-focus/restore an existing window instead of
      // stacking duplicates.
      const existing = state.windows.find((w) => w.appKey === action.appKey);
      if (existing) {
        const restored = {
          ...state,
          windows: state.windows.map((w) =>
            w.id === existing.id ? { ...w, minimized: false } : w,
          ),
        };
        return focusWindow(restored, existing.id);
      }
      const offset = (state.openCount % CASCADE_WRAP) * CASCADE_STEP;
      const z = state.zCounter + 1;
      const win: WindowState = {
        id: action.appKey,
        appKey: action.appKey,
        title: action.opts.title,
        x: CASCADE_ORIGIN.x + offset,
        y: CASCADE_ORIGIN.y + offset,
        w: action.opts.w,
        h: action.opts.h,
        z,
        minimized: false,
        maximized: false,
        focused: true,
      };
      return {
        windows: [...state.windows.map((w) => ({ ...w, focused: false })), win],
        zCounter: z,
        openCount: state.openCount + 1,
      };
    }

    case 'close': {
      const next = { ...state, windows: state.windows.filter((w) => w.id !== action.id) };
      return focusTopVisible(next);
    }

    case 'focus':
      return focusWindow(state, action.id);

    case 'move':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id && !w.maximized ? { ...w, x: action.x, y: action.y } : w,
        ),
      };

    case 'resize':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id && !w.maximized ? { ...w, ...action.bounds } : w,
        ),
      };

    case 'minimize': {
      const next = {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, minimized: true, focused: false } : w,
        ),
      };
      return focusTopVisible(next);
    }

    case 'toggleMaximize': {
      const toggled = {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, maximized: !w.maximized } : w,
        ),
      };
      return focusWindow(toggled, action.id);
    }

    case 'restore': {
      const restored = {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, minimized: false } : w,
        ),
      };
      return focusWindow(restored, action.id);
    }

    default:
      return state;
  }
}

interface WindowManager {
  windows: WindowState[];
  open: (appKey: string, opts: OpenOptions) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, bounds: Bounds) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  restore: (id: string) => void;
}

const WindowContext = createContext<WindowManager | undefined>(undefined);

export function WindowProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { windows: [], zCounter: 0, openCount: 0 });

  const open = useCallback(
    (appKey: string, opts: OpenOptions) => dispatch({ type: 'open', appKey, opts }),
    [],
  );
  const close = useCallback((id: string) => dispatch({ type: 'close', id }), []);
  const focus = useCallback((id: string) => dispatch({ type: 'focus', id }), []);
  const move = useCallback(
    (id: string, x: number, y: number) => dispatch({ type: 'move', id, x, y }),
    [],
  );
  const resize = useCallback(
    (id: string, bounds: Bounds) => dispatch({ type: 'resize', id, bounds }),
    [],
  );
  const minimize = useCallback((id: string) => dispatch({ type: 'minimize', id }), []);
  const toggleMaximize = useCallback(
    (id: string) => dispatch({ type: 'toggleMaximize', id }),
    [],
  );
  const restore = useCallback((id: string) => dispatch({ type: 'restore', id }), []);

  const value = useMemo<WindowManager>(
    () => ({
      windows: state.windows,
      open,
      close,
      focus,
      move,
      resize,
      minimize,
      toggleMaximize,
      restore,
    }),
    [state.windows, open, close, focus, move, resize, minimize, toggleMaximize, restore],
  );

  return <WindowContext.Provider value={value}>{children}</WindowContext.Provider>;
}

export function useWindows(): WindowManager {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error('useWindows must be used within WindowProvider');
  return ctx;
}
