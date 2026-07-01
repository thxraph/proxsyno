// Frontend contract — mirrors the response shapes in SPEC.md "API contract".
// Field names match the SPEC exactly.

// ---- Auth ----
export interface User {
  name: string;
  groups: string[];
  isAdmin: boolean;
}

export interface AuthResponse {
  user: User;
}

// ---- System / health ----
export interface HealthResponse {
  status: string;
  version: string;
}

export interface SystemCpu {
  model: string;
  cores: number;
  loadAvg: [number, number, number] | number[];
}

export interface SystemMem {
  totalKb: number;
  usedKb: number;
  freeKb: number;
}

export interface System {
  hostname: string;
  os: string;
  kernel: string;
  uptimeSec: number;
  cpu: SystemCpu;
  mem: SystemMem;
  isProxmox: boolean;
  pveVersion?: string;
}

// WebSocket payload pushed on /ws/system
export interface SystemNetSample {
  iface: string;
  rxBps: number;
  txBps: number;
}

export interface SystemLiveSample {
  tsMs: number;
  cpuPct: number;
  mem: {
    usedKb: number;
    totalKb: number;
  };
  net: SystemNetSample[];
  load: number[];
}

// ---- Storage ----
export type DiskType = 'disk' | 'part' | 'raid' | 'lvm' | 'crypt';

export interface Disk {
  name: string;
  sizeBytes: number;
  model?: string;
  type: DiskType;
  fstype?: string;
  mountpoint?: string;
  children?: Disk[];
}

export interface RaidArray {
  device: string;
  level: string;
  state: string;
  sizeBytes: number;
  active: number;
  total: number;
  syncPct?: number;
}

export interface ZfsPool {
  pool: string;
  sizeBytes: number;
  allocBytes: number;
  freeBytes: number;
  health: string;
  capPct: number;
}

export interface Smart {
  device: string;
  healthy: boolean;
  temperatureC?: number;
  powerOnHours?: number;
  raw?: string;
}

export type ScrubFrequency = 'disabled' | 'weekly' | 'monthly';
export interface ScrubSchedule {
  frequency: ScrubFrequency;
  weekday: number; // 0=Sun..6=Sat (weekly)
  day: number;     // 1..28 (monthly)
  hour: number;
  minute: number;
}
export interface ScrubStatus {
  array: string;       // "md0"
  syncAction: string;  // idle | check | repair | resync | recover | reshape | frozen
  progressPct?: number;
  mismatchCnt: number;
  schedule: ScrubSchedule;
  lastRunMs?: number;
  nextRunMs?: number;
}

// ---- Shares ----
export interface SmbShare {
  name: string;
  path: string;
  comment?: string;
  readOnly: boolean;
  guestOk: boolean;
  validUsers: string[];
  /** false for hand-authored shares defined outside proxsyno (read-only in UI). */
  managed: boolean;
}

export interface NfsClient {
  host: string;
  options: string;
}

export interface NfsExport {
  path: string;
  clients: NfsClient[];
}

export interface SharesResponse {
  smb: SmbShare[];
  nfs: NfsExport[];
}

// Request payloads
export interface SmbShareInput {
  name: string;
  path: string;
  comment?: string;
  readOnly?: boolean;
  guestOk?: boolean;
  validUsers?: string[];
}

export interface NfsExportInput {
  path: string;
  clients: { host: string; options?: string }[];
}

// ---- Users / groups ----
export interface NasUser {
  name: string;
  uid: number;
  groups: string[];
  hasSamba: boolean;
  shell: string;
  home: string;
}

export interface Group {
  name: string;
  gid: number;
  members: string[];
}

export interface UserCreateInput {
  name: string;
  password: string;
  groups?: string[];
  sambaEnabled?: boolean;
}

export interface UserUpdateInput {
  password?: string;
  groups?: string[];
  sambaEnabled?: boolean;
}

// ---- Files ----
export type FileEntryType = 'file' | 'dir' | 'symlink';

export interface FileEntry {
  name: string;
  type: FileEntryType;
  sizeBytes: number;
  mtimeMs: number;
  mode: string;
}

export interface FileListResponse {
  path: string;
  entries: FileEntry[];
}

// ---- Virtualization (Proxmox) ----
export type GuestType = 'qemu' | 'lxc';
export type GuestStatus = 'running' | 'stopped' | 'paused' | 'unknown';
export type GuestAction = 'start' | 'stop' | 'shutdown' | 'reboot';

export interface Guest {
  vmid: number;
  type: GuestType;
  name: string;
  status: GuestStatus;
  node: string;
  cpu: number; // 0..1
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptimeSec: number;
  template: boolean;
}

export interface ProxmoxAvailable {
  isProxmox: boolean;
  node: string;
  pveVersion?: string;
}

export interface ProxmoxStorage {
  name: string;
  type: string;
  content: string[];
  availBytes: number;
  totalBytes: number;
}

export interface ProxmoxIso {
  volid: string;
  storage: string;
  sizeBytes: number;
}

export interface ProxmoxTemplate {
  volid: string;
  storage: string;
  name: string;
}

export interface ProxmoxBridge {
  name: string;
}

export interface ProxmoxOptions {
  node: string;
  nextId: number;
  storages: ProxmoxStorage[];
  isos: ProxmoxIso[];
  templates: ProxmoxTemplate[];
  bridges: ProxmoxBridge[];
  osTypes: string[];
}

export interface ScriptMeta {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  source: string; // "ct/<slug>.sh"
  url: string;
}

export interface VmCreateInput {
  name: string;
  cores: number;
  memoryMB: number;
  diskGB: number;
  storage: string;
  isoVolid?: string;
  bridge: string;
  ostype?: string;
}

export interface LxcCreateInput {
  hostname: string;
  templateVolid: string;
  cores: number;
  memoryMB: number;
  diskGB: number;
  storage: string;
  bridge: string;
  password: string;
  unprivileged?: boolean;
  startOnCreate?: boolean;
}

export interface GuestCreateResponse {
  vmid: number;
}

// ---- Guest detail (raw Proxmox proxy shapes) ----
// Proxmox returns dynamic objects; keep these loose. `config` is an open record
// with helper-friendly typed accessors at the call site.

// Identifies a guest for the detail view (subset of Guest).
export interface GuestRef {
  vmid: number;
  type: GuestType;
  node: string;
  name: string;
}

// A guest config (qemu/lxc) — dynamic key/value map from `.../config`.
export type PveConfig = Record<string, unknown>;

// `.../status/current`
export interface PveStatusCurrent {
  status?: string;
  uptime?: number;
  cpu?: number; // 0..1
  cpus?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  name?: string;
  ha?: unknown;
  [k: string]: unknown;
}

// `.../snapshot` list entries (plus the synthetic "current" node).
export interface PveSnapshot {
  name: string;
  description?: string;
  snaptime?: number;
  parent?: string;
  vmstate?: number;
  running?: number;
}

// `nodes/:node/tasks`
export interface PveTask {
  upid: string;
  type?: string;
  status?: string;
  starttime?: number;
  endtime?: number;
  user?: string;
  node?: string;
  id?: string;
  exitstatus?: string;
}

// `nodes/:node/storage`
export interface PveStorage {
  storage: string;
  type?: string;
  content?: string;
  active?: number;
  enabled?: number;
  avail?: number;
  total?: number;
  used?: number;
}

// `nodes/:node/storage/:storage/content`
export interface PveStorageContent {
  volid: string;
  content?: string;
  vmid?: number;
  size?: number;
  ctime?: number;
  format?: string;
  notes?: string;
}

// Console WebSocket wire protocol (JSON text frames)
export type ConsoleClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

export type ConsoleServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };

// ---- Error envelope ----
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
