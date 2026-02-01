import { create } from 'zustand';
import { SSHConnection } from '@shared/types';

interface ConnectionState {
  connections: SSHConnection[];
  activeSessionId: string | null;
  loadConnections: () => Promise<void>;
  addConnection: (connection: SSHConnection) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  setActiveSession: (id: string | null) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  activeSessionId: null,
  loadConnections: async () => {
    if (window.electron) {
      const connections = await window.electron.getConnections();
      set({ connections });
    }
  },
  addConnection: async (connection) => {
    if (window.electron) {
      const connections = await window.electron.saveConnection(connection);
      set({ connections });
    }
  },
  removeConnection: async (id) => {
    if (window.electron) {
      const connections = await window.electron.deleteConnection(id);
      set({ connections });
    }
  },
  setActiveSession: (id) => set({ activeSessionId: id }),
}));
