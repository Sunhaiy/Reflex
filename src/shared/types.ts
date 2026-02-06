export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
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

export interface SSHTunnel {
  id: string;
  name?: string;
  type: 'L' | 'R';
  active: boolean;
  config: {
    srcAddr: string;
    srcPort: number;
    dstAddr: string;
    dstPort: number;
  };
}

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
    upSpeed: number; // bytes/sec
    downSpeed: number; // bytes/sec
    totalTx: number;
    totalRx: number;
  };
  disks: {
    filesystem: string;
    size: number;
    used: number;
    available: number;
    usePercent: number;
    mount: string;
  }[];
}
