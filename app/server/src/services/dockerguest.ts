/**
 * Docker-in-guest integration: detect and manage a Docker daemon running INSIDE
 * a Proxmox guest (qemu VM or LXC container). proxsyno runs on the host, so it
 * reaches the guest's Docker through an exec transport — never a network socket:
 *
 *   - LXC → `pct exec <vmid> -- <argv>`        (always available)
 *   - VM  → `qm guest exec <vmid> -- <argv>`   (needs qemu-guest-agent; the JSON
 *           result carries out-data/err-data/exitcode, which we parse)
 *
 * Every OS interaction goes through the args-array exec wrapper (util/exec.ts):
 * the docker command is itself an argv ARRAY (e.g. ["docker","ps","-a"]) — no
 * shell, no string interpolation. Each helper degrades gracefully when the
 * transport is unavailable rather than 500-ing.
 */
import { run, CommandNotFoundError } from "../util/exec.js";
import { ApiError } from "../util/errors.js";

// ---------------------------------------------------------------------------
// Types (mirror SPEC addendum)
// ---------------------------------------------------------------------------

export type GuestType = "qemu" | "lxc";
export type Transport = "pct" | "agent";

export type ContainerState =
  | "running"
  | "exited"
  | "created"
  | "paused"
  | "restarting"
  | "dead";

export type ContainerAction = "start" | "stop" | "restart" | "remove";

export interface DockerStatus {
  dockerInstalled: boolean;
  dockerVersion?: string;
  reachable: boolean;
  transport: Transport;
  reason?: string;
}

export interface DockerPort {
  hostIp?: string;
  hostPort?: number;
  containerPort: number;
  proto: "tcp" | "udp";
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  ports: DockerPort[];
  createdSec: number;
}

export interface RunPort {
  hostPort: number;
  containerPort: number;
  proto: "tcp" | "udp";
}

export interface RunVolume {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export interface RunEnv {
  key: string;
  value: string;
}

export interface RunContainerInput {
  image: string;
  name?: string;
  ports: RunPort[];
  volumes: RunVolume[];
  env: RunEnv[];
  restart?: "no" | "always" | "unless-stopped" | "on-failure";
  network?: string;
  command: string[];
}

// ---------------------------------------------------------------------------
// Exec transport
// ---------------------------------------------------------------------------

/** A transport-level failure: guest stopped, agent missing, host binary errored. */
export class GuestExecError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "GuestExecError";
  }
}

interface GuestExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function transportFor(type: GuestType): Transport {
  return type === "lxc" ? "pct" : "agent";
}

/** Phrases that mean the docker binary itself is absent inside the guest. */
function looksLikeDockerMissing(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("command not found") ||
    t.includes("executable file not found") ||
    t.includes("no such file or directory") ||
    t.includes("docker: not found")
  );
}

/** Phrases that mean the exec transport itself could not reach the guest. */
function looksLikeTransportFailure(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("not running") ||
    t.includes("does not exist") ||
    t.includes("guest agent") ||
    t.includes("agent is not running") ||
    t.includes("unable to open") ||
    t.includes("configuration file")
  );
}

interface QmGuestExec {
  exitcode?: number;
  "out-data"?: string;
  "err-data"?: string;
}

/** Parse the JSON `qm guest exec` prints (out-data/err-data/exitcode). */
function parseQmResult(stdout: string): GuestExecResult {
  let parsed: QmGuestExec;
  try {
    parsed = JSON.parse(stdout) as QmGuestExec;
  } catch {
    throw new GuestExecError("Could not parse qemu-guest-agent response.");
  }
  return {
    stdout: typeof parsed["out-data"] === "string" ? parsed["out-data"] : "",
    stderr: typeof parsed["err-data"] === "string" ? parsed["err-data"] : "",
    exitCode: typeof parsed.exitcode === "number" ? parsed.exitcode : 0,
  };
}

/**
 * Run an argv inside the guest via the appropriate transport. Returns the inner
 * command's stdout/stderr/exitCode; throws GuestExecError when the transport
 * itself fails (guest stopped, no agent) and CommandNotFoundError when qm/pct is
 * absent on the host.
 */
async function runInGuest(
  type: GuestType,
  vmid: number,
  argv: string[],
  timeoutMs = 60_000,
): Promise<GuestExecResult> {
  if (type === "lxc") {
    const r = await run("pct", ["exec", String(vmid), "--", ...argv], {
      allowNonZeroExit: true,
      timeoutMs,
    });
    // pct passes the inner exit code through as its own, so a non-zero code is
    // normal (e.g. docker reporting an error). Only a clear transport phrase with
    // no useful stdout is treated as the guest being unreachable.
    if (r.code !== 0 && !r.stdout && looksLikeTransportFailure(r.stderr)) {
      throw new GuestExecError(r.stderr.trim() || "pct exec failed");
    }
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.code };
  }

  // qemu: qm returns 0 when the agent call succeeded (the inner result is JSON);
  // a non-zero qm exit means the agent was unreachable or could not spawn.
  const r = await run("qm", ["guest", "exec", String(vmid), "--", ...argv], {
    allowNonZeroExit: true,
    timeoutMs,
  });
  if (r.code !== 0) {
    throw new GuestExecError(r.stderr.trim() || r.stdout.trim() || "qm guest exec failed");
  }
  return parseQmResult(r.stdout);
}

/**
 * Run `docker <args>` inside the guest, mapping transport problems to ApiErrors.
 * Callers inspect `exitCode` to decide whether the docker command itself failed.
 */
async function docker(type: GuestType, vmid: number, args: string[], timeoutMs?: number): Promise<GuestExecResult> {
  try {
    return await runInGuest(type, vmid, ["docker", ...args], timeoutMs);
  } catch (err) {
    if (err instanceof CommandNotFoundError) {
      throw ApiError.internal(`${err.file} is not available on this host`);
    }
    if (err instanceof GuestExecError) {
      throw new ApiError(502, "guest_unreachable", err.message);
    }
    throw err;
  }
}

/** Throw a clean ApiError when a docker command exited non-zero. */
function assertDockerOk(r: GuestExecResult, fallback: string): void {
  if (r.exitCode === 0) return;
  const msg = r.stderr.trim() || r.stdout.trim() || fallback;
  if (looksLikeDockerMissing(msg)) {
    throw new ApiError(502, "docker_unavailable", "Docker is not installed in this guest.");
  }
  throw ApiError.badRequest(msg);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Probe the guest: transport reachable? docker installed + daemon up? */
export async function getStatus(type: GuestType, vmid: number): Promise<DockerStatus> {
  const transport = transportFor(type);
  try {
    const r = await runInGuest(type, vmid, ["docker", "version", "--format", "{{.Server.Version}}"], 20_000);
    if (r.exitCode === 0) {
      const version = r.stdout.trim();
      const status: DockerStatus = { dockerInstalled: true, reachable: true, transport };
      if (version) status.dockerVersion = version;
      return status;
    }
    const text = `${r.stderr}\n${r.stdout}`;
    if (looksLikeDockerMissing(text)) {
      return { dockerInstalled: false, reachable: false, transport, reason: "Docker is not installed in this guest." };
    }
    // docker exists but the daemon did not answer.
    return {
      dockerInstalled: true,
      reachable: false,
      transport,
      reason: r.stderr.trim() || "Docker daemon is not reachable.",
    };
  } catch (err) {
    if (err instanceof CommandNotFoundError) {
      return { dockerInstalled: false, reachable: false, transport, reason: `${err.file} is not available on this host.` };
    }
    if (err instanceof GuestExecError) {
      if (looksLikeDockerMissing(err.message)) {
        return { dockerInstalled: false, reachable: false, transport, reason: "Docker is not installed in this guest." };
      }
      const reason =
        transport === "agent"
          ? `Guest agent not available: ${err.message}`
          : err.message;
      return { dockerInstalled: false, reachable: false, transport, reason };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

interface PsLine {
  ID?: string;
  Names?: string;
  Image?: string;
  State?: string;
  Status?: string;
  Ports?: string;
  CreatedAt?: string;
}

function normaliseState(s: string | undefined): ContainerState {
  switch (s) {
    case "running":
    case "exited":
    case "created":
    case "paused":
    case "restarting":
    case "dead":
      return s;
    default:
      return "exited";
  }
}

/** Parse one published-port token, e.g. "0.0.0.0:8080->80/tcp" or "80/tcp". */
function parsePortToken(token: string): DockerPort | null {
  const m = token
    .trim()
    .match(/^(?:([0-9.]+|::):(\d+)->)?(\d+)\/(tcp|udp)$/);
  if (!m) return null;
  const port: DockerPort = { containerPort: Number.parseInt(m[3]!, 10), proto: m[4] as "tcp" | "udp" };
  if (m[1]) port.hostIp = m[1];
  if (m[2]) port.hostPort = Number.parseInt(m[2], 10);
  return port;
}

function parsePorts(s: string | undefined): DockerPort[] {
  if (!s) return [];
  const out: DockerPort[] = [];
  for (const token of s.split(",")) {
    const p = parsePortToken(token);
    if (p) out.push(p);
  }
  return out;
}

/** Docker's CreatedAt looks like "2024-06-30 12:00:00 +0000 UTC". */
function parseCreatedSec(s: string | undefined): number {
  if (!s) return 0;
  const ms = Date.parse(s.replace(/\s+UTC$/, ""));
  return Number.isFinite(ms) ? Math.round(ms / 1000) : 0;
}

function mapPsLine(line: PsLine): DockerContainer {
  return {
    id: line.ID ?? "",
    name: (line.Names ?? "").split(",")[0]?.trim() ?? "",
    image: line.Image ?? "",
    state: normaliseState(line.State),
    status: line.Status ?? "",
    ports: parsePorts(line.Ports),
    createdSec: parseCreatedSec(line.CreatedAt),
  };
}

/** `docker ps -a --format "{{json .}}"` → one JSON object per line. */
export async function listContainers(type: GuestType, vmid: number): Promise<DockerContainer[]> {
  const r = await docker(type, vmid, ["ps", "-a", "--no-trunc", "--format", "{{json .}}"]);
  assertDockerOk(r, "Failed to list containers.");
  const out: DockerContainer[] = [];
  for (const raw of r.stdout.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      out.push(mapPsLine(JSON.parse(trimmed) as PsLine));
    } catch {
      /* skip unparseable lines */
    }
  }
  return out;
}

/** `docker inspect <id>` → the first (and only) JSON object. */
export async function inspectContainer(type: GuestType, vmid: number, id: string): Promise<unknown> {
  const r = await docker(type, vmid, ["inspect", id]);
  if (r.exitCode !== 0) {
    const msg = r.stderr.trim() || r.stdout.trim();
    if (/no such (object|container)/i.test(msg)) throw ApiError.notFound("No such container.");
    assertDockerOk(r, "Failed to inspect container.");
  }
  try {
    const arr = JSON.parse(r.stdout) as unknown[];
    if (!Array.isArray(arr) || arr.length === 0) throw ApiError.notFound("No such container.");
    return arr[0];
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.internal("Could not parse docker inspect output.");
  }
}

/** `docker logs --tail <n> <id>` → a tail snapshot (stdout + stderr combined). */
export async function getLogs(type: GuestType, vmid: number, id: string, tail: number): Promise<string> {
  const r = await docker(type, vmid, ["logs", "--tail", String(tail), id]);
  if (r.exitCode !== 0) {
    const msg = r.stderr.trim() || r.stdout.trim();
    if (/no such (object|container)/i.test(msg)) throw ApiError.notFound("No such container.");
    assertDockerOk(r, "Failed to read logs.");
  }
  // docker logs writes container stderr to our stderr stream; show both.
  return `${r.stdout}${r.stderr}`;
}

/** Lifecycle action. remove maps to `docker rm -f`. */
export async function containerAction(
  type: GuestType,
  vmid: number,
  id: string,
  action: ContainerAction,
): Promise<void> {
  const argv = action === "remove" ? ["rm", "-f", id] : [action, id];
  const r = await docker(type, vmid, argv, 120_000);
  if (r.exitCode !== 0) {
    const msg = r.stderr.trim() || r.stdout.trim();
    if (/no such (object|container)/i.test(msg)) throw ApiError.notFound("No such container.");
    assertDockerOk(r, `Failed to ${action} container.`);
  }
}

/** Build a `docker run -d` argv and create the container. Returns its id. */
export async function runContainer(type: GuestType, vmid: number, input: RunContainerInput): Promise<string> {
  const args: string[] = ["run", "-d"];
  if (input.name) args.push("--name", input.name);
  if (input.restart) args.push("--restart", input.restart);
  if (input.network) args.push("--network", input.network);
  for (const p of input.ports) {
    args.push("-p", `${p.hostPort}:${p.containerPort}/${p.proto}`);
  }
  for (const v of input.volumes) {
    args.push("-v", `${v.hostPath}:${v.containerPath}${v.readOnly ? ":ro" : ""}`);
  }
  for (const e of input.env) {
    args.push("-e", `${e.key}=${e.value}`);
  }
  args.push(input.image);
  for (const token of input.command) args.push(token);

  const r = await docker(type, vmid, args, 120_000);
  assertDockerOk(r, "Failed to create container.");
  return r.stdout.trim();
}
