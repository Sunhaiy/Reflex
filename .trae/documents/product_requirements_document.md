# Product Requirements Document (PRD) - SSH Connection Tool

## 1. Project Overview
A cross-platform SSH connection tool built with Electron, Node.js, TypeScript, React, Shadcn UI, and Lucide Icons. The tool aims to provide a modern, user-friendly interface for managing SSH connections, monitoring server resources, and transferring files.

## 2. Core Features

### 2.1 SSH Connection Management
- **Connection Configuration:**
  - Hostname/IP Address
  - Port (Default: 22)
  - Username
  - Authentication Method: Password or SSH Key (Path to private key)
  - Label/Name for the connection
- **Connection List:**
  - View saved connections.
  - Edit or delete connections.
  - Connect/Disconnect actions.
- **Status Indication:**
  - Visual indicator for connection status (Connected/Disconnected/Connecting).
- **Terminal:**
  - Integrated xterm.js terminal for command execution.
  - Support for basic terminal features (resize, copy/paste).

### 2.2 System Resource Monitoring
- **Real-time Monitoring:**
  - CPU Usage (%)
  - Memory Usage (Used / Total / %)
- **Visualization:**
  - Charts/Graphs (e.g., Line chart for history, Gauge for current status) or Simple Text/Progress bars.
  - Update interval: Configurable or fixed (e.g., every 2 seconds).

### 2.3 File Transfer (SFTP)
- **File Explorer:**
  - Dual-pane view or separate modal? Requirement says "Upload" and "Download". A dual-pane (Local vs Remote) is standard for SFTP.
- **Actions:**
  - Upload file(s) from local to remote.
  - Download file(s) from remote to local.
- **Progress:**
  - Visual progress bar for transfers.

### 2.4 UI/UX
- **Theming:**
  - Light/Dark mode toggle.
  - Custom accent colors.
- **Localization:**
  - English (en)
  - Chinese (zh)
- **Layout:**
  - Sidebar navigation (Connections, Settings, etc.).
  - Tabbed interface for multiple active connections (optional but good practice) or Single active view.
  - Responsive design.

## 3. Technical Requirements
- **Framework:** Electron (Main + Renderer)
- **Frontend:** React + TypeScript + Vite
- **UI Library:** Shadcn UI + Tailwind CSS
- **Icons:** Lucide React
- **State Management:** Zustand (as per template recommendations)
- **SSH Client:** `ssh2` or `node-ssh` (Main process)
- **Terminal:** `xterm` + `xterm-addon-fit` (Renderer)
