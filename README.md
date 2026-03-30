<div align="center">

# Zangqing

**A modern SSH workspace for terminal access, AI-assisted operations, Docker management, SFTP, and server monitoring.**

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md)

![Electron](https://img.shields.io/badge/Electron-29-47848F?style=for-the-badge&logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=000)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=fff)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supported-111111?style=for-the-badge)

</div>

## Preview

![Main workspace](./b0e89111-1d1b-4072-adea-1dd2ec06831e.png)

![Agent deployment workspace](./58beebfc-909a-4a29-adc6-6eb42f36bb50.png)

![Agent conversation and execution flow](./d2aca14d-b5f3-47c9-8428-fd41e3036f33.png)

## Overview

Zangqing is a desktop SSH client built around a practical operations workflow. It combines terminal access, file transfer, Docker controls, system monitoring, and an AI workspace in one interface so we can move from inspection to deployment without switching tools.

## Highlights

- Multi-session SSH terminal powered by `ssh2` and `xterm.js`
- Agent workspace for deployment, diagnostics, and command execution
- Built-in SFTP file browser and file editor
- Docker container management inside the app
- Remote CPU, memory, network, and storage monitoring
- Persistent local chat/session history for continuing work later
- Cross-platform desktop packaging with Electron Builder

## What The App Includes

### Terminal And File Operations

- Interactive remote terminal
- File tree browsing over SFTP
- Inline file editing
- Session tabs and layout management

### Agent Workspace

- Natural-language task execution
- Deployment-oriented workflows
- Context retention and resumable conversations
- Execution timeline with terminal output beside the chat

### Server Management

- Docker manager
- Process list
- System monitor
- Connection profiles and reusable settings

## Quick Start

```bash
git clone https://github.com/Sunhaiy/sshtool.git
cd sshtool
npm install
npm run dev
```

## Build

```bash
npm run build
npm run dist
```

Platform-specific packages:

- `npm run dist:win`
- `npm run dist:mac`
- `npm run dist:linux`

## Project Structure

```text
sshtool
|- electron/            # Electron main process, IPC, SSH, deploy engine
|- src/                 # React renderer source
|  |- components/       # Terminal, Agent, Docker, files, monitor UI
|  |- pages/            # Settings and connection management
|  |- services/         # Frontend service layer
|  |- shared/           # Shared types and locale resources
|  `- store/            # Zustand stores
|- docs/                # Architecture and design notes
`- .github/workflows/   # Build and release workflows
```

## Tech Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- xterm.js
- ssh2
- Monaco Editor
- Recharts

## License

See [LICENSE](./LICENSE).
