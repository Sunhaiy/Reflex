export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKeyPath?: string;
}

export interface SystemStats {
  cpu: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
}

export interface FileEntry {
  name: string;
  type: 'd' | '-'; // directory or file
  size: number;
  date: string;
}
