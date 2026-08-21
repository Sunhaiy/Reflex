/// <reference types="vite/client" />
import type { StoreKey } from './shared/storeKeys';
import type {
  AgentConfig,
  AgentConfigView,
  AgentEvent,
  ApprovalAnswer,
} from './shared/agent';
import type {
  ActivityLine,
  ActivityScope,
  DockerAction,
  DockerContainer,
  DockerImage,
  DockerPruneType,
  FileEntry,
  RemoteFilePayload,
  RemoteProcess,
  SSHConnection,
  SystemStats,
  UsageDelta,
  UsageStats,
} from './shared/types';
import type { AppUpdateState } from './shared/update';

declare global {
  interface Window {
    electron: {
      getVersion: () => Promise<string>;
      updateGetState: () => Promise<AppUpdateState>;
      updateCheck: () => Promise<void>;
      updateApply: () => Promise<boolean>;
      onUpdateState: (callback: (state: AppUpdateState) => void) => () => void;
      probeHost: (target: { host: string; port?: number }) => Promise<{ ok: boolean; ms?: number }>;
      signalFirstFrame: () => void;
      openFileDialog: (opts?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
      connectSSH: (args: { connection: SSHConnection; sessionId: string }) => Promise<{ success: boolean; error?: string }>;
      onTerminalData: (callback: (event: unknown, payload: { id: string; data: string }) => void) => () => void;
      writeTerminal: (id: string, data: string) => void;
      sshReconnect: (id: string) => Promise<{ success: boolean; error?: string }>;
      disconnectSSH: (id: string) => Promise<void>;
      resizeTerminal: (id: string, cols: number, rows: number) => void;
      sftpList: (id: string, path: string) => Promise<FileEntry[]>;
      sftpUpload: (id: string, localPath: string, remotePath: string, transferId: string) => Promise<void>;
      sftpDownload: (id: string, remotePath: string, localPath: string, transferId: string) => Promise<void>;
      sftpResumeUpload: (id: string, localPath: string, remotePath: string, transferId: string) => Promise<void>;
      sftpResumeDownload: (id: string, remotePath: string, localPath: string, transferId: string) => Promise<void>;
      onSftpTransferProgress: (callback: (payload: { transferId: string; transferred: number; total: number; progress: number }) => void) => () => void;
      sftpDelete: (id: string, path: string) => Promise<void>;
      sftpMkdir: (id: string, path: string) => Promise<void>;
      sftpRename: (id: string, oldPath: string, newPath: string) => Promise<void>;
      sftpReadFile: (id: string, path: string) => Promise<RemoteFilePayload>;
      sftpWriteFile: (id: string, path: string, content: string, encoding?: string) => Promise<void>;
      getPathForFile: (file: File) => string;
      agentConfigGet: () => Promise<AgentConfigView>;
      agentConfigSet: (patch: Partial<AgentConfig> & { apiKey?: string }) => Promise<AgentConfigView>;
      agentProviderSelect: (providerId: string) => Promise<AgentConfigView>;
      agentTest: () => Promise<{ ok: true } | { ok: false; error: string }>;
      agentModels: () => Promise<{ ok: true; models: string[] } | { ok: false; error: string }>;
      onAgentConfigChanged: (callback: (config: AgentConfigView) => void) => () => void;
      agentSend: (payload: {
        sessionId: string;
        connectionId: string;
        conversationId: string;
        serverLabel: string;
        message: string;
        localRoot: string | null;
      }) => Promise<{ ok: true } | { ok: false; error: string }>;
      agentAnswer: (payload: {
        conversationId: string;
        callId: string;
        answer: ApprovalAnswer;
      }) => Promise<boolean>;
      agentCancel: (conversationId: string) => void;
      agentPickFolder: () => Promise<string | null>;
      agentConversationsGet: (connectionId: string) => Promise<unknown>;
      agentConversationsSet: (connectionId: string, value: unknown) => Promise<void>;
      agentConversationDelete: (
        connectionId: string,
        conversationId: string,
        value: unknown,
      ) => Promise<boolean>;
      onAgentEvent: (
        callback: (payload: { sessionId: string; conversationId: string; event: AgentEvent }) => void,
      ) => () => void;
      openDialog: () => Promise<string | undefined>;
      saveDialog: (defaultName: string) => Promise<string | undefined>;
      showItemInFolder: (filePath: string) => Promise<void>;
      startMonitoring: (id: string) => void;
      stopMonitoring: (id: string) => void;
      onStatsUpdate: (callback: (event: unknown, payload: { id: string; stats: SystemStats }) => void) => () => void;
      getProcesses: (id: string) => Promise<RemoteProcess[]>;
      killProcess: (id: string, pid: number) => Promise<void>;
      isDockerAvailable: (id: string) => Promise<boolean>;
      getDockerContainers: (id: string) => Promise<DockerContainer[]>;
      dockerAction: (id: string, containerId: string, action: DockerAction) => Promise<void>;
      dockerLogs: (id: string, containerId: string, lines?: number) => Promise<string>;
      dockerImages: (id: string) => Promise<DockerImage[]>;
      dockerRemoveImage: (id: string, imageId: string) => Promise<void>;
      dockerPrune: (id: string, type: DockerPruneType) => Promise<string>;
      dockerDiskUsage: (id: string) => Promise<string>;
      onSSHStatus: (callback: (event: unknown, payload: { id: string; status: string }) => void) => () => void;
      onSSHActivity: (callback: (payload: { id: string; scope: ActivityScope; line: ActivityLine }) => void) => () => void;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      storeGet: (key: StoreKey) => Promise<unknown>;
      storeSet: (key: StoreKey, value: unknown) => Promise<void>;
      storeDelete: (key: StoreKey) => Promise<void>;
      usageGet: () => Promise<UsageStats>;
      usageRecord: (delta: UsageDelta) => void;
      onUsageStats: (callback: (stats: UsageStats) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
      logWrite: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
      logReveal: () => Promise<string>;
      logPath: () => Promise<string>;
      logRead: (maxLines?: number) => Promise<string>;
    };
  }
}

export {};
