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
  // Jump host / bastion proxy
  jumpHost?: string;
  jumpPort?: number;
  jumpUsername?: string;
  jumpPassword?: string;
  jumpPrivateKeyPath?: string;
}

// Agent session persistence
export interface AgentSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCall?: {
    name: string;
    command: string;
    status: 'pending' | 'executed';
    stdout?: string;
    stderr?: string;
  };
}

export interface AgentSession {
  id: string;
  title: string;         // auto-generated from first user message
  profileId: string;     // SSHConnection.id — binds session to a server
  host: string;          // for display (doesn't change if server renamed)
  messages: AgentSessionMessage[];
  createdAt: number;
  updatedAt: number;
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
