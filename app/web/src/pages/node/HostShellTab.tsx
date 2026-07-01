import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RefreshCw, TerminalSquare } from 'lucide-react';
import { wsUrl } from '../../api/client';
import { XTERM_THEME } from '../../lib/xtermTheme';
import { Badge } from '../../components/Badge';

type Status = 'connecting' | 'open' | 'closed';

// A root login shell on the host itself — the equivalent of Proxmox's node Shell.
// Speaks the same JSON PTY protocol as the community-script Terminal, but against
// /ws/host/shell. `attempt` re-runs the socket effect (Reconnect / after exit).
export function HostShellTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [attempt, setAttempt] = useState(0);

  // Create the xterm instance once.
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      theme: XTERM_THEME,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.focus();
    termRef.current = term;
    fitRef.current = fit;

    const dataDisposable = term.onData((data: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* container not measurable yet */
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(containerRef.current);
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      dataDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // (Re)connect the socket whenever `attempt` changes.
  useEffect(() => {
    setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl('/ws/host/shell'));
    } catch {
      setStatus('closed');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      const term = termRef.current;
      const fit = fitRef.current;
      if (term && fit) {
        fit.fit();
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        term.focus();
      }
    };
    ws.onmessage = (ev) => {
      let msg: { type?: string; data?: string; code?: number; message?: string };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      const term = termRef.current;
      if (msg.type === 'output' && typeof msg.data === 'string') term?.write(msg.data);
      else if (msg.type === 'exit')
        term?.write(`\r\n\x1b[90m[shell exited with code ${msg.code}]\x1b[0m\r\n`);
      else if (msg.type === 'error')
        term?.write(`\r\n\x1b[31m[error] ${msg.message ?? 'console error'}\x1b[0m\r\n`);
    };
    ws.onclose = () => setStatus('closed');
    ws.onerror = () => {
      /* surfaced via onclose */
    };

    return () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      wsRef.current = null;
    };
  }, [attempt]);

  return (
    <div className="card flex h-[32rem] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-zinc-400" aria-hidden />
          <span className="text-sm font-medium text-zinc-100">Host shell</span>
          <span className="font-mono text-xs text-zinc-500">root@host</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            tone={status === 'open' ? 'success' : status === 'connecting' ? 'info' : 'neutral'}
          >
            {status === 'open' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
          </Badge>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setAttempt((n) => n + 1)}
            title="Restart shell"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Reconnect
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 p-2"
        style={{ backgroundColor: XTERM_THEME.background }}
      />
    </div>
  );
}
