/**
 * Frigate NVR integration. The backend acts as an authenticated reverse proxy
 * so the browser never needs direct access to Frigate (which runs in LXC 100,
 * default http://127.0.0.1:5000 — override with FRIGATE_URL).
 *
 * We dial Frigate with node:http/https (mirroring services/pveconsole.ts),
 * never forwarding the caller's session cookie. Image/video endpoints are
 * *streamed* through (piped, not buffered); JSON endpoints are read fully.
 *
 * If Frigate is unreachable (LXC stopped) getStatus() returns {available:false}
 * instead of throwing, so the UI can show a friendly "start LXC 100" state.
 */
import http from "node:http";
import https from "node:https";
import { config } from "../config.js";

const base = new URL(config.frigateUrl);
const client = base.protocol === "https:" ? https : http;

// Short timeouts: Frigate is on the loopback/LAN. Snapshots can be a touch
// slower than JSON, but we never want a hung LXC to wedge a request for long.
const JSON_TIMEOUT_MS = 5_000;
const MEDIA_TIMEOUT_MS = 10_000;

export interface SurveillanceStatus {
  available: boolean;
  version?: string;
  cameras?: string[];
  /** Base URL of the Frigate web UI, for an "open Frigate" link. */
  ui: string;
}

// Minimal shape of the bits of /api/config we read.
interface FrigateConfig {
  cameras?: Record<string, unknown>;
}

/**
 * GET a path on Frigate and resolve with the live response stream. The path is
 * always built from string literals + already-validated tokens by the router,
 * so it stays on the Frigate origin; we assert that as cheap defense-in-depth.
 */
function frigateRequest(path: string, timeoutMs: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    if (url.origin !== base.origin) {
      reject(new Error("refusing to proxy off-origin path"));
      return;
    }
    const req = client.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port,
        method: "GET",
        path: url.pathname + url.search,
        // Deliberately send NO headers from the caller (no cookies/auth).
      },
      resolve,
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("frigate request timed out")));
    req.end();
  });
}

async function readBody(res: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function frigateJson<T>(path: string): Promise<T> {
  const res = await frigateRequest(path, JSON_TIMEOUT_MS);
  const body = await readBody(res);
  if (res.statusCode !== 200) {
    throw new Error(`frigate ${path} -> ${res.statusCode ?? "no status"}`);
  }
  return JSON.parse(body) as T;
}

/** Probe Frigate; never throws. {available:false} when the LXC is down. */
export async function getStatus(): Promise<SurveillanceStatus> {
  try {
    const cfg = await frigateJson<FrigateConfig>("/api/config");
    let version: string | undefined;
    try {
      const res = await frigateRequest("/api/version", JSON_TIMEOUT_MS);
      const text = (await readBody(res)).trim();
      if (res.statusCode === 200 && text) version = text;
    } catch {
      // version is best-effort; config alone proves availability.
    }
    return {
      available: true,
      version,
      cameras: Object.keys(cfg.cameras ?? {}),
      ui: config.frigateUrl,
    };
  } catch {
    return { available: false, ui: config.frigateUrl };
  }
}

export interface PipeResult {
  ok: boolean;
}

/**
 * Stream a Frigate path through to an Express response. Copies the upstream
 * status + Content-Type and pipes the bytes (never buffers whole videos).
 * Resolves {ok:false} if Frigate is unreachable BEFORE any bytes are written,
 * so the caller can render a clean error; once piping starts we own the socket.
 */
export function pipeFrigate(
  path: string,
  res: import("express").Response,
  timeoutMs = MEDIA_TIMEOUT_MS,
): Promise<PipeResult> {
  return new Promise((resolve) => {
    frigateRequest(path, timeoutMs).then(
      (upstream) => {
        res.status(upstream.statusCode ?? 502);
        const ct = upstream.headers["content-type"];
        if (typeof ct === "string") res.setHeader("Content-Type", ct);
        const len = upstream.headers["content-length"];
        if (typeof len === "string") res.setHeader("Content-Length", len);
        upstream.on("error", () => res.destroy());
        upstream.pipe(res);
        resolve({ ok: true });
      },
      () => resolve({ ok: false }),
    );
  });
}
