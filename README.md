<div align="center">
  <a href="https://github.com/Sunhaiy/Reflex">
    <img src="./logo.png" alt="Reflex" height="72" />
  </a>

  <h1>Reflex</h1>

  <b>A modern SSH operations workbench with an agent-native workflow.</b>

  <p>
    Multi-session terminal, SFTP, Docker, monitoring, deployment automation, and AI-assisted server work in one desktop app.
  </p>

  <p>
    <a href="./README.md">English</a>
    |
    <a href="./README.zh-CN.md">Chinese</a>
    |
    <a href="./README.ja.md">Japanese</a>
    |
    <a href="./README.ko.md">Korean</a>
  </p>

  <p>
    <a href="https://github.com/Sunhaiy/Reflex/actions/workflows/build-release.yml">
      <img alt="Build" src="https://github.com/Sunhaiy/Reflex/actions/workflows/build-release.yml/badge.svg" />
    </a>
    <a href="./LICENSE">
      <img alt="License" src="https://img.shields.io/badge/license-custom-111111?logo=opensourceinitiative" />
    </a>
    <img alt="Electron" src="https://img.shields.io/badge/Electron-29-47848F?logo=electron&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111111" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
    <img alt="Platforms" src="https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supported-0f766e" />
  </p>

  <p>
    <sub>
      Built for developers who want remote servers to feel local, observable, and repairable.
    </sub>
  </p>
</div>

---

<div align="center">
  <a href="https://github.com/Sunhaiy/Reflex">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./b0e89111-1d1b-4072-adea-1dd2ec06831e.png" />
      <source media="(prefers-color-scheme: light)" srcset="./1e403064-c046-4948-b229-202b99ed692a.png" />
      <img alt="Reflex main workspace" src="./b0e89111-1d1b-4072-adea-1dd2ec06831e.png" width="100%" />
    </picture>
  </a>
</div>

## Overview

**Reflex** is a cross-platform SSH desktop client designed around real server work: connecting, inspecting, editing, deploying, recovering, and continuing tasks without losing context.

It combines a polished terminal workspace with practical infrastructure tools and an Agent mode that can plan server-side tasks, run commands, inspect output, retry on transient failures, and keep the execution trail visible.

## Why Reflex

- **One workspace for remote work:** terminal, files, Docker, monitoring, and AI actions stay side by side.
- **Agent-native execution:** ask for an outcome, then watch the plan, commands, progress notes, and verification steps unfold.
- **Local-first configuration:** connection profiles, AI settings, themes, and session history are stored locally.
- **Resumable sessions:** agent conversations and task state can be restored after switching servers or reopening the app.
- **Desktop packaging:** builds for Windows, macOS, and Linux through Electron Builder and GitHub Actions.

## Features

### Terminal And SSH

- Multi-session SSH tabs with persistent terminal state
- Password and private-key authentication
- Reconnect-aware command execution
- Inline AI command generation and selected-output actions
- Themeable terminal rendering with multiple presets

### Agent Workspace

- Natural-language task execution for server operations
- Long-running task plan, progress, and retry state
- Visible execution cards for local commands, remote commands, uploads, file writes, and tool results
- Deployment-oriented workflows for local folders and GitHub projects
- Session history for continuing previous work

### Files And Deployment

- SFTP file browser and remote file editing
- Upload, download, rename, delete, and directory creation
- Project packaging for deployment flows
- Remote Nginx/static deployment support
- GitHub project source resolution and server-side preparation

### Server Management

- Real-time CPU, memory, disk, and network monitoring
- Process list and kill action
- Docker container, image, log, and cleanup controls
- Server profile search, copy, edit, delete, and quick connect

### Customization

- Light, dark, black, cyberpunk, and custom-accent themes
- Configurable UI and terminal fonts
- Multiple AI provider profiles
- Multiple models per provider endpoint
- Localized interface options

## Screenshots

### Agent Deployment Workspace

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./58beebfc-909a-4a29-adc6-6eb42f36bb50.png" />
    <source media="(prefers-color-scheme: light)" srcset="./1e44b065-2b41-4316-8d5f-157bf1323034.png" />
    <img alt="Reflex agent deployment workspace" src="./58beebfc-909a-4a29-adc6-6eb42f36bb50.png" width="100%" />
  </picture>
</p>

### Agent Conversation And Execution Flow

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./d2aca14d-b5f3-47c9-8428-fd41e3036f33.png" />
    <source media="(prefers-color-scheme: light)" srcset="./22174f5b-d599-4a23-a2ee-b738d1b821c7.png" />
    <img alt="Reflex agent conversation and execution flow" src="./d2aca14d-b5f3-47c9-8428-fd41e3036f33.png" width="100%" />
  </picture>
</p>

## Quick Start

```bash
git clone https://github.com/Sunhaiy/Reflex.git
cd Reflex
npm install
npm run dev
```

## Build

```bash
npm run build
npm run dist
```

Platform-specific packaging:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

## Project Structure

```text
reflex
|- electron/            # Electron main process, IPC, SSH, deploy engine, agent runtime
|- src/                 # React renderer source
|  |- components/       # Terminal, Agent, Docker, files, monitor UI
|  |- pages/            # Settings and connection management
|  |- services/         # Frontend AI and app services
|  |- shared/           # Shared types, themes, locales, prompts
|  `- store/            # Zustand stores
`- .github/workflows/   # Build and release automation
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

## Contributing

Contributions are welcome. Please read [CONTRIBUTING](./CONTRIBUTING.md) and [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md) before opening an issue or pull request.

## Security

If you find a security issue, please follow the process in [SECURITY](./SECURITY.md).

## License

See [LICENSE](./LICENSE).
