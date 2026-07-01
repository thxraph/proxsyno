import { useSyncExternalStore } from 'react';
import { wsUrl } from '../api/client';
import type { SystemLiveSample } from '../lib/types';

export type WsStatus = 'connecting' | 'open' | 'closed';

interface UseSystemWsResult {
  sample: SystemLiveSample | null;
  history: SystemLiveSample[];
  status: WsStatus;
}

const MAX_HISTORY = 60;

// One shared /ws/system connection for the whole app (each socket triggers a
// server-side sampler). Subscribers are refcounted: the first one opens the
// socket, the last one to unmount closes it. Auto-reconnects with a short
// backoff while anyone is subscribed.
let ws: WebSocket | null = null;
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let snapshot: UseSystemWsResult = { sample: null, history: [], status: 'connecting' };
const listeners = new Set<() => void>();

function setSnapshot(patch: Partial<UseSystemWsResult>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

function connect() {
  setSnapshot({ status: 'connecting' });
  let socket: WebSocket;
  try {
    socket = new WebSocket(wsUrl('/ws/system'));
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => setSnapshot({ status: 'open' });

  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data as string) as SystemLiveSample;
      const next = [...snapshot.history, data];
      setSnapshot({
        sample: data,
        history: next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next,
      });
    } catch {
      // ignore malformed frames
    }
  };

  socket.onclose = () => {
    // A socket we already replaced (last-unsubscribe close racing a fresh
    // subscribe) must not report status or schedule a duplicate connection.
    if (socket !== ws) return;
    setSnapshot({ status: 'closed' });
    scheduleReconnect();
  };

  socket.onerror = () => {
    // close handler will deal with reconnection
    socket.close();
  };
}

function scheduleReconnect() {
  if (refCount === 0) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 3000);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  refCount += 1;
  if (refCount === 1) connect();
  return () => {
    listeners.delete(listener);
    refCount -= 1;
    if (refCount === 0) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
    }
  };
}

// Subscribes to the shared /ws/system connection.
export function useSystemWs(): UseSystemWsResult {
  return useSyncExternalStore(subscribe, () => snapshot);
}
