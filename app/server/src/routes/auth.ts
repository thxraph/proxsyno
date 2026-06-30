/**
 * Auth routes: PAM login → JWT cookie, logout, and session introspection.
 */
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getUserGroups, getUserPasswdEntry, pamLogin } from "../auth/pam.js";
import { signSession, type SessionUser } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import { ApiError, asyncHandler } from "../util/errors.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

/** Cookie options shared by set + clear so they match (clearing needs same attrs). */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.cookieSecure, // HTTPS-only cookie; off by default for the HTTP MVP
    path: "/",
    maxAge: config.sessionTtlSec * 1000,
  };
}

// POST /api/auth/login
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);

    const ok = await pamLogin(username, password);
    if (!ok) throw ApiError.unauthorized("Invalid username or password");

    const groups = await getUserGroups(username);
    const pw = await getUserPasswdEntry(username);
    const isRoot = pw?.uid === 0;
    const isAdmin = groups.includes(config.adminGroup) || (config.allowRoot && isRoot);
    if (!isAdmin) {
      throw ApiError.forbidden(
        `Login restricted to root or members of the '${config.adminGroup}' group`,
      );
    }

    const user: SessionUser = { name: username, groups, isAdmin };
    const token = signSession(user);
    res.cookie(config.cookieName, token, cookieOptions());
    res.status(200).json({ user });
  }),
);

// POST /api/auth/logout
authRouter.post("/logout", (_req, res) => {
  // clearCookie must use matching attributes to actually remove it.
  const opts = cookieOptions();
  res.clearCookie(config.cookieName, { httpOnly: opts.httpOnly, sameSite: opts.sameSite, secure: opts.secure, path: opts.path });
  res.status(204).end();
});

// GET /api/auth/me
authRouter.get(
  "/me",
  requireAuth,
  (req, res) => {
    res.status(200).json({ user: req.user });
  },
);
