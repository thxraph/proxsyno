import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '../api/client';
import type { ConsoleClientMessage, ConsoleServerMessage } from '../lib/types';

export type ConsoleStatus = 'connecting' | 'open' | 'closed';

interface ConsoleHandlers {
  onOpen?: () => void;
  onOutput?: (data: string) => void;
  onExit?: (code: number) => void;
  onError?: (message: string) => void;
}

interface UseConsoleSocketResult {
  status: ConsoleStatus;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  close: () => void;
}

// Connects to /ws/proxmox/console?script=<slug> and speaks the SPEC JSON
// protocol. Unlike the system socket this does NOT auto-reconnect — a community
// script process runs once; reconnecting would re-run it.
export function useConsoleSocket(slug: string, handlers: ConsoleHandlers): UseConsoleSocketResult {
  const [status, setStatus] = useState<ConsoleStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  // Keep handlers in a ref so changing identities don't re-open the socket.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(`/ws/proxmox/console?script=${encodeURIComponent(slug)}`));
    } catch {
      setStatus('closed');
      handlersRef.current.onError?.('Failed to open console socket');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      handlersRef.current.onOpen?.();
    };

    ws.onmessage = (ev) => {
      let msg: ConsoleServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ConsoleServerMessage;
      } catch {
        return; // ignore malformed frames
      }
      switch (msg.type) {
        case 'output':
          handlersRef.current.onOutput?.(msg.data);
          break;
        case 'exit':
          handlersRef.current.onExit?.(msg.code);
          break;
        case 'error':
          handlersRef.current.onError?.(msg.message);
          break;
      }
    };

    ws.onerror = () => {
      handlersRef.current.onError?.('Console connection error');
    };

    ws.onclose = () => {
      setStatus('closed');
    };

    return () => {
      // Detach handlers before closing so the unmount close is silent.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
    };
  }, [slug]);

  const send = (msg: ConsoleClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  return {
    status,
    sendInput: (data: string) => send({ type: 'input', data }),
    sendResize: (cols: number, rows: number) => send({ type: 'resize', cols, rows }),
    close: () => wsRef.current?.close(),
  };
}
