/// <reference types="vite/client" />
import { SSHConnection, FileEntry, SystemStats } from './shared/types';
import { DeployDraft, DeployRun, ProjectSpec, ServerSpec } from './shared/deployTypes';

declare global {
  interface Window {
    electron: {
      getVersion: () => Promise<string>;
      openFileDialog: (opts?: { title?: string; filters?: any[] }) => Promise<string | null>;
      openDirectoryDialog: (opts?: { title?: string }) => Promise<string | null>;

      connectSSH: (args: { connection: SSHConnection; sessionId: string; profileId?: string }) => Promise<{ success: boolean; error?: string }>;
      onTerminalData: (callback: (event: any, payload: { id: string; data: string }) => void) => () => void;
      writeTerminal: (id: string, data: string) => void;
      terminalInject: (id: string, text: string) => void;
      sshExec: (id: string, command: string, timeoutMs?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
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
      getPwd: (id: string) => Promise<string>;

      openDialog: () => Promise<string | undefined>;
      openDirectory: () => Promise<string | undefined>;
      saveDialog: (defaultName: string) => Promise<string | undefined>;

      startMonitoring: (id: string) => void;
      stopMonitoring: (id: string) => void;
      onStatsUpdate: (callback: (event: any, payload: { id: string; stats: SystemStats }) => void) => () => void;

      getProcesses: (id: string) => Promise<any[]>;
      killProcess: (id: string, pid: number) => Promise<void>;

      getDockerContainers: (id: string) => Promise<any[]>;
      dockerAction: (id: string, containerId: string, action: 'start' | 'stop' | 'restart') => Promise<void>;
      dockerLogs: (id: string, containerId: string, lines?: number) => Promise<string>;
      dockerImages: (id: string) => Promise<any[]>;
      dockerRemoveImage: (id: string, imageId: string) => Promise<void>;
      dockerPrune: (id: string, type: string) => Promise<any>;
      dockerDiskUsage: (id: string) => Promise<any>;

      onSSHStatus: (callback: (event: any, payload: { id: string; status: string }) => void) => () => void;

      minimize: () => void;
      maximize: () => void;
      close: () => void;

      storeGet: (key: string) => Promise<any>;
      storeSet: (key: string, value: any) => Promise<void>;
      storeDelete: (key: string) => Promise<void>;

      agentSessionList: (profileId: string) => Promise<any[]>;
      agentSessionSave: (session: any) => Promise<void>;
      agentSessionLoad: (id: string) => Promise<any>;
      agentSessionDelete: (id: string) => Promise<void>;
      agentSessionSetTitle: (id: string, title: string) => Promise<void>;
      agentPlanStart: (payload: any) => Promise<void>;
      agentPlanStop: (payload: any) => void;
      agentPlanResume: (payload: any) => Promise<void>;
      agentSessionClose: (id: string) => void;
      onAgentPlanUpdate: (callback: (payload: any) => void) => () => void;
      onAgentPushMsg: (callback: (payload: any) => void) => () => void;
      onAgentUpdateMsg: (callback: (payload: any) => void) => () => void;

      deployAnalyzeProject: (projectRoot: string) => Promise<ProjectSpec>;
      deployProbeServer: (sessionId: string, host: string) => Promise<ServerSpec>;
      deployCreateDraft: (payload: any) => Promise<DeployDraft>;
      deployStart: (payload: any) => Promise<{ success: boolean }>;
      deployCancel: (sessionId: string) => void;
      deployListRuns: (serverProfileId?: string) => Promise<DeployRun[]>;
      deployGetRun: (runId: string) => Promise<DeployRun | null>;
      onDeployRunUpdate: (callback: (payload: { sessionId: string; run: DeployRun }) => void) => () => void;
      onDeployRunLog: (callback: (payload: { sessionId: string; runId: string; entry: any }) => void) => () => void;
      onDeployRunFinished: (callback: (payload: { sessionId: string; run: DeployRun }) => void) => () => void;
    };
  }
}

export {};
