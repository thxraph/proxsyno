/**
 * Centralised, validated runtime configuration.
 *
 * Reads from process.env (populated by dotenv in index.ts before this module is
 * first imported). All other modules import the frozen `config` object so there
 * is a single source of truth for paths, secrets, and tunables.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

// Directory of THIS module at runtime (dist/ in prod, src/ under tsx in dev).
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function envStr(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${v}`);
  }
  return n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

const nodeEnv = envStr("NODE_ENV", "development");
const isProd = nodeEnv === "production";

// JWT secret: required and must be strong in production. HS256's security rests
// entirely on this secret, so we insist on >=32 chars (the installer generates
// `openssl rand -hex 32` = 64 hex chars).
const jwtSecret = envStr("PROXSYNO_JWT_SECRET", isProd ? undefined : "dev-insecure-secret");
if (isProd && jwtSecret.length < 32) {
  throw new Error("PROXSYNO_JWT_SECRET must be at least 32 characters in production.");
}

// HTTPS-only session cookie. The MVP serves plain HTTP, so this defaults OFF — a
// Secure cookie is silently dropped by browsers over http:// and login would
// appear to fail. Set COOKIE_SECURE=true once behind a TLS reverse proxy.
const cookieSecure = envBool("COOKIE_SECURE", false);
// Over TLS, use the `__Host-` prefix: browsers only accept it when it's Secure,
// Path=/, and has no Domain — pinning the cookie to this exact host and blocking
// subdomain/cross-host injection. Over plain HTTP the prefix isn't allowed, so
// fall back to the bare name.
const cookieName = cookieSecure ? "__Host-proxsyno_session" : "proxsyno_session";

// The jailed file-browser root, resolved to an absolute canonical-ish path.
const filesRoot = path.resolve(envStr("FILES_ROOT", "/mnt"));

export const config = {
  nodeEnv,
  isProd,

  host: envStr("HOST", "0.0.0.0"),
  port: envInt("PORT", 8800),

  jwtSecret,
  sessionTtlSec: envInt("SESSION_TTL_SEC", 12 * 60 * 60),
  cookieName,
  cookieSecure,

  adminGroup: envStr("ADMIN_GROUP", "sudo"),
  // Allow root (uid 0) to log in even though it is not in adminGroup. Root is
  // the natural NAS admin; set ALLOW_ROOT_LOGIN=false to forbid it.
  allowRoot: envBool("ALLOW_ROOT_LOGIN", true),
  // Defaults to the "proxsyno" PAM service (installed by install-app.sh to
  // /etc/pam.d/proxsyno) — local-only auth, no winbind. For a dev run without
  // the installer, either create that file or set PAM_SERVICE=login.
  pamService: envStr("PAM_SERVICE", "proxsyno"),

  filesRoot,
  maxUploadBytes: envInt("MAX_UPLOAD_BYTES", 5 * 1024 * 1024 * 1024),

  smbConfPath: envStr("SMB_CONF", "/etc/samba/smb.conf"),
  nfsExportsPath: envStr("NFS_EXPORTS", "/etc/exports"),
  scrubStatePath: envStr("SCRUB_STATE", "/etc/proxsyno/scrub.json"),

  // Base URL of the Frigate NVR (LXC 100). Proxied by /api/surveillance/*; the
  // browser never talks to Frigate directly. Defaults to loopback — override
  // with FRIGATE_URL once the Frigate LXC has a reachable IP.
  frigateUrl: envStr("FRIGATE_URL", "http://127.0.0.1:5000"),

  /**
   * Path to the built frontend served in production. Derived from this module's
   * location so it is correct regardless of cwd:
   *   .../app/server/dist/config.js  ->  .../app/web/dist
   * Override with WEB_DIST if the layout differs.
   */
  webDistDir: path.resolve(envStr("WEB_DIST", path.join(moduleDir, "..", "..", "web", "dist"))),

  version: "0.1.0",
} as const;
