/**
 * Generic Proxmox API proxy.
 *
 * proxsyno runs as root on the host, so `pvesh` reaches the FULL Proxmox API
 * (the same surface as the :8006 web UI) with no extra credentials. This module
 * maps an HTTP method + API path + params onto a `pvesh` invocation through the
 * args-array exec wrapper (no shell), so the frontend can drive any endpoint.
 *
 * Security: authed callers are already root-equivalent admins (see the auth
 * model), so this intentionally exposes full cluster control. The path and param
 * KEYS are charset-validated and everything is passed as separate argv tokens —
 * there is no shell, so values cannot inject. Proxmox's own permission model
 * still applies on top (pvesh runs as root@pam).
 */
import { run } from "../util/exec.js";

export type PveVerb = "get" | "create" | "set" | "delete";

const METHOD_VERB: Record<string, PveVerb> = {
  GET: "get",
  POST: "create",
  PUT: "set",
  DELETE: "delete",
};

export function methodToVerb(method: string): PveVerb | null {
  return METHOD_VERB[method.toUpperCase()] ?? null;
}

// API path after the leading slash: Proxmox paths are made of these chars only.
const PATH_RE = /^[A-Za-z0-9/_.:@%+-]*$/;
// Param keys are simple identifiers (Proxmox uses a-z, digits, _, -, and net0/scsi1 style).
const KEY_RE = /^[A-Za-z0-9_.-]+$/;

export interface PveResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

function appendParam(args: string[], key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) args.push(`--${key}`, String(item));
  } else if (typeof value === "boolean") {
    args.push(`--${key}`, value ? "1" : "0");
  } else if (typeof value === "object") {
    // Proxmox property-string params (e.g. -net0 'virtio,bridge=vmbr0') arrive
    // as plain strings from the client; nested objects aren't expected. Stringify.
    args.push(`--${key}`, JSON.stringify(value));
  } else {
    args.push(`--${key}`, String(value));
  }
}

/** Run a Proxmox API call. Never throws for API-level errors — returns {ok:false}. */
export async function pveRequest(
  verb: PveVerb,
  apiPath: string,
  params: Record<string, unknown> = {},
): Promise<PveResult> {
  const clean = apiPath.replace(/^\/+/, "");
  if (clean.startsWith("-") || !PATH_RE.test(clean)) {
    return { ok: false, status: 400, data: null, error: "invalid Proxmox API path" };
  }

  const args: string[] = [verb, `/${clean}`, "--output-format", "json"];
  for (const [k, v] of Object.entries(params)) {
    if (k === "output-format") continue; // we pin our own
    if (!KEY_RE.test(k)) continue; // skip malformed keys rather than fail the whole call
    appendParam(args, k, v);
  }

  let res;
  try {
    res = await run("pvesh", args, { allowNonZeroExit: true, timeoutMs: 60_000 });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.code !== 0) {
    // pvesh writes "<status> <message>" to stderr; surface it.
    const msg = (res.stderr || res.stdout || "Proxmox API error").trim();
    const m = /(\b[45]\d\d)\b/.exec(msg);
    const status = m ? Number(m[1]) : 502;
    return { ok: false, status, data: null, error: msg };
  }

  const out = res.stdout.trim();
  let data: unknown = null;
  if (out) {
    try {
      data = JSON.parse(out);
    } catch {
      data = out; // some endpoints return plain text
    }
  }
  return { ok: true, status: 200, data };
}
