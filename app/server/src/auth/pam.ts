/**
 * PAM authentication + group membership lookup.
 *
 * `authenticate-pam` is a native addon, so it is imported dynamically and the
 * failure is contained: if the module or the PAM service is unavailable we throw
 * a clean ApiError instead of crashing the server at import time.
 */
import os from "node:os";
import { config } from "../config.js";
import { ApiError } from "../util/errors.js";
import { run } from "../util/exec.js";

// authenticate-pam ships only a CommonJS entry and no types; load it lazily.
type PamAuthenticate = (
  username: string,
  password: string,
  cb: (err: string | null) => void,
  options?: { serviceName?: string; remoteHost?: string },
) => void;

let pamAuthenticate: PamAuthenticate | null = null;

async function getPam(): Promise<PamAuthenticate> {
  if (pamAuthenticate) return pamAuthenticate;
  try {
    const mod = (await import("authenticate-pam")) as unknown as
      | { authenticate: PamAuthenticate }
      | { default: { authenticate: PamAuthenticate } };
    const auth = "authenticate" in mod ? mod.authenticate : mod.default.authenticate;
    pamAuthenticate = auth;
    return auth;
  } catch (err) {
    throw ApiError.internal(
      "PAM module unavailable (is authenticate-pam built and libpam installed?)",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Verify a username/password pair against the host PAM stack. */
export async function pamLogin(username: string, password: string): Promise<boolean> {
  const authenticate = await getPam();
  return new Promise<boolean>((resolve) => {
    authenticate(
      username,
      password,
      (err) => resolve(err == null),
      { serviceName: config.pamService },
    );
  });
}

/**
 * Return the unix groups a user belongs to (primary + supplementary).
 * Uses `id -nG <user>` via the args-array exec wrapper.
 */
export async function getUserGroups(username: string): Promise<string[]> {
  try {
    const { stdout } = await run("id", ["-nG", username]);
    return stdout.trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Resolve a user's home + login shell (best-effort, from getent passwd). */
export async function getUserPasswdEntry(
  username: string,
): Promise<{ uid: number; home: string; shell: string } | null> {
  try {
    const { stdout } = await run("getent", ["passwd", username]);
    const line = stdout.trim();
    if (!line) return null;
    // name:x:uid:gid:gecos:home:shell
    const parts = line.split(":");
    if (parts.length < 7) return null;
    return { uid: Number.parseInt(parts[2]!, 10), home: parts[5]!, shell: parts[6]! };
  } catch {
    return null;
  }
}

export const hostname = os.hostname();
