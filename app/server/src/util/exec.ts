/**
 * The ONLY place the backend shells out to the OS.
 *
 * Security rule #1: never build a command STRING from user input. Every call
 * here goes through `execFile`/`spawn` with an ARGS ARRAY, so arguments are
 * passed to the kernel as a vector and are never re-parsed by a shell. There is
 * deliberately no helper that takes a single command string.
 */
import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFileCb);

export interface RunOptions {
  /** stdin to write to the child process. */
  input?: string;
  /** ms before the child is killed (default 30s). */
  timeoutMs?: number;
  /** max stdout/stderr buffer in bytes (default 16 MiB). */
  maxBuffer?: number;
  /** if false (default), a non-zero exit throws CommandError. */
  allowNonZeroExit?: boolean;
  /** extra environment variables. */
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Error thrown when a command exits non-zero (and the caller didn't opt out). */
export class CommandError extends Error {
  readonly file: string;
  readonly args: readonly string[];
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(file: string, args: readonly string[], code: number, stdout: string, stderr: string) {
    super(`Command failed (${code}): ${file} ${args.join(" ")}\n${stderr.trim()}`);
    this.name = "CommandError";
    this.file = file;
    this.args = args;
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/** Thrown when the requested binary is not installed (ENOENT). */
export class CommandNotFoundError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(`Command not found: ${file}`);
    this.name = "CommandNotFoundError";
    this.file = file;
  }
}

/**
 * Run a binary with an argument vector. Resolves with stdout/stderr/code.
 *
 * @param file  binary name or absolute path (resolved via PATH). NOT a shell string.
 * @param args  argument vector — each element is one argv entry, never split.
 */
export async function run(file: string, args: readonly string[] = [], opts: RunOptions = {}): Promise<RunResult> {
  const { input, timeoutMs = 30_000, maxBuffer = 16 * 1024 * 1024, allowNonZeroExit = false, env } = opts;

  // execFile does not spawn a shell — args are passed verbatim to the binary.
  if (input === undefined) {
    try {
      // execFile defaults to utf8 string output; this overload returns strings.
      const { stdout, stderr } = await execFileP(file, args as string[], {
        timeout: timeoutMs,
        maxBuffer,
        env: env ? { ...process.env, ...env } : process.env,
      });
      return { stdout, stderr, code: 0 };
    } catch (err) {
      return handleExecError(err, file, args, allowNonZeroExit);
    }
  }

  // When stdin is needed (e.g. piping a password to `smbpasswd -s`), use spawn so
  // we can write to stdin and still avoid any shell. Secrets never appear in argv.
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(file, args as string[], {
      env: env ? { ...process.env, ...env } : process.env,
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
      if (stdout.length > maxBuffer) child.kill();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
      if (stderr.length > maxBuffer) child.kill();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (err.code === "ENOENT") reject(new CommandNotFoundError(file));
      else reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const exit = code ?? -1;
      if (exit !== 0 && !allowNonZeroExit) {
        reject(new CommandError(file, args, exit, stdout, stderr));
      } else {
        resolve({ stdout, stderr, code: exit });
      }
    });

    child.stdin.on("error", () => {
      /* ignore EPIPE if the child exits before we finish writing */
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

function handleExecError(
  err: unknown,
  file: string,
  args: readonly string[],
  allowNonZeroExit: boolean,
): RunResult {
  const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
  if (e.code === "ENOENT") throw new CommandNotFoundError(file);

  // execFile rejects with an error that carries stdout/stderr and a numeric-ish code.
  const stdout = typeof e.stdout === "string" ? e.stdout : "";
  const stderr = typeof e.stderr === "string" ? e.stderr : "";
  const exit = typeof e.code === "number" ? e.code : -1;

  if (allowNonZeroExit) return { stdout, stderr, code: exit };
  throw new CommandError(file, args, exit, stdout, stderr);
}

/** True if the named binary exists on PATH. Used to degrade gracefully. */
export async function commandExists(file: string): Promise<boolean> {
  try {
    // The script is a fixed string; `file` is passed as $0 (argv), never
    // interpolated. `command -v` exits non-zero when the binary is absent.
    const res = await run("sh", ["-c", 'command -v "$0" >/dev/null 2>&1', file], {
      allowNonZeroExit: true,
    });
    return res.code === 0;
  } catch {
    return false;
  }
}
