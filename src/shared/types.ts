export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  jumpHost?: string;
  jumpPort?: number;
  jumpUsername?: string;
  jumpPassword?: string;
  jumpPrivateKeyPath?: string;
  tags?: string[];
  os?: string;
}

export interface ConnectionDraft {
  data: Partial<SSHConnection>;
  step: 1 | 2;
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
  tokenUsage: number;
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
  tokenUsage?: number;
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
