/**
 * Application entrypoint: load env, build the Express app, attach the
 * /ws/system WebSocket sampler, and (in production) serve the built SPA.
 */
import "dotenv/config";

import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import { WebSocketServer, type WebSocket } from "ws";

import { config } from "./config.js";
import { requireAuth } from "./auth/middleware.js";
import { verifySession } from "./auth/jwt.js";
import { authRouter } from "./routes/auth.js";
import { systemRouter } from "./routes/system.js";
import { storageRouter } from "./routes/storage.js";
import { sharesRouter } from "./routes/shares.js";
import { usersRouter, groupsRouter } from "./routes/users.js";
import { filesRouter } from "./routes/files.js";
import { proxmoxRouter } from "./routes/proxmox.js";
import { pveRouter } from "./routes/pve.js";
import { dockerRouter } from "./routes/docker.js";
import { downloadsRouter } from "./routes/downloads.js";
import { photosRouter } from "./routes/photos.js";
import { notesRouter } from "./routes/notes.js";
import { surveillanceRouter } from "./routes/surveillance.js";
import { prefsRouter } from "./routes/prefs.js";
import { SystemSampler } from "./services/system.js";
import {
  isScriptInCatalog,
  spawnConsolePty,
  SCRIPT_SLUG_REGEX,
  type ConsolePty,
} from "./services/proxmox.js";
import {
  bridgeToVnc,
  createVncProxy,
  parseConsoleParams,
  type VncProxy,
} from "./services/pveconsole.js";
import { errorHandler, notFoundHandler } from "./util/errors.js";
import { securityHeaders, verifyOrigin, isSameOrigin } from "./util/security.js";

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// In production we sit behind ONE reverse proxy; trust a single hop's
// X-Forwarded-* (not "true", which would trust forwarded headers from anyone).
app.set("trust proxy", config.isProd ? 1 : false);
app.disable("x-powered-by");

// Defensive response headers on every response (SPA, static assets, and API).
app.use(securityHeaders);

// Body parsers with conservative limits (file uploads bypass these via multer).
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));
app.use(cookieParser());

// --- Public routes (no auth) ---
const api = express.Router();
// CSRF backstop: reject cross-origin state-changing requests (covers /auth/login
// too). Complements the SameSite=Strict session cookie.
api.use(verifyOrigin);
api.get("/health", (_req, res) => {
  res.json({ status: "ok", version: config.version });
});
api.use("/auth", authRouter);

// --- Authenticated routes ---
// Everything mounted after this guard requires a valid session cookie.
api.use(requireAuth);
api.use("/system", systemRouter);
api.use("/storage", storageRouter);
api.use("/shares", sharesRouter);
api.use("/users", usersRouter);
api.use("/groups", groupsRouter);
api.use("/files", filesRouter);
api.use("/proxmox", proxmoxRouter);
api.use("/pve", pveRouter);
api.use("/docker", dockerRouter);
api.use("/downloads", downloadsRouter);
api.use("/photos", photosRouter);
api.use("/notes", notesRouter);
api.use("/surveillance", surveillanceRouter);
api.use("/prefs", prefsRouter);

// Unknown /api/* path → JSON 404 (before the SPA fallback).
api.use(notFoundHandler);

app.use("/api", api);

// ---------------------------------------------------------------------------
// Production: serve the built frontend with SPA fallback
// ---------------------------------------------------------------------------

if (config.isProd && existsSync(config.webDistDir)) {
  app.use(express.static(config.webDistDir, { index: false, maxAge: "1h" }));
  // SPA fallback: any non-/api GET returns index.html so client routing works.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(config.webDistDir, "index.html"));
  });
}

// Terminal error handler (renders ApiError/zod/multer errors as JSON).
app.use(errorHandler);

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = http.createServer(app);

// noServer mode lets us authenticate the cookie during the upgrade handshake
// before accepting the socket, mirroring the HTTP auth middleware.
const wss = new WebSocketServer({ noServer: true });
// Second endpoint: the interactive Proxmox community-script console PTY.
const consoleWss = new WebSocketServer({ noServer: true });
// Third endpoint: the per-guest VNC console (qemu/lxc) bridged to noVNC.
const pveConsoleWss = new WebSocketServer({ noServer: true });

// --- WebSocket heartbeat ---------------------------------------------------
// Half-open TCP connections (client crash, NAT timeout) never fire 'close', so
// without a heartbeat the system sampler interval — and, worse, a root PTY —
// would leak forever. Ping every 30s; terminate any socket that missed the
// previous pong (terminate() fires 'close', which runs the existing cleanup).
const wsAlive = new WeakMap<WebSocket, boolean>();
function markAlive(ws: WebSocket): void {
  wsAlive.set(ws, true);
  ws.on("pong", () => wsAlive.set(ws, true));
}
function setupHeartbeat(server: WebSocketServer): void {
  const interval = setInterval(() => {
    server.clients.forEach((ws) => {
      if (wsAlive.get(ws) === false) {
        ws.terminate();
        return;
      }
      wsAlive.set(ws, false);
      try {
        ws.ping();
      } catch {
        /* socket closing */
      }
    });
  }, 30_000);
  server.on("close", () => clearInterval(interval));
}
setupHeartbeat(wss);
setupHeartbeat(consoleWss);
setupHeartbeat(pveConsoleWss);

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

server.on("upgrade", (req, socket, head) => {
  // Match on pathname only; ignore everything else (e.g. Vite HMR in dev).
  const pathname = (req.url ?? "").split("?")[0];
  const isSystem = pathname === "/ws/system";
  const isConsole = pathname === "/ws/proxmox/console";
  const isPveConsole = pathname === "/ws/pve/console";
  if (!isSystem && !isConsole && !isPveConsole) {
    socket.destroy();
    return;
  }

  // Reject cross-origin WebSocket handshakes (cross-site WS hijacking) before
  // we even look at the cookie.
  if (!isSameOrigin(req.headers.origin, req.headers.referer, req.headers.host)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  // Authenticate via the session cookie before completing the upgrade.
  const cookies = parseCookieHeader(req.headers.cookie);
  const token = cookies[config.cookieName];
  const user = token ? verifySession(token) : null;
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const target = isPveConsole ? pveConsoleWss : isConsole ? consoleWss : wss;
  target.handleUpgrade(req, socket, head, (ws) => {
    target.emit("connection", ws, req);
  });
});

wss.on("connection", (ws: WebSocket) => {
  markAlive(ws);
  const sampler = new SystemSampler();
  let alive = true;

  const tick = async (): Promise<void> => {
    if (!alive || ws.readyState !== ws.OPEN) return;
    try {
      const sample = await sampler.sample();
      ws.send(JSON.stringify(sample));
    } catch (err) {
      // Don't kill the connection on a transient sampling error.
      // eslint-disable-next-line no-console
      console.error("[proxsyno] ws sample error:", err);
    }
  };

  // Prime once immediately (deltas will be zero), then every ~2s.
  void tick();
  const interval = setInterval(() => void tick(), 2000);

  ws.on("close", () => {
    alive = false;
    clearInterval(interval);
  });
  ws.on("error", () => {
    alive = false;
    clearInterval(interval);
  });
});

// ---------------------------------------------------------------------------
// Proxmox community-script console (PTY) — JSON wire protocol per the SPEC.
// ---------------------------------------------------------------------------

function sendJson(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function clampDim(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 1000 ? n : null;
}

consoleWss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  markAlive(ws);
  void (async () => {
    const url = new URL(req.url ?? "", "http://localhost");
    const slug = url.searchParams.get("script") ?? "";

    // Validate against the strict slug regex AND the cached catalog.
    if (!SCRIPT_SLUG_REGEX.test(slug) || !(await isScriptInCatalog(slug))) {
      sendJson(ws, { type: "error", message: "Unknown or invalid script" });
      ws.close();
      return;
    }

    let pty: ConsolePty;
    try {
      pty = spawnConsolePty(slug, 80, 24);
    } catch (err) {
      sendJson(ws, {
        type: "error",
        message: `Failed to start terminal: ${err instanceof Error ? err.message : String(err)}`,
      });
      ws.close();
      return;
    }

    let killed = false;
    const cleanup = (): void => {
      if (killed) return;
      killed = true;
      try {
        pty.kill();
      } catch {
        /* already gone */
      }
    };

    pty.onData((data) => sendJson(ws, { type: "output", data }));
    pty.onExit(({ exitCode }) => {
      sendJson(ws, { type: "exit", code: exitCode });
      ws.close();
    });

    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore non-JSON frames
      }
      if (!msg || typeof msg !== "object") return;
      const m = msg as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
      if (m.type === "input" && typeof m.data === "string") {
        pty.write(m.data);
      } else if (m.type === "resize") {
        const cols = clampDim(m.cols);
        const rows = clampDim(m.rows);
        if (cols && rows) pty.resize(cols, rows);
      }
    });

    ws.on("close", cleanup);
    ws.on("error", cleanup);
  })().catch((err) => {
    sendJson(ws, {
      type: "error",
      message: `Console error: ${err instanceof Error ? err.message : String(err)}`,
    });
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Proxmox guest VNC console — ticket control frame, then a raw binary RFB pipe.
// ---------------------------------------------------------------------------

pveConsoleWss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  markAlive(ws);
  void (async () => {
    const url = new URL(req.url ?? "", "http://localhost");
    const params = parseConsoleParams(url.searchParams);
    if (!params) {
      sendJson(ws, { type: "error", message: "Invalid console parameters" });
      ws.close();
      return;
    }

    let proxy: VncProxy;
    try {
      proxy = await createVncProxy(params);
    } catch (err) {
      sendJson(ws, {
        type: "error",
        message: `Failed to open VNC proxy: ${err instanceof Error ? err.message : String(err)}`,
      });
      ws.close();
      return;
    }

    // Client may have gone away while pvesh was running.
    if (ws.readyState !== ws.OPEN) return;

    // 1) one JSON text control frame carrying the VNC password, then
    // 2) hand the socket to the raw binary bridge for noVNC.
    ws.send(JSON.stringify({ type: "vnc-ticket", ticket: proxy.ticket }));
    bridgeToVnc(ws, proxy);
  })().catch((err) => {
    sendJson(ws, {
      type: "error",
      message: `Console error: ${err instanceof Error ? err.message : String(err)}`,
    });
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

server.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[proxsyno] server listening on http://${config.host}:${config.port} ` +
      `(env=${config.nodeEnv}, filesRoot=${config.filesRoot}, adminGroup=${config.adminGroup})`,
  );
});

// Graceful shutdown for systemd (SIGTERM) and Ctrl-C (SIGINT).
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    // eslint-disable-next-line no-console
    console.log(`[proxsyno] ${sig} received, shutting down`);
    wss.clients.forEach((c) => c.close());
    consoleWss.clients.forEach((c) => c.close());
    pveConsoleWss.clients.forEach((c) => c.close());
    server.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
