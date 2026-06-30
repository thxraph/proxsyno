/**
 * Unix user & group management plus Samba account integration.
 *
 * All shell-outs use the args-array exec wrapper. Passwords are passed via
 * STDIN (chpasswd / smbpasswd -s), never on argv, so they never appear in the
 * process table.
 */
import { ApiError } from "../util/errors.js";
import { run, CommandNotFoundError } from "../util/exec.js";

export interface NasUser {
  name: string;
  uid: number;
  groups: string[];
  hasSamba: boolean;
  shell: string;
  home: string;
}

export interface NasGroup {
  name: string;
  gid: number;
  members: string[];
}

const HUMAN_UID_MIN = 1000;
const EXCLUDED = new Set(["nobody"]);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface PasswdEntry {
  name: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
}

async function readPasswd(): Promise<PasswdEntry[]> {
  const { stdout } = await run("getent", ["passwd"]);
  const entries: PasswdEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const p = line.split(":");
    if (p.length < 7) continue;
    entries.push({
      name: p[0]!,
      uid: Number.parseInt(p[2]!, 10),
      gid: Number.parseInt(p[3]!, 10),
      home: p[5]!,
      shell: p[6]!,
    });
  }
  return entries;
}

async function readGroups(): Promise<NasGroup[]> {
  const { stdout } = await run("getent", ["group"]);
  const groups: NasGroup[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const p = line.split(":");
    if (p.length < 4) continue;
    groups.push({
      name: p[0]!,
      gid: Number.parseInt(p[2]!, 10),
      members: (p[3] ?? "").split(",").map((m) => m.trim()).filter(Boolean),
    });
  }
  return groups;
}

/** Names with a Samba account (from `pdbedit -L`). Empty set if pdbedit absent. */
async function readSambaUsers(): Promise<Set<string>> {
  try {
    const { stdout } = await run("pdbedit", ["-L"], { allowNonZeroExit: true });
    const set = new Set<string>();
    for (const line of stdout.split("\n")) {
      const name = line.split(":")[0]?.trim();
      if (name) set.add(name);
    }
    return set;
  } catch {
    return new Set();
  }
}

/** Build the supplementary+primary group list for a user. */
function groupsForUser(name: string, primaryGid: number, allGroups: NasGroup[]): string[] {
  const result = new Set<string>();
  for (const g of allGroups) {
    if (g.gid === primaryGid) result.add(g.name);
    if (g.members.includes(name)) result.add(g.name);
  }
  return [...result];
}

export async function listUsers(): Promise<NasUser[]> {
  const [passwd, groups, samba] = await Promise.all([readPasswd(), readGroups(), readSambaUsers()]);
  return passwd
    .filter((u) => u.uid >= HUMAN_UID_MIN && !EXCLUDED.has(u.name))
    .map((u) => ({
      name: u.name,
      uid: u.uid,
      groups: groupsForUser(u.name, u.gid, groups),
      hasSamba: samba.has(u.name),
      shell: u.shell,
      home: u.home,
    }));
}

export async function listGroups(): Promise<NasGroup[]> {
  return readGroups();
}

async function userExists(name: string): Promise<boolean> {
  try {
    await run("getent", ["passwd", name]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Set a unix password via `chpasswd` (reads "user:pass" from stdin). */
async function setUnixPassword(name: string, password: string): Promise<void> {
  // chpasswd reads name:password from stdin — password never hits argv.
  await run("chpasswd", [], { input: `${name}:${password}\n` });
}

/** Add (or update) a Samba account. `smbpasswd -s` reads the pw twice on stdin. */
async function setSambaPassword(name: string, password: string): Promise<void> {
  try {
    // -a add if missing, -s silent (stdin), feed password twice (new + confirm).
    await run("smbpasswd", ["-a", "-s", name], { input: `${password}\n${password}\n` });
  } catch (err) {
    if (err instanceof CommandNotFoundError) {
      throw ApiError.internal("smbpasswd not found — install the samba package");
    }
    throw err;
  }
}

/** Remove a Samba account if present (best-effort). */
async function removeSambaAccount(name: string): Promise<void> {
  try {
    await run("smbpasswd", ["-x", name], { allowNonZeroExit: true });
  } catch {
    /* ignore */
  }
}

/** Validate that all requested groups exist; throws 400 otherwise. */
async function assertGroupsExist(groups: string[]): Promise<void> {
  if (groups.length === 0) return;
  const existing = new Set((await readGroups()).map((g) => g.name));
  const missing = groups.filter((g) => !existing.has(g));
  if (missing.length > 0) {
    throw ApiError.badRequest(`Unknown group(s): ${missing.join(", ")}`);
  }
}

export interface CreateUserInput {
  name: string;
  password: string;
  groups?: string[];
  sambaEnabled?: boolean;
}

export async function createUser(input: CreateUserInput): Promise<NasUser> {
  if (await userExists(input.name)) {
    throw ApiError.conflict(`User already exists: ${input.name}`);
  }
  await assertGroupsExist(input.groups ?? []);

  // Create a normal human user with a home dir and bash shell.
  const args = ["-m", "-s", "/bin/bash"];
  if (input.groups && input.groups.length > 0) {
    args.push("-G", input.groups.join(","));
  }
  args.push(input.name);

  try {
    await run("useradd", args);
  } catch (err) {
    if (err instanceof CommandNotFoundError) throw ApiError.internal("useradd not found");
    throw err;
  }

  // Set the password; if this fails, roll back the half-created account.
  try {
    await setUnixPassword(input.name, input.password);
    if (input.sambaEnabled) await setSambaPassword(input.name, input.password);
  } catch (err) {
    await run("userdel", ["-r", input.name], { allowNonZeroExit: true });
    throw err;
  }

  const created = (await listUsers()).find((u) => u.name === input.name);
  if (!created) throw ApiError.internal("User created but could not be read back");
  return created;
}

export interface UpdateUserInput {
  password?: string;
  groups?: string[];
  sambaEnabled?: boolean;
}

export async function updateUser(name: string, input: UpdateUserInput): Promise<NasUser> {
  if (!(await userExists(name))) {
    throw ApiError.notFound(`User not found: ${name}`);
  }

  if (input.groups) {
    await assertGroupsExist(input.groups);
    // -G with the full set replaces supplementary groups (no -a → exact set).
    await run("usermod", ["-G", input.groups.join(","), name]);
  }

  if (input.password) {
    await setUnixPassword(name, input.password);
  }

  if (input.sambaEnabled === true) {
    if (!input.password) {
      throw ApiError.badRequest("Enabling Samba requires a password in the same request");
    }
    await setSambaPassword(name, input.password);
  } else if (input.sambaEnabled === false) {
    await removeSambaAccount(name);
  }

  const updated = (await listUsers()).find((u) => u.name === name);
  if (!updated) throw ApiError.internal("User updated but could not be read back");
  return updated;
}

export async function deleteUser(name: string, deleteHome: boolean): Promise<void> {
  if (!(await userExists(name))) {
    throw ApiError.notFound(`User not found: ${name}`);
  }
  await removeSambaAccount(name);
  const args = deleteHome ? ["-r", name] : [name];
  try {
    await run("userdel", args);
  } catch (err) {
    if (err instanceof CommandNotFoundError) throw ApiError.internal("userdel not found");
    throw err;
  }
}

/**
 * Guard: refuse destructive ops on system-critical accounts (uid < 1000).
 * Throws 404 if the user doesn't exist, 403 if it's a system account.
 */
export async function assertHumanUser(name: string): Promise<void> {
  const { stdout } = await run("id", ["-u", name]).catch(() => ({ stdout: "" }));
  const uid = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(uid)) {
    throw ApiError.notFound(`User not found: ${name}`);
  }
  if (uid < HUMAN_UID_MIN) {
    throw ApiError.forbidden(`Refusing to modify system account: ${name} (uid ${uid})`);
  }
}
