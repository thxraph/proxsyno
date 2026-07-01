import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { TerminalSquare, X } from 'lucide-react';
import { cx } from '../lib/format';
import { XTERM_THEME } from '../lib/xtermTheme';
import { Badge } from './Badge';
import { useConsoleSocket, type ConsoleStatus } from '../hooks/useConsoleSocket';

interface TerminalProps {
  slug: string;
  // Human-friendly label for the header (e.g. the script name).
  name: string;
  onClose: () => void;
}

const STATUS_LABEL: Record<ConsoleStatus, string> = {
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Disconnected',
};

export function Terminal({ slug, name, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // The socket hook is given stable-enough handlers; it stores them in a ref.
  const socket = useConsoleSocket(slug, {
    onOpen: () => {
      const fit = fitRef.current;
      if (fit && termRef.current) {
        fit.fit();
        socketRef.current?.sendResize(termRef.current.cols, termRef.current.rows);
      }
    },
    onOutput: (data) => termRef.current?.write(data),
    onExit: (code) => {
      setExitCode(code);
      termRef.current?.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
    },
    onError: (message) => {
      setErrorMsg(message);
      termRef.current?.write(`\r\n\x1b[31m[error] ${message}\x1b[0m\r\n`);
    },
  });

  // Keep a ref to the latest socket so the onOpen handler (created above before
  // `socket` is assigned) can reach the live sender without stale closures.
  const socketRef = useRef(socket);
  socketRef.current = socket;

  // Create the xterm instance once and wire it to the socket.
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

    const dataDisposable = term.onData((data: string) => socketRef.current?.sendInput(data));

    const onResize = () => {
      try {
        fit.fit();
      } catch {
        // container not measurable yet; ignore
      }
      socketRef.current?.sendResize(term.cols, term.rows);
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

  return (
    <div className="card flex h-[32rem] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{name}</span>
          <span className="font-mono text-xs text-slate-400">ct/{slug}.sh</span>
        </div>
        <div className="flex items-center gap-3">
          {exitCode !== null ? (
            <Badge tone={exitCode === 0 ? 'success' : 'danger'}>Exit {exitCode}</Badge>
          ) : (
            <Badge
              tone={
                socket.status === 'open'
                  ? 'success'
                  : socket.status === 'connecting'
                    ? 'info'
                    : 'neutral'
              }
            >
              {STATUS_LABEL[socket.status]}
            </Badge>
          )}
          <button
            type="button"
            className="btn-ghost h-8 w-8 rounded-lg p-0"
            onClick={() => {
              socket.close();
              onClose();
            }}
            title="Close terminal"
            aria-label="Close terminal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {errorMsg}
        </div>
      )}

      <div
        ref={containerRef}
        className={cx('min-h-0 flex-1 p-2')}
        style={{ backgroundColor: XTERM_THEME.background }}
      />
    </div>
  );
}
