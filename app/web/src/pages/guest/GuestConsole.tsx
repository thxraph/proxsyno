import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, MonitorPlay, RefreshCw } from 'lucide-react';
import RFB from '@novnc/novnc';
import type { Guest } from '../../lib/types';
import { api, wsUrl } from '../../api/client';
import { Badge } from '../../components/Badge';
import { cx } from '../../lib/format';

type Status = 'connecting' | 'connected' | 'disconnected' | 'error';

// In-browser VNC console for a Proxmox guest (qemu VM or LXC).
//
// Protocol: open /ws/pve/console?node=&type=&vmid=. The backend sends ONE JSON
// text control frame { type:"vnc-ticket", ticket } and then switches the socket
// to a raw binary RFB pipe. We read that first frame, then hand the still-open
// socket to noVNC's RFB with the ticket as the VNC password — so RFB owns the
// socket from the very first VNC byte (no race with a separate REST call).
export function GuestConsole({ guest }: { guest: Guest }) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Bumping this re-runs the connect effect (Reconnect button).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    // Clear any canvas a previous RFB instance left behind.
    el.innerHTML = '';
    setStatus('connecting');
    setErrorMsg(null);

    let disposed = false;
    let rfb: RFB | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    // Two-step handshake: mint the proxy over REST (returns the VNC password and
    // a one-time token), then let noVNC open the WebSocket itself with that token
    // — noVNC starts the RFB handshake on the socket's `open` event, so it MUST
    // own the socket from the start (it can't adopt an already-open one).
    void (async () => {
      let ticket: string;
      let token: string;
      try {
        const r = await api.post<{ ticket: string; token: string }>('/console/vnc', {
          node: guest.node,
          type: guest.type,
          vmid: guest.vmid,
        });
        ticket = r.ticket;
        token = r.token;
      } catch (err) {
        if (!disposed) {
          setStatus('error');
          setErrorMsg(err instanceof Error ? err.message : 'Failed to open console');
        }
        return;
      }
      if (disposed) return;

      try {
        rfb = new RFB(el, wsUrl(`/ws/pve/console?token=${encodeURIComponent(token)}`), {
          credentials: { password: ticket },
        });
      } catch (err) {
        if (!disposed) {
          setStatus('error');
          setErrorMsg(err instanceof Error ? err.message : 'noVNC init failed');
        }
        return;
      }
      rfbRef.current = rfb;
      rfb.scaleViewport = true;
      rfb.background = '#000000';

      rfb.addEventListener('connect', () => {
        clearTimer();
        if (!disposed) setStatus('connected');
      });
      rfb.addEventListener('disconnect', (e: CustomEvent) => {
        clearTimer();
        if (disposed) return;
        const clean = (e.detail as { clean?: boolean } | undefined)?.clean;
        setStatus('disconnected');
        if (!clean) setErrorMsg('Connection lost');
      });
      rfb.addEventListener('securityfailure', (e: CustomEvent) => {
        clearTimer();
        if (disposed) return;
        const reason = (e.detail as { reason?: string } | undefined)?.reason;
        setStatus('error');
        setErrorMsg(reason ? `Authentication failed: ${reason}` : 'Authentication failed');
      });

      // Surface a stuck handshake instead of showing "Connecting…" forever.
      timeout = setTimeout(() => {
        if (disposed) return;
        setStatus('error');
        setErrorMsg('Timed out connecting to the console (no response from the server).');
        try {
          rfb?.disconnect();
        } catch {
          /* already gone */
        }
      }, 20_000);
    })();

    return () => {
      disposed = true;
      clearTimer();
      if (rfb) {
        try {
          rfb.disconnect();
        } catch {
          /* already gone */
        }
      }
      rfbRef.current = null;
    };
  }, [guest.node, guest.type, guest.vmid, attempt]);

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);
  const sendCtrlAltDel = useCallback(() => rfbRef.current?.sendCtrlAltDel(), []);

  const overlay = status === 'connecting' || status === 'error' || status === 'disconnected';

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <MonitorPlay className="h-4 w-4 text-slate-400" aria-hidden />
          <span className="text-sm font-medium text-slate-900 dark:text-slate-50">Console</span>
          <ConsoleStatusBadge status={status} />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={sendCtrlAltDel}
            disabled={status !== 'connected'}
          >
            <Keyboard className="h-4 w-4" /> Ctrl-Alt-Del
          </button>
          <button type="button" className="btn-secondary" onClick={reconnect}>
            <RefreshCw className="h-4 w-4" /> Reconnect
          </button>
        </div>
      </div>

      <div className="relative bg-black">
        <div ref={screenRef} className="h-[60vh] w-full" />
        {overlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center text-sm">
            {status === 'connecting' ? (
              <span className="text-slate-300">Connecting to console…</span>
            ) : (
              <div className="space-y-3">
                <p className={cx(status === 'error' ? 'text-rose-400' : 'text-slate-300')}>
                  {errorMsg ?? (status === 'error' ? 'Console error' : 'Disconnected')}
                </p>
                <button type="button" className="btn-secondary mx-auto" onClick={reconnect}>
                  <RefreshCw className="h-4 w-4" /> Reconnect
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConsoleStatusBadge({ status }: { status: Status }) {
  switch (status) {
    case 'connected':
      return <Badge tone="success">connected</Badge>;
    case 'connecting':
      return <Badge tone="warning">connecting…</Badge>;
    case 'error':
      return <Badge tone="danger">error</Badge>;
    default:
      return <Badge tone="neutral">disconnected</Badge>;
  }
}
