/// <reference types="vite/client" />
import type { FileEntry, SSHConnection, SystemStats } from './shared/types';

declare global {
  interface Window {
    electron: {
      getVersion: () => Promise<string>;
      openFileDialog: (opts?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
      connectSSH: (args: { connection: SSHConnection; sessionId: string; profileId?: string }) => Promise<{ success: boolean; error?: string }>;
      onTerminalData: (callback: (event: unknown, payload: { id: string; data: string }) => void) => () => void;
      writeTerminal: (id: string, data: string) => void;
      sshReconnect: (id: string) => Promise<{ success: boolean; error?: string }>;
      resizeTerminal: (id: string, cols: number, rows: number) => void;
      sftpList: (id: string, path: string) => Promise<FileEntry[]>;
      sftpUpload: (id: string, localPath: string, remotePath: string) => Promise<void>;
      sftpDownload: (id: string, remotePath: string, localPath: string) => Promise<void>;
      sftpDelete: (id: string, path: string) => Promise<void>;
      sftpMkdir: (id: string, path: string) => Promise<void>;
      sftpRename: (id: string, oldPath: string, newPath: string) => Promise<void>;
      sftpReadFile: (id: string, path: string) => Promise<string>;
      sftpWriteFile: (id: string, path: string, content: string) => Promise<void>;
      getPathForFile: (file: File) => string;
      getPwd: (id: string) => Promise<string>;
      openDialog: () => Promise<string | undefined>;
      saveDialog: (defaultName: string) => Promise<string | undefined>;
      startMonitoring: (id: string) => void;
      stopMonitoring: (id: string) => void;
      onStatsUpdate: (callback: (event: unknown, payload: { id: string; stats: SystemStats }) => void) => () => void;
      getProcesses: (id: string) => Promise<unknown[]>;
      killProcess: (id: string, pid: number) => Promise<void>;
      getDockerContainers: (id: string) => Promise<unknown[]>;
      dockerAction: (id: string, containerId: string, action: 'start' | 'stop' | 'restart') => Promise<void>;
      dockerLogs: (id: string, containerId: string, lines?: number) => Promise<string>;
      dockerImages: (id: string) => Promise<unknown[]>;
      dockerRemoveImage: (id: string, imageId: string) => Promise<void>;
      dockerPrune: (id: string, type: string) => Promise<unknown>;
      dockerDiskUsage: (id: string) => Promise<unknown>;
      onSSHStatus: (callback: (event: unknown, payload: { id: string; status: string }) => void) => () => void;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      storeGet: (key: string) => Promise<unknown>;
      storeSet: (key: string, value: unknown) => Promise<void>;
      storeDelete: (key: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export {};
