/**
 * Session token signing/verifying. Tokens are short-lived JWTs carrying the
 * authenticated user's name, groups, and admin flag. The secret comes from env.
 */
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface SessionUser {
  name: string;
  groups: string[];
  isAdmin: boolean;
}

interface SessionClaims extends SessionUser {
  /** standard claims added by jsonwebtoken: iat, exp */
}

export function signSession(user: SessionUser): string {
  return jwt.sign(user, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.sessionTtlSec,
    issuer: "proxsyno",
    subject: user.name,
  });
}

/** Verify a token; returns the user payload or null if invalid/expired. */
export function verifySession(token: string): SessionUser | null {
  try {
    // Pin the algorithm so a forged token can't downgrade to "none"/another alg.
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: "proxsyno",
      algorithms: ["HS256"],
    }) as SessionClaims;
    if (typeof decoded.name !== "string" || !Array.isArray(decoded.groups)) return null;
    return { name: decoded.name, groups: decoded.groups, isAdmin: Boolean(decoded.isAdmin) };
  } catch {
    return null;
  }
}
