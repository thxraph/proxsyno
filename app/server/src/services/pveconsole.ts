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
import https from "node:https";
import net from "node:net";
import type { WebSocket } from "ws";
import { run } from "../util/exec.js";

// The local pveproxy. We only ever dial loopback and accept its self-signed cert.
const PVE_API_HOST = "127.0.0.1";
const PVE_API_PORT = 8006;

export type GuestType = "qemu" | "lxc";

export const NODE_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

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

/** Validate the ws query params; returns null on any malformed value. */
export function parseConsoleParams(search: URLSearchParams): ConsoleParams | null {
  const node = search.get("node") ?? "";
  const type = search.get("type") ?? "";
  const vmidRaw = search.get("vmid") ?? "";
  if (!NODE_NAME_REGEX.test(node)) return null;
  if (type !== "qemu" && type !== "lxc") return null;
  const vmid = Number(vmidRaw);
  if (!Number.isInteger(vmid) || vmid <= 0) return null;
  return { node, type, vmid };
}

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

/** POST an empty body to a local pveproxy API path; resolves the `data` field. */
function pveApiPost(
  apiPath: string,
  auth: { ticket: string; csrf: string },
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
          "Content-Length": "0",
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
    req.end();
  });
}

/** Ask Proxmox to open a VNC proxy for the guest. Throws on failure. */
export async function createVncProxy(params: ConsoleParams): Promise<VncProxy> {
  const { node, type, vmid } = params;
  // node/type/vmid are already validated by parseConsoleParams, so this path is
  // safe to interpolate (no shell, and the values match strict patterns).
  const auth = await mintPveAuth();
  const data = await pveApiPost(`/api2/json/nodes/${node}/${type}/${vmid}/vncproxy`, auth);

  const port = Number(data.port);
  const ticket = typeof data.ticket === "string" ? data.ticket : "";
  if (!Number.isInteger(port) || port < VNC_PORT_MIN || port > VNC_PORT_MAX) {
    throw new Error(`vncproxy returned an out-of-range port: ${String(data.port)}`);
  }
  if (!ticket) throw new Error("vncproxy returned no ticket");
  return { port, ticket };
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
    if (tcp.destroyed) return;
    if (Buffer.isBuffer(data)) tcp.write(data);
    else if (Array.isArray(data)) tcp.write(Buffer.concat(data));
    else tcp.write(Buffer.from(data));
  });
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
