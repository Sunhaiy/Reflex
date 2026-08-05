export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  /** Inline private-key material pasted by the user instead of selected from a file. */
  privateKey?: string;
  passphrase?: string;
  /** Optional IDC/cloud provider console link, stored as typed (the scheme is optional). */
  providerUrl?: string;
  os?: string;
}

export type SessionStatus = 'connecting' | 'connected' | 'disconnected';

/** One open SSH session. A connection can legitimately be open more than once. */
export interface Session {
  /** Identifies the SSH channel, not the saved server. */
  uniqueId: string;
  connection: SSHConnection;
  status: SessionStatus;
  connectedAt?: number;
}

export type ActivityLevel = 'cmd' | 'info' | 'ok' | 'dim' | 'error';

/** Which loading surface a progress line belongs to. */
export type ActivityScope = 'session' | 'monitor';

/** One real progress line emitted while a long-running operation runs. */
export interface ActivityLine {
  id: number;
  text: string;
  level: ActivityLevel;
  at: number;
}

export type TextFileEncoding =
  | 'utf-8'
  | 'gb18030'
  | 'big5'
  | 'shift_jis'
  | 'windows-1252'
  | 'utf-16le'
  | 'utf-16be';

/**
 * A file read for preview. Raw bytes rather than base64: the payload crosses IPC by
 * structured clone, which carries a Uint8Array natively, so encoding it would inflate
 * every preview by a third for nothing.
 */
export interface RemoteFilePayload {
  /** Backed by a plain ArrayBuffer, so it can go straight into a Blob or a TextDecoder. */
  bytes: Uint8Array<ArrayBuffer>;
  size: number;
}

export interface ConnectionDraft {
  data: Partial<SSHConnection>;
  savedAt: number;
}

export interface UsageStats {
  version: 1;
  firstUsedAt: number;
  lastActiveAt: number;
  appOpens: number;
  successfulConnections: number;
  serverOperations: number;
  mouseClicks: number;
  keyboardPresses: number;
  terminalInputCharacters: number;
  totalConnectedMs: number;
  longestConnectionMs: number;
  activityByDay: Record<string, number>;
}

export interface UsageDelta {
  appOpens?: number;
  successfulConnections?: number;
  serverOperations?: number;
  mouseClicks?: number;
  keyboardPresses?: number;
  terminalInputCharacters?: number;
  totalConnectedMs?: number;
  longestConnectionMs?: number;
  activity?: number;
}

export interface FileEntry {
  name: string;
  type: 'd' | '-';
  size: number;
  date: string;
}

export interface CpuCore {
  id: number;
  usage: number;
}

export interface RemoteProcess {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
  args: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  composeProject: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export type DockerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove';
export type DockerPruneType = 'system' | 'images' | 'volumes' | 'containers';

export interface SystemStats {
  os: {
    distro: string;
    kernel: string;
    uptime: string;
    hostname: string;
    /** IANA zone read from the server, e.g. "Asia/Shanghai". Empty when unset there. */
    timezone: string;
  };
  cpu: {
    totalUsage: number;
    cores: CpuCore[];
    model: string;
    speed: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    cached: number;
    buffers: number;
  };
  network: {
    upSpeed: number;
    downSpeed: number;
    totalTx: number;
    totalRx: number;
  };
  disks: Array<{
    filesystem: string;
    size: number;
    used: number;
    available: number;
    usePercent: number;
    mount: string;
  }>;
}
