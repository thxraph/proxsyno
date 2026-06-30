/**
 * Typed application errors and the Express error-handling middleware that
 * renders them as the spec's `{ error: { code, message } }` JSON envelope.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

/** An error carrying an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, "bad_request", message, details);
  }
  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError(401, "unauthorized", message);
  }
  static forbidden(message = "Forbidden"): ApiError {
    return new ApiError(403, "forbidden", message);
  }
  static notFound(message = "Not found"): ApiError {
    return new ApiError(404, "not_found", message);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, "conflict", message);
  }
  static internal(message = "Internal server error", details?: unknown): ApiError {
    return new ApiError(500, "internal_error", message, details);
  }
}

/**
 * Wrap an async route handler so thrown/rejected errors flow to the error
 * middleware instead of crashing the process. Keeps handlers free of try/catch.
 * Uses Express's base RequestHandler types to avoid generic-variance friction.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** 404 fallthrough for unmatched /api routes. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound("No such endpoint"));
}

/** Terminal error handler. Must keep the 4-arg signature for Express. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: err.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "),
      },
    });
    return;
  }

  // Multer surfaces a `.code` like LIMIT_FILE_SIZE.
  if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: { code: "payload_too_large", message: "Upload exceeds size limit" } });
    return;
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  // eslint-disable-next-line no-console
  console.error("[proxsyno] unhandled error:", err);
  res.status(500).json({ error: { code: "internal_error", message } });
}
