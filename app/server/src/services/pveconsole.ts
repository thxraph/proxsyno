/**
 * In-browser VNC console bridge for Proxmox guests (qemu VMs + LXC containers).
 *
 * Proxmox `vncproxy` opens a short-lived VNC server on a TCP port on the local
 * node, secured by a returned `ticket` (used as the VNC password). We bridge
 * that local 127.0.0.1:<port> TCP stream to the browser WebSocket so noVNC can
 * speak raw RFB over it.
 *
 * Why the HTTP API and not `pvesh create .../vncproxy`: the CLI overrides that
 * endpoint to run the proxy in the foreground — it blocks and never prints the
 * {port, ticket} JSON we need. The real :8006 API returns that JSON immediately
 * and detaches the vncterm listener. We authenticate to it without a password by
 * minting a local PVE ticket from the cluster authkey (we run as root, so we can
 * read it) via `PVE::AccessControl` — the same primitive pvedaemon uses.
 *
 * Handshake: on ws connect the caller creates the proxy, sends the VNC `ticket`
 * to the client as ONE JSON text control frame, then hands the socket to
 * `bridgeToVnc`, which turns it into a raw binary pipe. The browser reads that
 * first frame, then attaches noVNC's RFB to the (still-open) socket with
 * `credentials.password = ticket`. Keeping the ticket on the wire (not in a
 * second REST call) lets the SAME proxy be used end-to-end and keeps the ws
 * query params limited to node/type/vmid.
 */
import { randomBytes } from "node:crypto";
import https from "node:https";
import net from "node:net";
import type { WebSocket } from "ws";
import { run } from "../util/exec.js";

// The local pveproxy. We only ever dial loopback and accept its self-signed cert.
const PVE_API_HOST = "127.0.0.1";
const PVE_API_PORT = 8006;

export type GuestType = "qemu" | "lxc";

export interface ConsoleParams {
  node: string;
  type: GuestType;
  vmid: number;
}

export interface VncProxy {
  /** TCP port on 127.0.0.1 serving raw RFB (Proxmox allocates 5900-5999). */
  port: number;
  /** Short-lived VNC password the client sends as RFB credentials. */
  ticket: string;
}

// Proxmox allocates VNC ports from PVE::Tools::next_vnc_port() in this range.
// We only ever dial 127.0.0.1 and refuse anything outside it.
const VNC_PORT_MIN = 5900;
const VNC_PORT_MAX = 5999;

/**
 * Mint a local PVE API ticket + CSRF token for root@pam straight from the
 * cluster authkey (no password). The username is passed as a perl @ARGV value,
 * never interpolated into the script source — `root@pam` in a double-quoted
 * perl string would otherwise expand `@pam` to an empty array.
 */
async function mintPveAuth(): Promise<{ ticket: string; csrf: string }> {
  const mint = async (fn: string): Promise<string> => {
    const res = await run(
      "perl",
      ["-e", `use PVE::AccessControl; print PVE::AccessControl::${fn}($ARGV[0]);`, "root@pam"],
      { timeoutMs: 10_000 },
    );
    return res.stdout.trim();
  };
  const [ticket, csrf] = await Promise.all([
    mint("assemble_ticket"),
    mint("assemble_csrf_prevention_token"),
  ]);
  if (!ticket.startsWith("PVE:")) throw new Error("failed to mint PVE auth ticket");
  return { ticket, csrf };
}

/** POST a form body to a local pveproxy API path; resolves the `data` field. */
function pveApiPost(
  apiPath: string,
  auth: { ticket: string; csrf: string },
  body = "",
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: PVE_API_HOST,
        port: PVE_API_PORT,
        method: "POST",
        path: apiPath,
        rejectUnauthorized: false, // loopback to a self-signed PVE node cert
        headers: {
          Cookie: `PVEAuthCookie=${auth.ticket}`,
          CSRFPreventionToken: auth.csrf,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`pve api ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            const parsed = JSON.parse(body) as { data?: Record<string, unknown> };
            resolve(parsed.data ?? {});
          } catch {
            reject(new Error("pve api returned non-JSON output"));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("pve api request timed out")));
    req.end(body);
  });
}

/** Ask Proxmox to open a VNC proxy for the guest. Throws on failure. */
export async function createVncProxy(params: ConsoleParams): Promise<VncProxy> {
  const { node, type, vmid } = params;
  // node/type/vmid are already validated by the route's zod schemas, so this
  // path is safe to interpolate (no shell, and the values match strict patterns).
  const auth = await mintPveAuth();
  // `websocket=1` is essential: without it, vncterm negotiates VeNCrypt
  // (security type 19, subtype X509Plain) which requires an inner TLS session
  // the browser noVNC cannot establish over a plain WebSocket — it aborts right
  // after the RFB version exchange ("connection lost"). With websocket=1 (the
  // same flag the Proxmox UI uses) vncterm offers plain VNC Auth (type 2) with
  // the ticket as the VNC password, which noVNC handles.
  const data = await pveApiPost(
    `/api2/json/nodes/${node}/${type}/${vmid}/vncproxy`,
    auth,
    "websocket=1",
  );

  const port = Number(data.port);
  // The VNC password the client sends as RFB credentials. qemu returns a
  // dedicated 8-char `password` (the ticket is only password-prefixed by luck);
  // LXC returns none, and its vncterm authenticates against the `ticket`.
  const password = typeof data.password === "string" ? data.password : "";
  const ticket = typeof data.ticket === "string" ? data.ticket : "";
  const vncPassword = password || ticket;
  if (!Number.isInteger(port) || port < VNC_PORT_MIN || port > VNC_PORT_MAX) {
    throw new Error(`vncproxy returned an out-of-range port: ${String(data.port)}`);
  }
  if (!vncPassword) throw new Error("vncproxy returned no ticket/password");
  return { port, ticket: vncPassword };
}

// ---------------------------------------------------------------------------
// One-time token store correlating the REST mint step to the WS bridge.
//
// noVNC must own the WebSocket from the moment it opens (it starts the RFB
// handshake on the socket's `open` event), so we can't hand it an already-open
// socket or send a text frame over it. Instead the browser first POSTs to mint
// a proxy and gets back { ticket, token }; it then opens the RFB WebSocket with
// ?token=..., and the WS handler swaps the token for the pre-created proxy and
// bridges raw bytes only. Tokens are single-use and short-lived.
// ---------------------------------------------------------------------------

interface PendingProxy {
  proxy: VncProxy;
  expiresAt: number;
}
const pending = new Map<string, PendingProxy>();
const TOKEN_TTL_MS = 30_000;

/** Store a freshly-minted proxy under a new one-time token; returns the token. */
export function registerProxy(proxy: VncProxy): string {
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt <= now) pending.delete(k); // opportunistic sweep
  pending.set(token, { proxy, expiresAt: now + TOKEN_TTL_MS });
  return token;
}

/** Consume a token exactly once; returns its proxy, or null if unknown/expired. */
export function consumeProxy(token: string): VncProxy | null {
  const entry = pending.get(token);
  if (!entry) return null;
  pending.delete(token);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.proxy;
}

/**
 * Pipe raw bytes both ways between the browser ws and the local VNC TCP port.
 * Either side closing (or erroring) tears down the other exactly once.
 */
export function bridgeToVnc(ws: WebSocket, proxy: VncProxy): void {
  const tcp = net.connect(proxy.port, "127.0.0.1");

  let closed = false;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    tcp.destroy();
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
  };

  // VNC server -> browser (binary RFB frames).
  tcp.on("data", (buf: Buffer) => {
    if (ws.readyState === ws.OPEN) ws.send(buf, { binary: true });
  });
  tcp.on("error", cleanup);
  tcp.on("close", cleanup);

  // browser (noVNC) -> VNC server.
  ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    const chunk = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
    if (!tcp.destroyed) tcp.write(chunk);
  });
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
