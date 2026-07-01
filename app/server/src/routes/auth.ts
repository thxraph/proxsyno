/**
 * Auth routes: PAM login → JWT cookie, logout, and session introspection.
 */
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getUserGroups, getUserPasswdEntry, pamLogin } from "../auth/pam.js";
import { signSession, type SessionUser } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import { loginKeys, recordFailure, recordSuccess, retryAfterMs } from "../auth/rateLimit.js";
import { ApiError, asyncHandler } from "../util/errors.js";

export const authRouter = Router();

const loginSchema = z.object({
  // Constrain to a real Unix-username shape: first char alnum/underscore (so a
  // value can never be read as a `-flag` by the id/getent argv calls), no
  // whitespace or control chars. PAM would reject anything odd anyway; this is
  // defence-in-depth at the edge.
  username: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/, "Invalid username"),
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
    const keys = loginKeys(req.ip ?? "unknown", username);

    // Brute-force guard: refuse while locked out, before touching PAM.
    const locked = retryAfterMs(keys);
    if (locked > 0) {
      const secs = Math.ceil(locked / 1000);
      res.setHeader("Retry-After", String(secs));
      throw ApiError.tooManyRequests(
        "Too many failed login attempts. Try again later.",
      );
    }

    const ok = await pamLogin(username, password);
    if (!ok) {
      recordFailure(keys);
      // Generic message: never reveal whether the username exists.
      throw ApiError.unauthorized("Invalid username or password");
    }

    const groups = await getUserGroups(username);
    const pw = await getUserPasswdEntry(username);
    const isRoot = pw?.uid === 0;
    const isAdmin = groups.includes(config.adminGroup) || (config.allowRoot && isRoot);
    if (!isAdmin) {
      // Authenticated but unauthorized: still counts toward the lockout so the
      // endpoint can't be probed without limit.
      recordFailure(keys);
      throw ApiError.forbidden(
        `Login restricted to root or members of the '${config.adminGroup}' group`,
      );
    }

    recordSuccess(keys);
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
