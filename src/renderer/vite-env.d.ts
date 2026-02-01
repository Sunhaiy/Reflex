/// <reference types="vite/client" />

import { SSHConnection, SystemStats, FileEntry } from '../shared/types';

declare global {
  interface Window {
    electron: {
      getConnections: () => Promise<SSHConnection[]>;
      saveConnection: (connection: SSHConnection) => Promise<SSHConnection[]>;
      deleteConnection: (id: string) => Promise<SSHConnection[]>;
      
      connectSSH: (connection: SSHConnection) => Promise<{ success: boolean; error?: string }>;
      disconnectSSH: (id: string) => Promise<void>;
      
      onTerminalData: (callback: (event: any, payload: { id: string; data: string }) => void) => () => void;
      onSSHStatus: (callback: (event: any, payload: { id: string; status: string }) => void) => () => void;
      writeTerminal: (id: string, data: string) => void;
      resizeTerminal: (id: string, cols: number, rows: number) => void;

      startMonitoring: (id: string) => void;
      stopMonitoring: (id: string) => void;
      onStatsUpdate: (callback: (event: any, payload: { id: string; stats: SystemStats }) => void) => () => void;

      sftpList: (id: string, path: string) => Promise<FileEntry[]>;
      sftpUpload: (id: string, localPath: string, remotePath: string) => Promise<void>;
      sftpDownload: (id: string, remotePath: string, localPath: string) => Promise<void>;
      
      openDialog: () => Promise<string | undefined>;
      saveDialog: (defaultName: string) => Promise<string | undefined>;
    };
  }
}
