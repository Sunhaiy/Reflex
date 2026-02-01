# Technical Architecture Document - SSH Connection Tool

## 1. System Architecture

The application follows the standard Electron architecture with a Main Process and a Renderer Process, communicating via IPC (Inter-Process Communication).

### 1.1 Main Process (`src/main`)
- **Responsibility:**
  - App lifecycle management (Create/Close windows).
  - Native system interactions (File system access for keys/config).
  - **SSH Session Management:** The actual SSH connections will be handled here to avoid CORS/Browser restrictions and use native Node.js streams.
  - **IPC Handlers:** Listen for requests from Renderer (Connect, Disconnect, Execute Command, Get Stats, SFTP).

### 1.2 Renderer Process (`src/renderer`)
- **Responsibility:**
  - User Interface (React).
  - Terminal Rendering (xterm.js).
  - State Management (Zustand).
  - Charts/Visualization (Recharts or similar).
- **Communication:** Sends IPC messages to Main process for heavy lifting.

### 1.3 IPC Bridge (`src/main/preload.ts`)
- Exposes a secure API to the Renderer using `contextBridge`.
- Methods: `connectSSH`, `disconnectSSH`, `onTerminalData`, `sendTerminalData`, `getSystemStats`, `uploadFile`, `downloadFile`.

## 2. Technology Stack
- **Runtime:** Node.js (Main), Chromium (Renderer)
- **Language:** TypeScript
- **Build Tool:** Vite
- **UI Framework:** React
- **Styling:** Tailwind CSS + Shadcn UI
- **SSH Library:** `ssh2` (Industry standard for Node.js)
- **Terminal:** `xterm` (Frontend), `node-pty` (Not needed if using ssh2 streams directly, but useful for local shell. For SSH, we pipe ssh2 stream to xterm).
- **Storage:** `electron-store` for saving user preferences and connection details (encrypted passwords recommended, e.g., `keytar` or simple encryption if safe storage is complex for MVP).

## 3. Directory Structure
```
/
├── electron/
│   ├── main/
│   │   ├── index.ts        # Main process entry
│   │   ├── sshManager.ts   # SSH connection logic
│   │   └── ipcHandlers.ts  # IPC setup
│   └── preload/
│       └── index.ts        # Preload script
├── src/ (Renderer)
│   ├── components/         # Reusable UI components
│   ├── pages/              # Main views (ConnectionManager, TerminalView, SFTPView)
│   ├── services/           # Frontend API wrappers for IPC
│   ├── stores/             # Zustand stores
│   ├── styles/             # Global styles
│   ├── App.tsx
│   └── main.tsx
├── shared/                 # Shared types (Interfaces for Connection, Stats, etc.)
├── package.json
├── vite.config.ts
└── electron-builder.json5
```
*Note: We will adapt the requested structure `src/main`, `src/renderer` to match the standard Vite+Electron patterns or user request exactly.*

## 4. Data Flow
1. **Connect:** User enters details -> Renderer calls `ipc.connect` -> Main creates `ssh2.Client` -> Returns success/fail.
2. **Terminal:**
   - User types in xterm -> Renderer `ipc.sendData` -> Main writes to SSH stream.
   - SSH stream data -> Main `ipc.emit('data')` -> Renderer writes to xterm.
3. **Stats:**
   - Main sets up an interval (e.g., 2s) -> Executes `top` or `cat /proc/meminfo` on remote -> Parses result -> Emits `stats-update` to Renderer.
4. **SFTP:**
   - Uses `ssh2` SFTP subsystem.
   - Upload/Download streams piped to/from local filesystem.

## 5. Security
- **Credentials:** Passwords/Keys saved locally should be encrypted.
- **IPC:** Use `contextIsolation: true` and `sandbox: false` (needed for Node integration if required, but prefer preload).
