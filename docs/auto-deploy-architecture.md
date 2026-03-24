# 自动部署架构设计

## 1. 目标

目标是让用户只需要提供：

- 本地项目路径
- 目标服务器
- 少量必要信息（如域名、环境变量、是否允许安装依赖）

系统就能自动完成：

1. 识别项目类型
2. 识别服务器能力
3. 选择部署策略
4. 打包/上传/发布
5. 配置运行环境与反向代理
6. 验证服务可访问
7. 输出最终访问链接

关键要求：

- 不是纯 prompt 驱动
- 本地项目与远端服务器都要纳入同一个工作流
- 过程可观察、可恢复、可回滚
- 后续容易新增框架支持

## 2. 当前代码现状

现有项目已经具备几块很好的基础能力：

- `electron/ssh/sshManager.ts`
  - SSH 长连接
  - `exec`
  - SFTP 上传/下载/读写文件
- `electron/agentManager.ts`
  - 主进程中的 Agent 状态机
  - 计划生成、执行、评估、重规划
- `electron/ipcHandlers.ts`
  - IPC 暴露基础能力
- `electron/preload.ts`
  - 前端调用桥接

但当前 Agent 模式本质上还是：

- 以远端 SSH 命令为中心
- 缺少本地项目扫描能力
- 缺少部署策略层
- 缺少发布、验证、回滚这些稳定的领域动作

所以“自动部署”不建议直接塞进现有 `AgentManager` 的 prompt 里继续放大，而是应该新增一个独立的部署域。

## 3. 总体架构

推荐拆成四层：

1. 输入层
   - 用户提供项目路径、服务器、域名、环境变量等
2. 事实采集层
   - 本地项目扫描
   - 远端服务器探测
3. 策略层
   - 基于事实选择部署策略
   - 生成类型化的部署计划
4. 执行层
   - 执行本地文件操作、上传、远端命令、验证、回滚

核心原则：

- LLM 只参与“理解”和“补全”
- 真正执行的步骤必须是代码定义的 typed steps
- 不让模型直接控制整个部署命令流

## 4. 推荐模块划分

建议新增：

```text
electron/
  deploy/
    deploymentManager.ts
    deployTypes.ts
    projectScanner.ts
    serverInspector.ts
    strategySelector.ts
    deployStore.ts
    verifier.ts
    rollback.ts
    packager/
      archivePackager.ts
      ignoreResolver.ts
    strategies/
      base.ts
      staticNginx.ts
      nodePm2.ts
      nodeSystemd.ts
      nextStandalone.ts
      dockerfile.ts
      dockerCompose.ts
      pythonSystemd.ts
    templates/
      nginx.ts
      systemd.ts
      env.ts
```

前端建议新增：

```text
src/
  components/
    deploy/
      DeployPanel.tsx
      DeployRunView.tsx
      ProjectPathInput.tsx
      DeployConfigForm.tsx
```

共享类型建议放在：

```text
src/shared/deployTypes.ts
```

## 5. 领域模型

### 5.1 ProjectSpec

表示本地项目事实，不带执行逻辑。

```ts
interface ProjectSpec {
  id: string;
  rootPath: string;
  name: string;
  fingerprints: string[];
  framework:
    | 'vite-static'
    | 'react-spa'
    | 'nextjs'
    | 'node-service'
    | 'dockerfile'
    | 'docker-compose'
    | 'python-fastapi'
    | 'python-flask'
    | 'unknown';
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry';
  buildCommand?: string;
  startCommand?: string;
  outputDir?: string;
  envFiles: string[];
  ports: number[];
  evidence: string[];
}
```

### 5.2 ServerSpec

表示远端服务器事实。

```ts
interface ServerSpec {
  host: string;
  os: string;
  arch: string;
  user: string;
  homeDir: string;
  hasDocker: boolean;
  hasDockerCompose: boolean;
  hasNginx: boolean;
  hasPm2: boolean;
  hasNode: boolean;
  hasPython: boolean;
  hasSystemd: boolean;
  openPorts: number[];
  publicIp?: string;
}
```

### 5.3 DeployProfile

表示某个“项目 + 服务器”的部署偏好与补充配置。

```ts
interface DeployProfile {
  id: string;
  projectId: string;
  serverProfileId: string;
  appName: string;
  remoteRoot: string;
  domain?: string;
  preferredStrategy?: string;
  runtimePort?: number;
  envVars: Record<string, string>;
  installMissingDependencies: boolean;
  enableHttps: boolean;
  healthCheckPath?: string;
}
```

### 5.4 DeployPlan

部署计划必须是类型化动作列表，而不是自由文本。

```ts
interface DeployPlan {
  id: string;
  strategyId: string;
  summary: string;
  releaseId: string;
  steps: DeployStep[];
  rollbackSteps: DeployStep[];
}
```

### 5.5 DeployStep

```ts
type DeployStep =
  | { kind: 'local_scan'; id: string; label: string }
  | { kind: 'local_pack'; id: string; label: string; sourceDir: string; outFile: string }
  | { kind: 'ssh_exec'; id: string; label: string; command: string; cwd?: string; sudo?: boolean }
  | { kind: 'sftp_upload'; id: string; label: string; localPath: string; remotePath: string }
  | { kind: 'remote_write_file'; id: string; label: string; path: string; content: string; mode?: string }
  | { kind: 'remote_extract'; id: string; label: string; archivePath: string; targetDir: string }
  | { kind: 'switch_release'; id: string; label: string; currentLink: string; targetDir: string }
  | { kind: 'http_verify'; id: string; label: string; url: string; expectedStatus?: number }
  | { kind: 'service_verify'; id: string; label: string; serviceName: string }
  | { kind: 'set_output'; id: string; label: string; url: string };
```

## 6. 为什么不要让 LLM 直接生成部署命令

如果继续沿用当前 `AgentManager` 的思路，让模型直接规划并执行部署命令，会有几个问题：

- 项目类型识别不稳定
- Windows 本地路径处理容易出错
- 上传大量文件时效率差
- 失败后的恢复不可控
- 回滚无法标准化
- 同一种项目每次都可能走出不同命令路径

更合理的方式是：

- 扫描结果由代码给出
- 策略选择优先规则引擎
- 命令模板由策略模块维护
- LLM 只在“模糊判断”和“失败诊断”时辅助

## 7. 部署流程建议

### Phase A: 输入与事实采集

1. 用户输入本地项目路径或通过目录选择器选择
2. `projectScanner` 扫描本地项目
3. `serverInspector` 通过 `SSHManager.exec` 探测服务器
4. 若缺少必要信息，形成结构化缺口列表

必要信息缺口示例：

- 域名未提供，但用户要求 HTTPS
- 项目需要环境变量但未配置
- 目标服务器缺少 Docker / Node / Nginx

### Phase B: 策略选择

优先用规则引擎选策略：

- 有 `docker-compose.yml` -> `dockerCompose`
- 有 `Dockerfile` -> `dockerfile`
- `package.json` 且是 Next.js -> `nextStandalone` 或 `nodeSystemd`
- `package.json` 且存在 `build` + `dist` -> `staticNginx`
- Python Web 项目 -> `pythonSystemd`

如果规则无法唯一判断，再调用 LLM：

- 输入 `ProjectSpec + ServerSpec + 支持的策略列表`
- 输出 `strategyId + reason + 缺失信息`

注意：

- LLM 输出不能直接是 Shell 命令
- 只能输出结构化选择结果

### Phase C: 计划编译

每种策略实现统一接口：

```ts
interface DeployStrategy {
  id: string;
  supports(project: ProjectSpec, server: ServerSpec): boolean;
  buildPlan(input: BuildPlanInput): Promise<DeployPlan>;
}
```

例如 `staticNginx` 策略编译出的步骤可能是：

1. 打包本地项目
2. 上传压缩包到远端临时目录
3. 解压到 release 目录
4. 远端执行 `npm install && npm run build`
5. 切换 `current` 软链
6. 生成 Nginx 配置
7. `nginx -t && systemctl reload nginx`
8. HTTP 验证
9. 产出 URL

### Phase D: 执行与验证

`deploymentManager` 逐步执行 typed step，并持续推送事件给前端：

- step_started
- step_log
- step_completed
- step_failed
- deploy_succeeded
- deploy_failed
- rollback_started
- rollback_completed

验证不能只有 exit code，要有真实可访问验证：

- systemd 服务状态
- 端口监听状态
- `curl http://127.0.0.1:port`
- `curl http(s)://domain-or-ip`

### Phase E: 回滚

推荐统一 release 目录结构：

```text
/opt/zq-apps/<app>/
  releases/
    20260324-220500/
    20260324-221120/
  shared/
    .env
  current -> releases/20260324-221120
```

回滚只做三件事：

1. 切回上一个 release
2. 重启服务
3. 再次验证

这样失败恢复才稳定。

## 8. 本地项目处理设计

这是你现在最需要补的一层。

### 8.1 不建议让模型直接读本地项目

更好的方式是代码做扫描，再把扫描结果给模型。

扫描内容建议包括：

- `package.json`
- `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json`
- `Dockerfile`
- `docker-compose.yml`
- `requirements.txt`
- `pyproject.toml`
- `.env.example`
- `README.md`
- `vite.config.*`
- `next.config.*`

### 8.2 上传方式建议

不要一开始就用 SFTP 逐文件上传整个项目。

更稳的做法：

1. 本地按忽略规则打成 `tar.gz`
2. 通过 SFTP 上传单个压缩包
3. 远端解压

原因：

- Windows 本地环境更容易兼容
- 速度更稳定
- 更容易做 release 管理
- 更适合后续做增量优化

### 8.3 忽略规则

建议支持：

- `.gitignore`
- `.deployignore`
- 内置默认忽略

默认忽略示例：

- `.git`
- `node_modules`
- `.next/cache`
- `dist`
- `build`
- `.turbo`
- `.idea`
- `.vscode`

但要注意：

- 对于“本地构建产物直接上传”的策略，`dist` 不能忽略
- 忽略规则必须由策略控制，而不是写死

## 9. 推荐的策略集合

第一阶段建议只支持这几种，足够覆盖大部分用户：

1. `staticNginx`
   - Vite / React / Vue 静态站点
2. `nodeSystemd`
   - 普通 Node 服务
3. `nextStandalone`
   - Next.js
4. `dockerfile`
   - 单容器项目
5. `dockerCompose`
   - 多容器项目
6. `pythonSystemd`
   - FastAPI / Flask

先不要做太泛的“万能策略”。

万能策略最后会退化成 prompt 写脚本，维护成本很高。

## 10. 与现有代码的衔接方式

### 10.1 不建议直接改造 `AgentManager` 为部署引擎

原因：

- `AgentManager` 面向通用问答式 Agent
- 部署需要本地文件、工件、发布目录、回滚、验证
- 职责不同，生命周期也不同

更合理的是：

- 保留 `AgentManager` 作为通用 Agent
- 新增 `DeploymentManager` 作为领域工作流引擎

### 10.2 可以抽出的公共能力

可以从当前 `AgentManager` 中抽出：

- 带终端注入的 SSH 执行方法
- 通用 session event push
- 长任务状态同步

建议抽成：

```text
electron/core/
  sessionEventBus.ts
  sshExecRunner.ts
```

让 `AgentManager` 和 `DeploymentManager` 共享。

### 10.3 IPC 建议

新增 IPC：

```ts
deploy-select-project-dir
deploy-analyze-project
deploy-probe-server
deploy-create-draft
deploy-start
deploy-cancel
deploy-resume
deploy-get-run
deploy-list-runs
```

前端订阅事件：

```ts
deploy-run-update
deploy-run-log
deploy-run-finished
```

## 11. UI 交互建议

不要只靠聊天框。

建议新增一个显式入口，例如：

- 工作区右侧新增 `Deploy` 面板
- 或在 Agent 模式下新增 `一键部署项目` 操作

UI 最好分两段：

### 11.1 Draft 配置

让用户确认：

- 本地项目路径
- 目标服务器
- 识别出的项目类型
- 部署策略
- 域名
- 环境变量
- 是否允许安装缺失依赖

### 11.2 Run 执行

展示：

- 当前阶段
- 每一步日志
- 失败原因
- 是否已回滚
- 最终访问链接

聊天框可以继续保留，但它应该只是：

- 触发部署
- 展示解释
- 在失败时给出诊断

而不是直接承载整个部署工作流。

## 12. 安全边界

这个功能如果做成“完全自动”，必须有边界。

建议：

- 本地文件访问只允许在用户明确选择的项目根目录内
- 远端危险操作要有风险标记
- 涉及安装系统包、覆盖 Nginx、修改 systemd、申请证书时，允许用户在设置里选择：
  - 自动执行
  - 首次确认
  - 每次确认

另外，环境变量与密钥不要拼进 chat message。

应该：

- 保存在 `DeployProfile`
- 执行时由模板注入 `.env`
- 日志中自动脱敏

## 13. 推荐的第一版落地顺序

### V1

先做最闭环的一条：

- 本地项目路径输入
- 本地扫描
- 服务器探测
- `staticNginx` + `nodeSystemd`
- release 目录
- 验证 URL

这就能覆盖很多 Vite/Node 项目。

### V2

- `dockerfile`
- `dockerCompose`
- `nextStandalone`
- 失败自动回滚
- DeployProfile 持久化

### V3

- LLM 辅助策略选择
- 失败诊断
- 增量上传
- 多环境部署

## 14. 最关键的架构结论

一句话总结：

**自动部署应该是“部署工作流引擎 + 策略插件 + typed step 执行器”，而不是“让通用 Agent 多执行几条 SSH 命令”。**

如果按这个方向做，后面你加：

- Docker
- Next.js
- Python
- 回滚
- 灰度发布

都会比较顺。
