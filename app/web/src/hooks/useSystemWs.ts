import { useEffect, useRef, useState } from 'react';
import type { SystemLiveSample } from '../lib/types';

export type WsStatus = 'connecting' | 'open' | 'closed';

interface UseSystemWsResult {
  sample: SystemLiveSample | null;
  history: SystemLiveSample[];
  status: WsStatus;
}

const MAX_HISTORY = 60;

function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${path}`;
}

// Subscribes to /ws/system. Auto-reconnects with a short backoff.
export function useSystemWs(): UseSystemWsResult {
  const [sample, setSample] = useState<SystemLiveSample | null>(null);
  const [history, setHistory] = useState<SystemLiveSample[]>([]);
  const [status, setStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUser = useRef(false);

  useEffect(() => {
    closedByUser.current = false;

    const connect = () => {
      setStatus('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl('/ws/system'));
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => setStatus('open');

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as SystemLiveSample;
          setSample(data);
          setHistory((prev) => {
            const next = [...prev, data];
            return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
          });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setStatus('closed');
        if (!closedByUser.current) scheduleReconnect();
      };

      ws.onerror = () => {
        // close handler will deal with reconnection
        ws.close();
      };
    };

    const scheduleReconnect = () => {
      if (closedByUser.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connect, 3000);
    };

    connect();

    return () => {
      closedByUser.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { sample, history, status };
}
