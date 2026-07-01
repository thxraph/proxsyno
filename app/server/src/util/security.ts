/**
 * Transport/browser-facing security hardening shared by the whole app.
 *
 *  - securityHeaders: defensive response headers (clickjacking, MIME sniffing,
 *    referrer/permissions leakage, and HSTS once we're behind TLS).
 *  - verifyOrigin: a CSRF backstop for state-changing requests. The session
 *    cookie is already SameSite=Strict, but we also reject any mutating request
 *    whose Origin/Referer names a different host than the one it was sent to.
 */
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { ApiError } from "./errors.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // Backstop for the above; also blocks framing by CSP-aware browsers.
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // Only advertise HSTS when the cookie is Secure (i.e. we're actually on TLS);
  // sending it over plain HTTP would be ignored or, worse, cached wrongly.
  if (config.cookieSecure) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

/** Host portion of an Origin/Referer URL, or null if unparseable/absent. */
function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * True unless the request declares an Origin/Referer whose host differs from the
 * host it was sent to. A missing Origin/Referer is allowed (non-browser clients;
 * the SameSite=Strict cookie already covers browser CSRF) — the check only ever
 * *rejects* a positively cross-origin request.
 */
export function isSameOrigin(
  origin: string | undefined,
  referer: string | undefined,
  host: string | undefined,
): boolean {
  const claimed = hostOf(origin) ?? hostOf(referer);
  if (claimed === null) return true;
  return !!host && claimed === host;
}

export function verifyOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }
  if (isSameOrigin(req.headers.origin, req.headers.referer, req.headers.host)) {
    next();
    return;
  }
  next(ApiError.forbidden("Cross-origin request rejected"));
}
