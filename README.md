<div align="center">

# 🚀 Zangqing (藏青) - Next-Gen Smart SSH & Docker Manager
*A modern, AI-powered lightweight cross-platform SSH terminal built with Electron & React.*

[🇬🇧 English](#-english) | [🇨🇳 简体中文](#-简体中文) | [🇯🇵 日本語](#-日本語) | [🇰🇷 한국어](#-한국어)

![React](https://img.shields.io/badge/React-18.2.0-blue?style=for-the-badge&logo=react)
![Electron](https://img.shields.io/badge/Electron-29.1.0-47848F?style=for-the-badge&logo=electron)
![Vite](https://img.shields.io/badge/Vite-5.1.0-646CFF?style=for-the-badge&logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6?style=for-the-badge&logo=typescript)

</div>

---

## 🇬🇧 English

### 🌟 Introduction
**Zangqing (藏青)** is a next-generation, modern, and lightweight SSH client engineered for absolute efficiency. Beyond standard terminal emulation, it acts as your ultimate developer workbench by integrating AI-assisted debugging, a native Docker manager, hardware monitoring, and seamless SFTP file management into one beautiful, cross-platform desktop application.

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

## 🇨🇳 简体中文

### 🌟 简介
**藏青 (Zangqing)** 是一款致力于极致开发效率的次世代现代 SSH 客户端。它不仅仅是一个终端模拟器，更是一个全能的开发者工作台——将 AI 辅助调试、原生 Docker 管理、系统硬件监控以及流畅的 SFTP 文件管理完美融合在一个精美且轻量的跨平台桌面应用中。

### ✨ 核心亮点
*   🤖 **AI 助手与代码调试**: 内置 AI 聊天面板及 AI 命令自动生成与调试，极大提升排错和运维效率。
*   🐋 **可视化 Docker 管理**: 告别繁琐繁重的命令行，在 UI 中一键完成 Docker 容器的启动、停止、重启和日志监控。
*   💻 **强悍的智能终端**: 基于 Xterm.js 打造的全功能终端，支持 WebGL 硬件加速运算、多色彩及丰富的右键菜单体验。
*   📊 **实时面板与系统监控**: 具有极佳动效的仪表盘（基于 Recharts 构建），精准追踪远程服务器的 CPU、内存、磁盘及网络流量状态。
*   📁 **可视化文件及进程管家**: 内置 SFTP 文件浏览器、代码高亮直接编辑以及远程进程的图形化管理。
*   🎨 **全新现代化极简 UI**: 采用 Tailwind CSS 构建的支持自由拖拽调节的响应式布局，兼顾美感与极佳的交互体验。
*   🌐 **全平台支持**: Windows、macOS 与 Linux 皆可无缝运行。

### 📂 核心目录结构
```text
📦 sshtool
 ┣ 📂 electron           # Electron 主进程与底层系统调用
 ┃ ┣ 📂 ssh              # SSH 核心连接与终端底层逻辑
 ┃ ┣ 📜 main.ts          # 桌面端主入口
 ┃ ┣ 📜 preload.ts       # 主进程与渲染进程桥接层
 ┃ ┗ 📜 ipcHandlers.ts   # IPC 通信控制系统
 ┣ 📂 src                # React 渲染进程（UI呈现）
 ┃ ┣ 📂 components       # 核心业务组件（Docker应用管理、AI聊天面板等）
 ┃ ┣ 📂 hooks            # 自定义 React 扩展钩子
 ┃ ┣ 📂 pages            # 页面级视图定义
 ┃ ┣ 📂 services         # API 及前端服务逻辑
 ┃ ┣ 📂 shared           # 共享类型及通用接口
 ┃ ┣ 📂 store            # 基于 Zustand 构建的全局状态库
 ┃ ┗ 📜 App.tsx          # 界面根入口组件
 ┣ 📜 package.json       # 项目配置、依赖清单与运行脚本
 ┗ 📜 vite.config.ts     # Vite 编译与打包配置
```

### 🚀 快速启动
```bash
# 1. 克隆代码库
git clone https://github.com/yourusername/sshtool.git
cd sshtool

# 2. 安装所有项目依赖
npm install

# 3. 启动本地开发环境
npm run dev

# 4. 构建并打包生产版本
npm run dist
```

---

## 🇯🇵 日本語

### 🌟 はじめに
**Zangqing (藏青)** は、究極の開発効率を追求して設計された、次世代のモダンで軽量なSSHクライアントです。単なるターミナルエミュレーターの枠を超え、AI支援デバッグ、ネイティブのDocker管理機能、リアルタイムのリソースモニタリング、およびシームレスなSFTPファイル管理を、一つの美しいクロスプラットフォームなデスクトップアプリに統合しています。

### ✨ 主な機能
*   🤖 **AIアシスタント＆デバッグ機能**: AIチャットパネルとAIコマンド生成機能を内蔵しており、コードのデバッグやコマンド入力を強力にサポート。
*   🐋 **ネイティブDocker管理**: UI上から直接Dockerコンテナの起動、停止、再起動、監視がワンクリックで可能。
*   💻 **強力なターミナルエミュレーター**: WebGLレンダリングに対応した、カスタマイズ可能なフル機能のXterm.jsターミナル。
*   📊 **リアルタイム・システムモニタリング**: リモートサーバーのCPU、メモリ、ディスク、ネットワークのトラフィックを視覚的に表示（Recharts採用）。
*   📁 **ビジュアルファイル＆プロセス管理**: 内蔵SFTPブラウザ、インラインのファイルエディタ、および視覚的なプロセスリスト管理。
*   🎨 **モダンで洗練されたUI**: ドラッグ＆ドロップでサイズ変更可能なレスポンシブデザイン。Tailwind CSSを採用。
*   🌐 **クロスプラットフォーム対応**: Windows、macOS、Linuxでシームレスに動作。

### 📂 フォルダ構成
```text
📦 sshtool
 ┣ 📂 electron           # Electronメインプロセス
 ┃ ┣ 📂 ssh              # SSH通信およびターミナルのロジック
 ┃ ┣ � main.ts          # アプリケーションのエントリーポイント
 ┃ ┣ 📜 preload.ts       # IPC通信のブリッジ
 ┃ ┗ 📜 ipcHandlers.ts   # プロセス間通信（IPC）
 ┣ 📂 src                # Reactフロントエンド
 ┃ ┣ 📂 components       # UIコンポーネント（AIチャット、Docker管理など）
 ┃ ┣ 📂 store            # Zustandステート管理
 ┃ ┗ ...                 
 ┣ 📜 package.json       # パッケージとスクリプト
 ┗ 📜 vite.config.ts     # Viteビルド構成
```

### 🚀 利用方法
```bash
# 1. リポジトリのクローン
git clone https://github.com/yourusername/sshtool.git
cd sshtool

# 2. 依存関係のインストール
npm install

# 3. 開発サーバーの起動
npm run dev

# 4. プロダクション用ビルド
npm run dist
```

---

## 🇰🇷 한국어

### 🌟 소개
**Zangqing (藏青)** 은 궁극의 개발 효율성을 위해 설계된 차세대 모던 초경량 SSH 클라이언트입니다. 단순한 터미널 에뮬레이터를 넘어서, AI 보조 디버깅, 네이티브 Docker 관리, 실시간 하드웨어 모니터링, 그리고 매끄러운 SFTP 파일 관리를 하나로 통합한 아름다운 크로스 플랫폼 데스크탑 애플리케이션입니다.

### ✨ 주요 기능
*   🤖 **AI 어시스턴트 및 디버거**: 코드 디버깅과 터미널 명령어 작성을 돕는 내장 AI 채팅 패널 및 명령어 생성기.
*   🐋 **직관적인 Docker 관리**: 터미널 명령어 없이 UI에서 직접 Docker 컨테이너를 시작, 중지, 재시작하고 모니터링할 수 있습니다.
*   💻 **강력한 터미널 에뮬레이터**: WebGL 렌더링, 사용자 정의 색상, 크기 조절 등을 지원하는 모든 기능을 갖춘 Xterm.js 기반 터미널.
*   📊 **실시간 시스템 모니터링**: 대상 서버의 CPU, 메모리, 디스크 및 네트워크 트래픽을 한눈에 확인할 수 있는 시각적 대시보드(Recharts 기반).
*   📁 **시각적 파일 및 프로세스 관리자**: 내장 SFTP 파일 브라우저, 인라인 파일 편집기, 시스템 프로세스 목록 시각화.
*   🎨 **세련되고 모던한 UI**: Tailwind CSS를 사용해 생산성에 맞춰 설계된 드래그 앤 드롭 크기 조절 가능한 반응형 레이아웃.
*   🌐 **크로스 플랫폼**: Windows, macOS, Linux를 모두 완벽하게 지원합니다.

### 📂 디렉토리 구조
```text
📦 sshtool
 ┣ 📂 electron           # Electron 메인 프로세스
 ┃ ┣ 📂 ssh              # SSH 연결 및 터미널 로직
 ┃ ┣ 📜 main.ts          # 애플리케이션 시작점
 ┃ ┣ 📜 preload.ts       # IPC 통신 브릿지
 ┃ ┗ 📜 ipcHandlers.ts   # 프로세스 간 통신 (IPC)
 ┣ 📂 src                # React 프론트엔드
 ┃ ┣ 📂 components       # UI 컴포넌트(AI, Docker, 터미널 등)
 ┃ ┣ 📂 store            # Zustand 상태 관리
 ┃ ┗ ...
 ┣ 📜 package.json       # 프로젝트 의존성 및 스크립트
 ┗ 📜 vite.config.ts     # Vite 빌드 설정
```

### 🚀 시작하기
```bash
# 1. 레포지토리 클론
git clone https://github.com/yourusername/sshtool.git
cd sshtool

# 2. 의존성 패키지 설치
npm install

# 3. 개발 서버 실행
npm run dev

# 4. 프로덕션 빌드
npm run dist
```

---

<div align="center">
  <p>Built with ❤️ by passionate developers.</p>
  <p>License: MIT</p>
</div>
