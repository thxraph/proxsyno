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
import { SystemSampler } from "./services/system.js";
import {
  isScriptInCatalog,
  spawnConsolePty,
  SCRIPT_SLUG_REGEX,
  type ConsolePty,
} from "./services/proxmox.js";
import { errorHandler, notFoundHandler } from "./util/errors.js";

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// We sit behind a reverse proxy in production; trust X-Forwarded-* for secure cookies.
app.set("trust proxy", true);
app.disable("x-powered-by");

// Body parsers with conservative limits (file uploads bypass these via multer).
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));
app.use(cookieParser());

// --- Public routes (no auth) ---
const api = express.Router();
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
  if (!isSystem && !isConsole) {
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

  const target = isConsole ? consoleWss : wss;
  target.handleUpgrade(req, socket, head, (ws) => {
    target.emit("connection", ws, req);
  });
});

wss.on("connection", (ws: WebSocket) => {
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
    server.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
