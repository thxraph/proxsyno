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

// ---- Shares ----
export interface SmbShare {
  name: string;
  path: string;
  comment?: string;
  readOnly: boolean;
  guestOk: boolean;
  validUsers: string[];
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

// ---- Error envelope ----
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
