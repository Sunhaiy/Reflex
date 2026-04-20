<div align="center">
  <a href="https://github.com/Sunhaiy/Reflex">
    <img src="./logo.png" alt="Reflex" height="72" />
  </a>

  <h1>Reflex</h1>

  <b>一个采用 Agent 原生工作流的现代 SSH 运维工作台。</b>

  <p>
    多会话终端、SFTP、Docker、监控、部署自动化和 AI 辅助服务器操作，都在一个桌面应用里完成。
  </p>

  <p>
    <a href="./README.md">English</a>
    |
    <a href="./README.zh-CN.md">简体中文</a>
    |
    <a href="./README.ja.md">日本語</a>
    |
    <a href="./README.ko.md">한국어</a>
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
      为希望远程服务器感觉更本地、更可观察、更容易修复的开发者打造。
    </sub>
  </p>
</div>

---

<div align="center">
  <a href="https://github.com/Sunhaiy/Reflex">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./b0e89111-1d1b-4072-adea-1dd2ec06831e.png" />
      <source media="(prefers-color-scheme: light)" srcset="./1e403064-c046-4948-b229-202b99ed692a.png" />
      <img alt="Reflex 主工作区" src="./b0e89111-1d1b-4072-adea-1dd2ec06831e.png" width="100%" />
    </picture>
  </a>
</div>

## 概览

**Reflex** 是一个跨平台 SSH 桌面客户端，围绕真实的服务器工作流设计：连接、检查、编辑、部署、恢复，并且在切换任务或重新打开应用后继续保持上下文。

它把精致的终端工作区、实用的基础设施工具和 Agent 模式结合在一起。Agent 可以规划服务器任务、执行命令、观察输出、在临时失败后重试，并把执行过程清晰地展示出来。

## 为什么选择 Reflex

- **一个远程工作空间：** 终端、文件、Docker、监控和 AI 动作并排协作。
- **Agent 原生执行：** 直接描述目标，然后观察计划、命令、进度和验证步骤。
- **本地优先配置：** 连接配置、AI 设置、主题和会话历史都保存在本地。
- **可恢复会话：** 切换服务器或重启应用后，Agent 对话和任务状态可以继续恢复。
- **桌面端打包：** 通过 Electron Builder 和 GitHub Actions 构建 Windows、macOS 和 Linux 版本。

## 功能

### 终端与 SSH

- 多会话 SSH 标签页和持久化终端状态
- 支持密码和私钥认证
- 面向重连场景的命令执行
- 内联 AI 命令生成和选中文本操作
- 支持多种预设的可主题化终端渲染

### Agent 工作区

- 用自然语言执行服务器运维任务
- 长任务计划、进度、重试状态可视化
- 本地命令、远程命令、上传、写文件和工具结果都有执行卡片
- 面向本地文件夹和 GitHub 项目的部署工作流
- 会话历史支持继续之前的工作

### 文件与部署

- SFTP 文件浏览和远程文件编辑
- 上传、下载、重命名、删除和创建目录
- 面向部署流程的项目打包
- 支持远程 Nginx / 静态站点部署
- GitHub 项目源码解析和服务端准备

### 服务器管理

- 实时 CPU、内存、磁盘和网络监控
- 进程列表和结束进程操作
- Docker 容器、镜像、日志和清理控制
- 服务器配置搜索、复制、编辑、删除和快速连接

### 自定义

- 浅色、深色、纯黑、赛博朋克和自定义主题色
- 可配置 UI 字体和终端字体
- 支持多个 AI 服务商配置
- 支持同一服务商端点下的多个模型
- 本地化界面选项

## 截图

### Agent 部署工作区

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./58beebfc-909a-4a29-adc6-6eb42f36bb50.png" />
    <source media="(prefers-color-scheme: light)" srcset="./1e44b065-2b41-4316-8d5f-157bf1323034.png" />
    <img alt="Reflex Agent 部署工作区" src="./58beebfc-909a-4a29-adc6-6eb42f36bb50.png" width="100%" />
  </picture>
</p>

### Agent 对话与执行流

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./d2aca14d-b5f3-47c9-8428-fd41e3036f33.png" />
    <source media="(prefers-color-scheme: light)" srcset="./22174f5b-d599-4a23-a2ee-b738d1b821c7.png" />
    <img alt="Reflex Agent 对话与执行流" src="./d2aca14d-b5f3-47c9-8428-fd41e3036f33.png" width="100%" />
  </picture>
</p>

## 快速开始

```bash
git clone https://github.com/Sunhaiy/Reflex.git
cd Reflex
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run dist
```

按平台单独打包：

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

## 项目结构

```text
reflex
|- electron/            # Electron 主进程、IPC、SSH、部署引擎和 Agent 运行时
|- src/                 # React 渲染进程源码
|  |- components/       # 终端、Agent、Docker、文件、监控等 UI
|  |- pages/            # 设置和连接管理页面
|  |- services/         # 前端 AI 和应用服务
|  |- shared/           # 共享类型、主题、语言和提示词
|  `- store/            # Zustand 状态管理
`- .github/workflows/   # 构建和发布自动化
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

## 贡献

欢迎贡献代码。提交 issue 或 pull request 前，请阅读 [CONTRIBUTING](./CONTRIBUTING.md) 和 [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md)。

## 安全

如果发现安全问题，请按照 [SECURITY](./SECURITY.md) 中的流程处理。

## 许可

请查看 [LICENSE](./LICENSE)。
