/**
 * Auth middleware + request typing. Every route except /api/auth/login and
 * /api/health is mounted behind `requireAuth`.
 */
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { ApiError } from "../util/errors.js";
import { verifySession, type SessionUser } from "./jwt.js";

// Augment Express's Request so handlers can read req.user with full typing.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** Extract + verify the session cookie, attaching req.user. 401 otherwise. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[config.cookieName] as string | undefined;
  if (!token) {
    next(ApiError.unauthorized());
    return;
  }
  const user = verifySession(token);
  if (!user) {
    next(ApiError.unauthorized("Invalid or expired session"));
    return;
  }
  req.user = user;
  next();
}

/** Verify the authenticated user is still in the admin group. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    next(ApiError.forbidden("Admin privileges required"));
    return;
  }
  next();
}
