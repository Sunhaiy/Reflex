# Agent Redesign (Codex-Style)

## 1. Why the current Agent mode feels wrong

Based on the current implementation:

- `electron/agentManager.ts` is a planner/executor/assessor/replanner loop driven by prompt-generated JSON plans.
- `src/components/AIChatPanel.tsx` still carries too much orchestration logic and presentation responsibility.
- Tool execution is mostly "one generated shell command per step", which is fragile and hard to recover cleanly.
- Terminal output is treated as a major source of truth, while the actual task state is only partially modeled.
- Deployment, shell, file access, and approvals are wired in ad hoc ways instead of being first-class agent actions.

This creates the exact failure mode we keep seeing:

- the model spends too much effort planning instead of acting,
- the UI looks busy but state is brittle,
- recovery is weak,
- multi-step jobs feel like a scripted demo rather than a real agent runtime.

If we want something closer to Codex, we should stop centering the architecture on "chat + plan JSON", and move to "durable run + tool loop + event stream".

## 2. Design goal

The user experience should be:

- user gives a goal,
- agent inspects the environment,
- agent decides and executes tools iteratively,
- agent self-recovers when possible,
- user watches a clean timeline,
- final result is returned with minimal interruption.

The architecture goal should be:

- chat is only an input/output surface,
- agent runtime lives in the main process,
- tools are typed and observable,
- state is durable and replayable,
- large outputs become artifacts instead of prompt noise,
- domain workflows such as deployment are specialized tools, not improvised shell scripts.

## 3. What to keep vs what to replace

Keep:

- `electron/ssh/sshManager.ts`
- `electron/deploy/*`
- existing connection/session model
- existing terminal panel and file/docker/monitor panels as observability surfaces

Replace or heavily refactor:

- `electron/agentManager.ts`
- the current planner/executor/assessor/replanner prompt chain
- `AIChatPanel` as an orchestration owner
- ad hoc event shapes for agent progress

## 4. Proposed architecture

### 4.1 Main-process Agent Runtime

Create a new runtime layer:

- `electron/agent/runtime/runManager.ts`
- `electron/agent/runtime/orchestrator.ts`
- `electron/agent/runtime/contextBuilder.ts`
- `electron/agent/runtime/eventBus.ts`
- `electron/agent/runtime/artifactStore.ts`
- `electron/agent/runtime/policyEngine.ts`

Responsibilities:

- `RunManager`
  - owns durable run state
  - creates/stops/resumes/cancels runs
  - isolates run identity from chat identity and SSH connection identity
- `Orchestrator`
  - runs the think -> tool -> observe -> think loop
  - decides next action after each tool result
  - does not depend on a fixed JSON plan
- `ContextBuilder`
  - builds compact model context from chat, memory, server snapshot, repo state, recent tool outputs, and artifacts
- `ArtifactStore`
  - stores long command output, file snapshots, diffs, diagnostics, deploy reports
  - only summaries go back into the model prompt
- `PolicyEngine`
  - classifies tool calls into auto / approval / deny
  - centralizes safety rules

### 4.2 Typed Tool System

Create a tool registry:

- `electron/agent/tools/registry.ts`
- `electron/agent/tools/remoteShell.ts`
- `electron/agent/tools/remoteFile.ts`
- `electron/agent/tools/localShell.ts`
- `electron/agent/tools/deploy.ts`
- `electron/agent/tools/http.ts`
- `electron/agent/tools/system.ts`

Every tool should expose:

- tool id
- input schema
- execution function
- retry/cancel support
- structured result
- human-readable summary
- optional artifact attachments

Core tool set for V1:

- `remote.exec`
- `remote.read_file`
- `remote.write_file`
- `remote.list_dir`
- `remote.stat`
- `remote.tail_log`
- `remote.service_control`
- `remote.http_probe`
- `deploy.project`
- `system.snapshot`

Important rule:

- raw shell should remain available,
- but higher-value domain actions should become dedicated tools,
- deployment should be a deterministic workflow tool, not a free-form pile of SSH commands.

### 4.3 Durable Run Model

Define a run as:

- one user goal
- one connection target
- one evolving event stream
- many tool calls
- optional approvals
- optional artifacts

Suggested state model:

- `created`
- `preparing_context`
- `thinking`
- `tool_pending`
- `tool_running`
- `waiting_approval`
- `waiting_user_input`
- `summarizing`
- `completed`
- `failed`
- `cancelled`

Suggested event model:

- `run.created`
- `run.state_changed`
- `message.added`
- `tool.requested`
- `tool.started`
- `tool.stdout`
- `tool.stderr`
- `tool.finished`
- `artifact.created`
- `approval.requested`
- `approval.resolved`
- `summary.ready`

This should be append-only and replayable.

## 5. Codex-style interaction loop

The runtime loop should look like this:

1. Build current context.
2. Ask the model for the next action, not for a whole rigid plan.
3. The model returns either:
   - a tool call,
   - a short user question,
   - or a final answer.
4. Execute the tool.
5. Convert the tool result into:
   - short structured feedback for the model,
   - detailed artifact/logs for the UI.
6. Repeat until done.

This is the important shift:

- current mode is plan-centric,
- new mode should be action-centric.

The model can still sketch a plan, but that plan is advisory, not the execution backbone.

## 6. Memory and context strategy

Right now, too much output risks polluting prompts.

We should split context into layers:

- `conversation memory`
  - recent user/assistant messages
- `run memory`
  - current goal, assumptions, partial findings, unresolved blockers
- `environment memory`
  - server OS, user, cwd, installed runtimes, service manager, package manager
- `artifact references`
  - command outputs, file contents, deploy reports, diffs

Rules:

- never dump full terminal output into prompt by default
- summarize large outputs aggressively
- keep raw outputs as artifacts addressable by id
- keep server snapshot cached and refresh only when stale

## 7. UI redesign

The current layout is still "chat first, execution second".

A Codex-style layout should be "run first, chat as narrative".

Suggested panels:

- left: conversations / runs
- center: run timeline
- right: terminal / file preview / diff / artifact detail

The center timeline should show:

- current objective
- current status
- active tool
- completed tool steps
- approvals
- diagnostics
- final result

Chat should become thinner:

- user asks for a goal
- assistant posts concise progress notes
- detailed execution sits in the timeline, not inside giant message bubbles

## 8. Deployment should be a specialized agent workflow

Deployment is too important to leave to unconstrained shell generation.

The new agent should treat deployment as:

- a high-level tool call like `deploy.project`
- backed by the existing deterministic `electron/deploy/*` pipeline

The deploy tool should support:

- preflight analysis
- environment provisioning
- migration execution
- health verification
- auto-remediation
- rollback
- final URL/result summary

The agent's job is:

- decide when deployment is the right operation,
- provide the right project path / options,
- interpret failures,
- decide whether to retry, diagnose, or escalate.

The deploy engine's job is:

- execute deployment deterministically.

## 9. Safety and approvals

We should stop putting approval logic into prompt text alone.

Safety should be enforced by the runtime:

- command classification
- path protection
- destructive action detection
- privileged action policy
- network/file write boundaries where applicable

Approval policy modes:

- `full_auto`
- `safe_auto`
- `approval_for_destructive`
- `manual`

The model can propose a command, but the runtime decides whether it runs automatically.

## 10. Recommended implementation plan

### Phase 1: Runtime skeleton

- introduce `RunManager`
- introduce event bus and append-only run log
- move all agent execution out of `AIChatPanel`
- keep the existing UI, but feed it from run events

### Phase 2: Tool registry

- replace direct planner/executor shell generation with typed tool calls
- keep `remote.exec` as fallback tool
- wrap SSH/file/deploy capabilities as first-class tools

### Phase 3: Action-loop model

- remove planner/executor/assessor/replanner chain
- use a single action model prompt that returns one next action at a time
- optionally add a lightweight verifier pass only for risky operations

### Phase 4: Artifacts and context compression

- add artifact store
- stop pushing large outputs directly into message history
- add summaries and references

### Phase 5: UI redesign

- timeline-first run viewer
- chat becomes lightweight
- terminal becomes observational, not the canonical record

## 11. Concrete recommendation for this repo

If we are serious about "push it all down and rebuild", I would do this:

- freeze feature work on the current `agentManager.ts`
- keep Deploy / SSH / File / Docker modules usable as-is
- build a new parallel runtime under `electron/agent-v2/`
- create a new renderer container under `src/components/agent-v2/`
- put the new mode behind a feature flag
- migrate one use case first:
  - server inspection
  - shell diagnosis
  - deployment trigger

Do not try to "incrementally improve" the current planner loop into Codex.

That code path is useful as a prototype, but it is the wrong center of gravity for a durable agent product.

## 12. Bottom line

The redesign should not be:

- better prompts,
- more plan JSON,
- more retries around shell commands.

The redesign should be:

- durable runtime,
- typed tools,
- event stream,
- artifact-based context,
- action-by-action orchestration,
- specialized deterministic workflows for important domains.

That is the shortest path from the current demo-like Agent mode to something that actually feels like Codex.
