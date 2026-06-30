/**
 * Download Station engine.
 *
 * Security rule #1: every external program is launched with `spawn`/`run` using
 * an ARGS ARRAY — no shell strings are ever built from the URL or destination.
 * Security rule #2: download destinations are resolved through the file-browser
 * jail helpers (services/fsbrowse.ts) so a download can never be written outside
 * `config.filesRoot`.
 *
 * Two interchangeable engines:
 *  - aria2 (preferred, if `aria2c` is installed): a single RPC daemon handles
 *    http/https/magnet/torrent with native pause/resume and progress.
 *  - wget (fallback): one process per download, http(s) only; progress is read
 *    from the partial file's on-disk size. magnet/torrent are unavailable.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { run } from "../util/exec.js";
import { resolveExistingInsideJail } from "./fsbrowse.js";
import { ApiError } from "../util/errors.js";

export type DownloadStatus = "queued" | "active" | "paused" | "done" | "error";
export type DownloadAction = "pause" | "resume" | "cancel";

export interface DownloadJob {
  id: string;
  url: string;
  /** Jailed absolute destination directory. */
  dest: string;
  /** Resolved filename once the engine knows it (null while unknown). */
  filename: string | null;
  status: DownloadStatus;
  bytesTotal: number;
  bytesDone: number;
  /** bytes/sec, 0 unless actively downloading. */
  speed: number;
  error: string | null;
  createdAt: number;
  engine: "aria2" | "wget";
}

// Where the small state file lives. The service runs as root in production, so
// /var/lib/proxsyno is writable; persistence is best-effort either way.
const DATA_DIR = process.env.PROXSYNO_DATA_DIR || "/var/lib/proxsyno";
const STATE_FILE = path.join(DATA_DIR, "downloads.json");

// ---------------------------------------------------------------------------
// In-memory state (only DownloadJob[] is persisted)
// ---------------------------------------------------------------------------

const jobs = new Map<string, DownloadJob>();
const wgetProcs = new Map<string, ChildProcess>(); // wget: id -> live process
const aria2Gids = new Map<string, string>(); // aria2: id -> gid (never persisted)
// Per-job sampling state for the wget speed calculation.
const lastSample = new Map<string, { bytes: number; at: number }>();

let pollTimer: NodeJS.Timeout | null = null;
let loaded = false;

// ---------------------------------------------------------------------------
// Engine detection
// ---------------------------------------------------------------------------

let aria2Available: boolean | null = null;

async function hasAria2(): Promise<boolean> {
  if (aria2Available === null) {
    try {
      await run("aria2c", ["--version"]);
      aria2Available = true;
    } catch {
      aria2Available = false;
    }
  }
  return aria2Available;
}

export async function getCapabilities(): Promise<{ engine: "aria2" | "wget"; magnet: boolean }> {
  const aria = await hasAria2();
  return { engine: aria ? "aria2" : "wget", magnet: aria };
}

// ---------------------------------------------------------------------------
// aria2 RPC daemon
// ---------------------------------------------------------------------------

interface Aria2Daemon {
  proc: ChildProcess;
  port: number;
  secret: string;
  ready: Promise<void>;
}

let aria2: Aria2Daemon | null = null;
// In-flight start guard: concurrent first downloads must share ONE spawn, not
// race two daemons onto the same RPC port. Cleared on success or failure so a
// later call can retry after a crash.
let aria2Starting: Promise<Aria2Daemon> | null = null;

async function rpcCall<T>(port: number, secret: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: [`token:${secret}`, ...params],
    }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`aria2 ${method}: ${body.error.message}`);
  return body.result as T;
}

async function startAria2(): Promise<Aria2Daemon> {
  const port = Number(process.env.ARIA2_RPC_PORT) || 6810;
  const secret = randomBytes(16).toString("hex");
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => undefined);

  const proc = spawn(
    "aria2c",
    [
      "--enable-rpc",
      "--rpc-listen-all=false",
      `--rpc-listen-port=${port}`,
      `--rpc-secret=${secret}`,
      "--continue=true",
      "--dir",
      DATA_DIR,
      "--quiet=true",
    ],
    { stdio: "ignore" },
  );
  proc.on("exit", () => {
    aria2 = null;
  });

  const ready = (async () => {
    // Poll getVersion until the RPC port answers (or give up after ~5s).
    for (let i = 0; i < 25; i++) {
      try {
        await rpcCall(port, secret, "aria2.getVersion", []);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error("aria2c RPC daemon did not become ready");
  })();

  try {
    await ready;
  } catch (err) {
    // Don't leave a half-started daemon holding the RPC port.
    proc.kill();
    throw err;
  }
  return { proc, port, secret, ready };
}

async function ensureAria2(): Promise<Aria2Daemon> {
  if (aria2) return aria2;
  // Coalesce concurrent first-callers onto a single spawn; publish `aria2` only
  // after readiness succeeds, and clear the guard either way so a crash can retry.
  if (!aria2Starting) {
    aria2Starting = startAria2()
      .then((d) => {
        aria2 = d;
        return d;
      })
      .finally(() => {
        aria2Starting = null;
      });
  }
  return aria2Starting;
}

async function aria2Rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const a = await ensureAria2();
  return rpcCall<T>(a.port, a.secret, method, params);
}

// ---------------------------------------------------------------------------
// wget engine
// ---------------------------------------------------------------------------

/** Derive a safe single-segment filename from a URL (no path separators). */
function urlFilename(url: string): string {
  try {
    const base = path.basename(new URL(url).pathname);
    const clean = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
    return clean || "download";
  } catch {
    return "download";
  }
}

function wgetDestFile(job: DownloadJob): string {
  return path.join(job.dest, job.filename ?? "download");
}

function startWget(job: DownloadJob): void {
  const destFile = wgetDestFile(job);
  // --continue resumes a partial file; `--` ends options so a hostile URL can't
  // be parsed as a flag. The URL is one argv element — never a shell string.
  const proc = spawn(
    "wget",
    ["--continue", "--tries=3", "--timeout=30", "--output-document", destFile, "--", job.url],
    { stdio: "ignore" },
  );
  wgetProcs.set(job.id, proc);
  job.status = "active";
  job.error = null;

  proc.on("exit", (code, signal) => {
    wgetProcs.delete(job.id);
    lastSample.delete(job.id);
    // A signal means WE killed it (pause/cancel); the action already set status.
    if (signal) return;
    if (code === 0) {
      job.status = "done";
      if (job.bytesTotal === 0) job.bytesTotal = job.bytesDone;
      job.bytesDone = job.bytesTotal;
      job.speed = 0;
    } else {
      job.status = "error";
      job.error = `wget exited with code ${code ?? -1}`;
      job.speed = 0;
    }
    void persist();
  });
}

/** Best-effort Content-Length probe so the UI can show a real progress bar. */
async function probeContentLength(job: DownloadJob): Promise<void> {
  try {
    const res = await fetch(job.url, { method: "HEAD" });
    const len = res.headers.get("content-length");
    if (len && job.bytesTotal === 0) job.bytesTotal = Number(len);
  } catch {
    /* server may reject HEAD — total stays unknown, that's fine */
  }
}

// ---------------------------------------------------------------------------
// Progress polling (single shared interval)
// ---------------------------------------------------------------------------

function ensurePolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void pollAll(), 1000);
  pollTimer.unref();
}

async function pollAll(): Promise<void> {
  let dirty = false;
  for (const job of jobs.values()) {
    if (job.status !== "active" && job.status !== "queued") continue;
    try {
      if (job.engine === "aria2") dirty = (await pollAria2(job)) || dirty;
      else dirty = (await pollWget(job)) || dirty;
    } catch {
      /* transient sampling error — leave the job as-is */
    }
  }
  if (dirty) await persist();
}

async function pollAria2(job: DownloadJob): Promise<boolean> {
  const gid = aria2Gids.get(job.id);
  if (!gid) return false;
  const st = await aria2Rpc<{
    status: string;
    totalLength: string;
    completedLength: string;
    downloadSpeed: string;
    errorMessage?: string;
    files?: { path: string }[];
  }>("aria2.tellStatus", [gid]);

  job.bytesTotal = Number(st.totalLength) || 0;
  job.bytesDone = Number(st.completedLength) || 0;
  job.speed = Number(st.downloadSpeed) || 0;
  const p = st.files?.[0]?.path;
  if (p) job.filename = path.basename(p);

  if (st.status === "complete") {
    job.status = "done";
    job.speed = 0;
  } else if (st.status === "error") {
    job.status = "error";
    job.error = st.errorMessage || "download failed";
    job.speed = 0;
  } else if (st.status === "active") {
    job.status = "active";
  } else if (st.status === "waiting") {
    job.status = "queued";
  }
  return true;
}

async function pollWget(job: DownloadJob): Promise<boolean> {
  try {
    const { size } = await fs.stat(wgetDestFile(job));
    const now = Date.now();
    const prev = lastSample.get(job.id);
    if (prev && now > prev.at) {
      job.speed = Math.max(0, Math.round(((size - prev.bytes) * 1000) / (now - prev.at)));
    }
    lastSample.set(job.id, { bytes: size, at: now });
    job.bytesDone = size;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persist(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify([...jobs.values()]), "utf8");
  } catch {
    /* best-effort — losing the state file is non-fatal */
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const arr = JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as DownloadJob[];
    for (const j of arr) {
      // Live processes/gids don't survive a restart; anything that was in
      // flight becomes resumable (paused).
      if (j.status === "active" || j.status === "queued") {
        j.status = "paused";
        j.speed = 0;
      }
      jobs.set(j.id, j);
    }
  } catch {
    /* no state file yet */
  }
}

// ---------------------------------------------------------------------------
// Public API (consumed by routes/downloads.ts)
// ---------------------------------------------------------------------------

export async function listDownloads(): Promise<DownloadJob[]> {
  await ensureLoaded();
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function addDownload(url: string, dest: string): Promise<DownloadJob> {
  await ensureLoaded();

  // Resolve + jail the destination; it must be an existing directory.
  const destDir = await resolveExistingInsideJail(dest);
  const st = await fs.stat(destDir);
  if (!st.isDirectory()) throw ApiError.badRequest("Destination is not a directory");

  const scheme = url.split(":", 1)[0].toLowerCase();
  const aria = await hasAria2();
  if (!aria && scheme !== "http" && scheme !== "https") {
    throw ApiError.badRequest(
      "magnet/torrent downloads require aria2c, which is not installed on this host",
    );
  }

  const job: DownloadJob = {
    id: randomUUID(),
    url,
    dest: destDir,
    filename: aria ? null : urlFilename(url),
    status: "queued",
    bytesTotal: 0,
    bytesDone: 0,
    speed: 0,
    error: null,
    createdAt: Date.now(),
    engine: aria ? "aria2" : "wget",
  };
  jobs.set(job.id, job);

  try {
    if (aria) {
      const gid = await aria2Rpc<string>("aria2.addUri", [[url], { dir: destDir }]);
      aria2Gids.set(job.id, gid);
      job.status = "active";
    } else {
      startWget(job);
      void probeContentLength(job);
    }
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : "Failed to start download";
  }

  ensurePolling();
  await persist();
  return job;
}

export async function actionDownload(id: string, action: DownloadAction): Promise<DownloadJob> {
  await ensureLoaded();
  const job = jobs.get(id);
  if (!job) throw ApiError.notFound("Download not found");

  if (job.engine === "aria2") {
    const gid = aria2Gids.get(id);
    if (action === "pause") {
      if (gid) await aria2Rpc("aria2.pause", [gid]);
      job.status = "paused";
      job.speed = 0;
    } else if (action === "resume") {
      if (gid) {
        await aria2Rpc("aria2.unpause", [gid]);
      } else {
        // gid was lost (e.g. across a restart) — re-add to the daemon.
        const ngid = await aria2Rpc<string>("aria2.addUri", [[job.url], { dir: job.dest }]);
        aria2Gids.set(id, ngid);
      }
      job.status = "active";
      job.error = null;
      ensurePolling();
    } else {
      if (gid) {
        await aria2Rpc("aria2.remove", [gid]).catch(() => undefined);
        await aria2Rpc("aria2.removeDownloadResult", [gid]).catch(() => undefined);
      }
      aria2Gids.delete(id);
      job.status = "error";
      job.error = "Canceled";
      job.speed = 0;
    }
  } else {
    const proc = wgetProcs.get(id);
    if (action === "pause") {
      job.status = "paused";
      job.speed = 0;
      proc?.kill("SIGTERM");
    } else if (action === "resume") {
      startWget(job);
      void probeContentLength(job);
      ensurePolling();
    } else {
      job.status = "error";
      job.error = "Canceled";
      job.speed = 0;
      proc?.kill("SIGTERM");
      await fs.rm(wgetDestFile(job), { force: true }).catch(() => undefined);
    }
  }

  await persist();
  return job;
}

export async function removeDownload(id: string): Promise<void> {
  await ensureLoaded();
  const job = jobs.get(id);
  if (!job) throw ApiError.notFound("Download not found");

  if (job.engine === "aria2") {
    const gid = aria2Gids.get(id);
    if (gid) {
      await aria2Rpc("aria2.remove", [gid]).catch(() => undefined);
      await aria2Rpc("aria2.removeDownloadResult", [gid]).catch(() => undefined);
    }
    aria2Gids.delete(id);
  } else {
    wgetProcs.get(id)?.kill("SIGTERM");
    wgetProcs.delete(id);
  }
  // The job record is removed; a finished file is left in place for the user.
  lastSample.delete(id);
  jobs.delete(id);
  await persist();
}
