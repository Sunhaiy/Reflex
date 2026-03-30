<div align="center">

# 藏青

**一个把 SSH 终端、AI 执行工作区、Docker 管理、SFTP 文件操作和服务器监控整合在一起的现代桌面客户端。**

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md)

![Electron](https://img.shields.io/badge/Electron-29-47848F?style=for-the-badge&logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=000)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=fff)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supported-111111?style=for-the-badge)

</div>

## 应用预览

![主工作区](./b0e89111-1d1b-4072-adea-1dd2ec06831e.png)

![Agent 自动部署工作区](./58beebfc-909a-4a29-adc6-6eb42f36bb50.png)

![Agent 对话与执行过程](./d2aca14d-b5f3-47c9-8428-fd41e3036f33.png)

## 项目简介

藏青是一个面向实际运维与开发流程设计的桌面 SSH 客户端。它把远程终端、文件传输、Docker 管理、系统监控和 AI 工作区放进同一个界面里，让我们在一个应用内完成连接、排查、部署和验证。

## 核心能力

- 基于 `ssh2` 与 `xterm.js` 的多会话远程终端
- 面向部署与诊断场景的 Agent 工作区
- 内置 SFTP 文件浏览器与文件编辑器
- Docker 容器管理面板
- 远程 CPU、内存、网络、磁盘监控
- 本地会话与聊天记录持久保存，可下次继续
- 基于 Electron Builder 的三端桌面打包

## 功能模块

### 终端与文件操作

- 交互式远程终端
- SFTP 文件树浏览
- 文件内容内联编辑
- 多标签会话与布局管理

### Agent 工作区

- 自然语言任务执行
- 面向部署的自动化工作流
- 上下文保留与对话续跑
- 左侧对话、右侧执行画布联动

### 服务器管理

- Docker 管理
- 进程列表
- 系统监控
- 连接配置与复用

## 快速开始

```bash
git clone https://github.com/Sunhaiy/sshtool.git
cd sshtool
npm install
npm run dev
```

## 构建打包

```bash
npm run build
npm run dist
```

按平台单独打包：

- `npm run dist:win`
- `npm run dist:mac`
- `npm run dist:linux`

## 目录结构

```text
sshtool
|- electron/            # Electron 主进程、IPC、SSH、部署引擎
|- src/                 # React 渲染进程源码
|  |- components/       # 终端、Agent、Docker、文件、监控等组件
|  |- pages/            # 设置页和连接管理页
|  |- services/         # 前端服务层
|  |- shared/           # 共享类型与语言资源
|  `- store/            # Zustand 状态管理
|- docs/                # 架构和设计文档
`- .github/workflows/   # 构建与发布流程
```

## 技术栈

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

## 许可证

详见 [LICENSE](./LICENSE)。
