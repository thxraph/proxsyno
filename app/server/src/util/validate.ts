/**
 * Shared zod helpers. The name regex is mandated verbatim by the SPEC
 * (security rule #5) and reused for usernames, group names, and share names.
 */
import { z } from "zod";

/** `^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$` — 1..32 chars, safe for shell/argv. */
export const NAME_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$/;

export const nameSchema = z
  .string()
  .regex(NAME_REGEX, "Must match ^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$");

/**
 * An absolute path with no control characters. The leading-slash + no-newline
 * rule is a security boundary: paths are written into smb.conf / /etc/exports
 * (inside managed markers) and used by the file browser, so a newline would let
 * a caller inject extra config lines past the marker. Further jailing for the
 * file browser still happens in fsbrowse via realpath.
 */
export const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^\/[^\0\n\r]*$/, "must be an absolute path without control characters");

/** Parse a value against a schema, surfacing zod errors to the error handler. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}
