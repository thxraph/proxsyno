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
import { SystemSampler } from "./services/system.js";
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
  // Only handle our endpoint; ignore others (e.g. Vite HMR in dev proxies here).
  const url = req.url ?? "";
  if (!url.startsWith("/ws/system")) {
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

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
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
    server.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
