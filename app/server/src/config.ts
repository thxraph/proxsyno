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

// JWT secret: required and must be strong in production.
const jwtSecret = envStr("PROXSYNO_JWT_SECRET", isProd ? undefined : "dev-insecure-secret");
if (isProd && jwtSecret.length < 16) {
  throw new Error("PROXSYNO_JWT_SECRET must be at least 16 characters in production.");
}

// The jailed file-browser root, resolved to an absolute canonical-ish path.
const filesRoot = path.resolve(envStr("FILES_ROOT", "/mnt"));

export const config = {
  nodeEnv,
  isProd,

  host: envStr("HOST", "0.0.0.0"),
  port: envInt("PORT", 8800),

  jwtSecret,
  sessionTtlSec: envInt("SESSION_TTL_SEC", 12 * 60 * 60),
  cookieName: "proxsyno_session",
  // Mark the session cookie Secure (HTTPS-only). The MVP serves plain HTTP, so
  // this defaults to OFF — a Secure cookie would be silently dropped by browsers
  // over http:// and login would appear to fail. Set COOKIE_SECURE=true once the
  // app sits behind a TLS reverse proxy.
  cookieSecure: envBool("COOKIE_SECURE", false),

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

  /**
   * Path to the built frontend served in production. Derived from this module's
   * location so it is correct regardless of cwd:
   *   .../app/server/dist/config.js  ->  .../app/web/dist
   * Override with WEB_DIST if the layout differs.
   */
  webDistDir: path.resolve(envStr("WEB_DIST", path.join(moduleDir, "..", "..", "web", "dist"))),

  version: "0.1.0",
} as const;

export type Config = typeof config;
