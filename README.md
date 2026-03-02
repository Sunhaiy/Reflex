<div align="center">

# 🚀 Zangqing - Next-Gen Smart SSH & Docker Manager
*A modern, AI-powered lightweight cross-platform SSH terminal built with Electron & React.*

[🇬🇧 English](./README.md) | [🇨🇳 简体中文](./README.zh-CN.md) | [🇯🇵 日本語](./README.ja.md) | [🇰🇷 한국어](./README.ko.md)

![React](https://img.shields.io/badge/React-18.2.0-blue?style=for-the-badge&logo=react)
![Electron](https://img.shields.io/badge/Electron-29.1.0-47848F?style=for-the-badge&logo=electron)
![Vite](https://img.shields.io/badge/Vite-5.1.0-646CFF?style=for-the-badge&logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6?style=for-the-badge&logo=typescript)

</div>

---

### 🌟 Introduction
**Zangqing** is a next-generation, modern, and lightweight SSH client engineered for absolute efficiency. Beyond standard terminal emulation, it acts as your ultimate developer workbench by integrating AI-assisted debugging, a native Docker manager, hardware monitoring, and seamless SFTP file management into one beautiful, cross-platform desktop application.

### 🛠️ Tech Stack & Libraries
*   **Core Framework**: React 18, Electron 29
*   **Build Tool**: Vite 5
*   **Language**: TypeScript 5.3
*   **Styling & UI**: Tailwind CSS, `lucide-react` (icons)
*   **Terminal Engine**: `xterm.js` (`@xterm/xterm` + WebGL/Fit addons)
*   **SSH Protocol Core**: `ssh2`
*   **State Management**: `zustand`
*   **Data Visualization**: `recharts` (System monitoring dashobard)
*   **Code Editor**: `monaco-editor` (`@monaco-editor/react`)
*   **Local Storage**: `electron-store`

### ✨ Features
*   🤖 **AI Assistant & Debugger**: Built-in AI chat panel and AI command generation to assist with debugging code and writing terminal commands.
*   🐋 **Native Docker Management**: Start, stop, restart, and monitor your Docker containers directly within the UI without typing commands.
*   💻 **Powerful Terminal Emulator**: Fully-featured Xterm.js terminal with WebGL rendering, custom colors, sizing, and context menus.
*   📊 **Real-Time System Monitoring**: Visual dashboard tracking remote CPU use, memory allocation, disk space, and network throughput (powered by Recharts).
*   📁 **Visual File & Process Manager**: Built-in SFTP file browser, inline file editor, and visual process list management.
*   🎨 **Modern & Sleek UI**: Responsive, drag-and-drop resizable layouts tailored for productivity using Tailwind CSS.
*   🌐 **Cross-Platform**: Seamless experience across Windows, macOS, and Linux.

### 📂 Directory Structure
```text
📦 sshtool
 ┣ 📂 electron           # Electron main process & IPC handlers
 ┃ ┣ 📂 ssh              # SSH connection & terminal logic
 ┃ ┣ 📜 main.ts          # Application entry point
 ┃ ┣ 📜 preload.ts       # Context bridge
 ┃ ┗ 📜 ipcHandlers.ts   # Inter-process communication
 ┣ 📂 src                # React frontend source code
 ┃ ┣ 📂 components       # UI Components (DockerManager, AIChatPanel, Terminal, etc.)
 ┃ ┣ 📂 hooks            # Custom React hooks
 ┃ ┣ 📂 pages            # Application pages/views
 ┃ ┣ 📂 services         # Frontend services & API utilities
 ┃ ┣ 📂 shared           # Shared types and config
 ┃ ┣ 📂 store            # Zustand global state management
 ┃ ┗ 📜 App.tsx          # Root React component
 ┣ 📜 package.json       # Project dependencies & scripts
 ┗ 📜 vite.config.ts     # Vite bundler configuration
```

### 🚀 Getting Started
```bash
# 1. Clone the repository
git clone https://github.com/yourusername/sshtool.git
cd sshtool

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Build for production (Windows/Linux/Mac)
npm run dist
```

---

<div align="center">
  <p>Built with ❤️ by passionate developers.</p>
  <p>License: MIT</p>
</div>
