<div align="center">

# 🚀 Zangqing (藏青) - 次世代智能 SSH 与 Docker 管理器
*基于 Electron 和 React 构建的现代化、AI 驱动的轻量级跨平台 SSH 终端。*

[🇬🇧 English](./README.md) | [🇨🇳 简体中文](./README.zh-CN.md) | [🇯🇵 日本語](./README.ja.md) | [🇰🇷 한국어](./README.ko.md)

![React](https://img.shields.io/badge/React-18.2.0-blue?style=for-the-badge&logo=react)
![Electron](https://img.shields.io/badge/Electron-29.1.0-47848F?style=for-the-badge&logo=electron)
![Vite](https://img.shields.io/badge/Vite-5.1.0-646CFF?style=for-the-badge&logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6?style=for-the-badge&logo=typescript)

</div>

---

### 🌟 简介
**藏青 (Zangqing)** 是一款致力于极致开发效率的次世代现代 SSH 客户端。它不仅仅是一个终端模拟器，更是一个全能的开发者工作台——将 AI 辅助调试、原生 Docker 管理、系统硬件监控以及流畅的 SFTP 文件管理完美融合在一个精美且轻量的跨平台桌面应用中。

### 🛠️ 技术栈与依赖库
*   **核心框架**: React 18, Electron 29
*   **构建工具**: Vite 5
*   **开发语言**: TypeScript 5.3
*   **UI 与样式**: Tailwind CSS, `lucide-react` (图标库)
*   **终端引擎**: `xterm.js` (`@xterm/xterm` 以及 WebGL/Fit 渲染插件)
*   **SSH 核心通信**: `ssh2`
*   **状态管理**: `zustand`
*   **数据可视化**: `recharts` (用于系统监控仪表盘)
*   **代码编辑器**: `monaco-editor` (`@monaco-editor/react`)
*   **本地存储**: `electron-store`

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

<div align="center">
  <p>Built with ❤️ by passionate developers.</p>
  <p>License: MIT</p>
</div>
