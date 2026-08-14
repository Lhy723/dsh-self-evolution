<p align="center">
  <b>dsh-self-evolution</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22-339933.svg" alt="Node"></a>
  <a href="COMPATIBILITY.md"><img src="https://img.shields.io/badge/deepseek--harness-0.1.0--rc.6-8A2BE2.svg" alt="DeepSeek Harness"></a>
  <a href="BUILD_REPORT.md"><img src="https://img.shields.io/badge/tests-9%2F9-success.svg" alt="Tests"></a>
</p>

面向 **DeepSeek Harness / Cordis** 的基准驱动自我进化插件：让 Agent Profile（`AGENTS.md`、Skills、`runtime.json`、config）在冻结的 Benchmark 上自我迭代——每次改进必须**严格优于**当前版本才会被接受，否则从已验证的快照精确回滚。

```text
Agent Profile v1
  ↓ frozen Benchmark
Target Subagents × Case × Run
  ↓
Private Evaluator Subagents
  ↓ score + public feedback + DeepSeek Session IDs
Isolated Optimizer Subagent
  ↓ bounded file operations
AGENTS.md / Skills / runtime.json / config
  ↓ Agent Profile v2
re-evaluate
  ├─ score strictly better → snapshot + accept
  └─ otherwise             → verified rollback
```

## 特性亮点

- **原生集成**：直接调用 `ctx.subagents.start(...)` 与 `ctx.tools.register(defineTool(...))`，是真正的 Cordis Service（`ctx.evolution`），不是 shell 包装脚本。
- **确定性宿主策略**：评测决策不进 LLM——Benchmark 冻结哈希、Case × Run 矩阵、严格接受门槛（`>` 而非 `>=`，平分回滚）、单调版本号、快照验证全部由宿主代码执行。
- **三类隔离角色**：Target 继承 Profile 的 persona 与工具范围；Evaluator 只见私有 rubric + 原始输出；Optimizer 只见公开证据，并带 `{ allow: [] }` 全工具隔离，只能通过受限文件操作提候选。
- **隐私边界**：私有 rubric 不进 Target / Optimizer 上下文；公开与私有产物分目录落盘。
- **事务化变更**：候选文件白名单、路径穿越与符号链接防护、单 Profile 互斥锁、外部改动检测（漂移时拒绝覆盖回滚）。
- **全程可追踪**：每个子 Agent 都有独立 DeepSeek Session ID，Scoreboard 与运行事件日志可复盘每一轮的决策。
- **即插即用**：声明 `dsh.bundle` 的 profile bundle，`dsh plugin` 一条命令完成安装与组合。

## 快速开始

### 前置条件

- 一个已初始化的 DeepSeek Harness profile（`dsh` CLI 与 `pnpm` 在 PATH 上）；
- profile 自带 `tools` / `subagents` 注册表与官方 `spawn` provider（默认 `@deepseek-ai/dsh-base` 即满足）；
- 一个 Agent Profile 目录（含 `AGENTS.md` 与 `runtime.json`）；
- 一个冻结的 Benchmark 目录（**放在 Target workspace 之外**）。

### 安装

本包是 DeepSeek Harness **profile bundle**（`package.json` 的 `"dsh"` 段指向根目录 [`cordis.patch.yml`](cordis.patch.yml)），安装、激活一条命令完成：

```bash
# 方式一：npm registry（发布后最简形式）
dsh plugin --profile web add dsh-self-evolution

# 方式二：直接从 GitHub 仓库安装（无需发布，立即可用）
dsh plugin --profile web add github:Lhy723/dsh-self-evolution

# 方式三：本地 tarball
dsh plugin --profile web add ./dsh-self-evolution-0.1.0.tgz
```

`dsh plugin` 会把包安装进 profile 目录，并把包名追加进 `dsh.profile.bundles`；启动时 bundle 的 patch 应用在 `@deepseek-ai/dsh-base` 之后。无论用哪种 spec（registry 名 / git / tarball），reconcile 都会按真实包名 `dsh-self-evolution` 记录，后续 `dsh plugin ... update` 正常工作。

> GitHub 安装说明：pnpm 默认阻止 git 依赖的 build 脚本，而本仓库**直接提交了预构建的 `dist/`**，因此不需要 `prepare` 构建步骤，也不需要配置 `allowBuilds`。

### 验证安装

```bash
dsh --profile web --dump-config
```

输出里应出现由本 bundle 注入的行：

```yaml
# == dsh-self-evolution
- id: self-evolution
  name: dsh-self-evolution
  config:
    stateRoot: ~/.dsh/self-evolution
    subagentProvider: spawn
    ...
```

之后在会话里能看到四个 `evolution_*` 工具，即安装成功。

### 第一次运行

1. 把 [`examples/profile`](examples/profile) 复制到 Agent workspace；
2. 把 [`examples/benchmarks/demo`](examples/benchmarks/demo) 复制到 workspace 外部的私有目录；
3. 在会话中先做一次纯评测建立基线：

   ```json
   {
     "profile_dir": "./agent-profile",
     "benchmark_dir": "/private/benchmarks/demo",
     "runs_per_case": 1
   }
   ```

   （让 Agent 调用 `evolution_evaluate`，或直接用上面的参数。）

4. 确认 Scoreboard 出现 Baseline 后，再跑一轮进化：

   ```json
   {
     "profile_dir": "./agent-profile",
     "benchmark_dir": "/private/benchmarks/demo",
     "rounds": 1,
     "runs_per_case": 2
   }
   ```

   观察接受与拒绝两种路径后，再考虑无人值守的批量优化。

## 工作原理

插件不是在 shell 里套一层脚本，它直接使用 DeepSeek Harness 的原生能力：

- **Target** 是继承当前 Agent preset 的一等子 Agent；Profile 的 `AGENTS.md`、Skills、config 注入其 persona，`runtime.json.toolFilter` 成为其 scoped Tool Restriction；
- **Evaluator** 与 **Optimizer** 使用 `{ allow: [] }` 清空继承工具，只保留 harness 为结构化输出临时注册的子 Agent 自有工具；
- 每个 Target / Evaluator / Optimizer 都有独立、可追踪的 DeepSeek Session ID；
- 插件通过 `ctx.tools.register(defineTool(...))` 注册模型工具，并作为 Cordis Service 暴露为 `ctx.evolution`。

与「让模型自己改 Prompt」的本质区别：以下部分全部在确定性的宿主代码中执行——Benchmark 冻结与内容哈希、Case × Run 并发矩阵、候选文件白名单与路径防护、单 Profile 互斥锁与外部改动检测、单调版本号与快照验证、严格提升门槛（`candidate.score > reference.score + minImprovement`）、接受/拒绝/手工回滚、JSON Scoreboard 与公开/私有产物分离。

## 模型工具

默认前缀为 `evolution`，可通过 `toolPrefix` 配置修改。

| 工具 | 作用 |
| --- | --- |
| `evolution_run` | 完整闭环：基线 → 候选生成 → 评测 → 严格接受或回滚 |
| `evolution_evaluate` | 只评测不修改，追加一条 durable reference |
| `evolution_status` | 当前版本、实际哈希、漂移、下一版本、Benchmark 引用与快照 |
| `evolution_rollback` | 恢复到某个已验证的版本快照 |

### `evolution_run`

```json
{
  "profile_dir": "./agent-profile",
  "benchmark_dir": "/private/benchmarks/code-review",
  "rounds": 3,
  "runs_per_case": 2,
  "baseline_runs": 1,
  "target_score": 85
}
```

`target_score` 可选，达到即提前停止（0–100）。`adopt_external_changes: true` 可把人工改动的受管 Profile 采纳为新版本，而不是因 digest 漂移失败。

### `evolution_evaluate`

```json
{
  "profile_dir": "./agent-profile",
  "benchmark_dir": "/private/benchmarks/code-review",
  "runs_per_case": 3
}
```

### `evolution_status`

```json
{ "profile_dir": "./agent-profile" }
```

### `evolution_rollback`

```json
{ "profile_dir": "./agent-profile", "version": 2 }
```

回滚不会复用后续候选版本号：例如 v4 被拒绝或回滚后，下一个候选仍是 v5。

## Agent Profile

Profile 是一个普通目录：

```text
agent-profile/
├── AGENTS.md
├── runtime.json
├── skills/
│   └── verification/
│       └── SKILL.md
└── config/
    └── quality-policy.md
```

| 文件 | 角色 |
| --- | --- |
| `AGENTS.md` | 目标 Agent 的核心行为说明，进入 Target persona |
| `skills/*/SKILL.md` | 可复用能力，按名称排序后完整注入；Optimizer 可增删改 |
| `config/**/*.json\|md` | 稳定策略 / 格式契约 / 领域配置，同样进入 Target persona |
| `runtime.json` | 唯一被机器解释的 Profile 文件 |

`runtime.json`：

```json
{
  "schemaVersion": 1,
  "version": 1,
  "agentOptions": {
    "maxTokens": 8192
  },
  "toolFilter": {
    "deny": ["schedule_create", "cordis_define"]
  },
  "metadata": {
    "owner": "agent-platform"
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `version` | 当前 Profile 版本；候选版本由引擎分配，拒绝后不复用 |
| `agentOptions` | 子 Agent 的 `provider` / `model` / `maxTokens` 覆盖 |
| `toolFilter` | scoped Tool Restriction：`allow` / `deny` |
| `metadata` | 插件不解释的普通 JSON 元数据 |

默认禁止 Optimizer 修改 `provider` 与 `model`，避免换模型被误记为 Profile 改进；设置 `allowModelRouteMutation: true` 才开放。完整示例见 [`examples/profile`](examples/profile)。

## Benchmark

Benchmark 必须声明 `frozen: true`：

```text
benchmark/
├── benchmark.json
├── public/          # Target 可见
│   ├── concise-answer.md
│   └── verification.md
└── private/         # 仅 Evaluator 可见
    ├── concise-answer.md
    └── verification.md
```

`benchmark.json`：

```json
{
  "schemaVersion": 1,
  "id": "assistant-quality",
  "title": "Assistant quality",
  "frozen": true,
  "evaluatorInstructions": "Score observable behavior, not writing style alone.",
  "cases": [
    {
      "id": "concise-answer",
      "statementFile": "public/concise-answer.md",
      "rubricFile": "private/concise-answer.md",
      "weight": 1
    }
  ]
}
```

每个 Case：内联 `statement` 或 `statementFile` 二选一、`rubricFile` 必填、可选正数 `weight`、可选 `tags`。

manifest、公开 Statement 与私有 Rubric 全部纳入 Benchmark digest：评测前后 digest 不一致则整轮失败；已有 Scoreboard 也拒绝同 ID、不同 digest 的 Benchmark。**生产环境请把 Benchmark（尤其 private rubric）放在 Target workspace 之外**——默认 `allowBenchmarkInsideWorkspace: false` 会拒绝 workspace 内的 Benchmark。示例见 [`examples/benchmarks/demo`](examples/benchmarks/demo)。

## 接受规则

候选只有在以下条件全部满足时才接受：

1. Optimizer 产出有效、受限的文件操作；
2. Candidate 应用后 Profile digest 可重建；
3. 完整 Case × Run 矩阵均有有效评分；
4. Benchmark digest 未变化；
5. 评测期间 Profile 未被其他进程修改；
6. `candidate.score > reference.score + minImprovement`。

**不使用 `>=`，平分会回滚。** Baseline 在 Benchmark digest、Profile version、Profile digest 三者完全一致时可复用；Candidate 的 `runs_per_case` 可以高于先前 Baseline，Scoreboard 会分别记录各自的 Run 数。

## 状态与产物

默认状态根：

```text
~/.dsh/self-evolution/
└── profiles/<sha256(real-profile-path)[0:24]>/
    ├── state.json
    ├── profile.lock
    ├── snapshots/
    │   ├── v1/
    │   └── v2/...
    ├── scoreboards/<benchmark-id>.json
    └── runs/<run-id>/
        ├── run.json
        ├── events.jsonl
        ├── public/          # Target 输出、分数、公开反馈、Session ID
        └── private/         # rubric、Evaluator 私有理由
```

Optimizer Prompt 只由公开证据构建；私有产物绝不回灌模型上下文。

## 配置参考

| 配置 | 默认 | 说明 |
| --- | ---: | --- |
| `stateRoot` | `~/.dsh/self-evolution` | 快照、Scoreboard 与运行记录根目录 |
| `subagentProvider` | `spawn` | `ctx.subagents.start()` provider 名 |
| `maxParallelEvaluations` | `4` | 并发 Case×Run cell 数 |
| `minImprovement` | `0` | 候选必须严格超过 Reference 的额外分差 |
| `maxCandidateOperations` | `12` | 单候选最大文件操作数 |
| `maxCandidateBytes` | `262144` | 单候选写入总 UTF-8 字节数 |
| `evaluationRetries` | `1` | Target cell 失败后的额外尝试数 |
| `evaluatorRetries` | `2` | 同一 Target 输出的 Evaluator 额外尝试数 |
| `optimizerRetries` | `1` | 无效候选的额外 Optimizer 尝试数 |
| `lockStaleMs` | `1800000` | 过期 Profile lock 判定 |
| `allowBenchmarkInsideWorkspace` | `false` | 是否允许私有 Benchmark 位于 Target workspace |
| `allowModelRouteMutation` | `false` | 是否允许候选修改 provider/model |
| `managedFiles` | 见源码 | 可修改/快照的 glob |
| `excludedFiles` | 见源码 | Secret 与非状态文件排除 glob |
| `requiredFiles` | `AGENTS.md`, `runtime.json` | 不得删除的文件 |
| `toolPrefix` | `evolution` | 四个工具的名称前缀 |
| `maxDepth` | `4` | 子 Agent 委派深度上限 |
| `targetAgentOptions` | 未设置 | Target 的部署级 AgentOptions 覆盖 |
| `evaluatorAgentOptions` | 未设置 | Evaluator 的部署级 AgentOptions 覆盖 |
| `optimizerAgentOptions` | 未设置 | Optimizer 的部署级 AgentOptions 覆盖 |

## 安全边界

插件保证的是**上下文与文件事务边界**，不是新的 OS sandbox：

- Rubric 不会进入 Target 或 Optimizer Prompt；
- Evaluator / Optimizer 的继承工具被清空；
- Candidate 不能写绝对路径、`..`、符号链接路径、Secret glob 或非受管文件；
- Profile 漂移会阻止回滚覆盖外部修改。

但若 Target 子 Agent 继承了可越界工具（如 `danger-full-access` shell），它仍可能主动搜索 workspace 外的宿主文件。把 private rubric 作为强保密数据时，必须同时使用 harness 的 workspace sandbox / filesystem policy，或在 `runtime.json.toolFilter` 中移除可越界工具。详见 [`SECURITY.md`](SECURITY.md)。

## 模型与 Token 影响

- **工具面**：注册 4 个工具，每个 schema 约 1KB 量级描述，进入能看到该工具层的 Agent 的 prompt。
- **子 Agent 扇出**：一次 `evolution_run` 的模型调用量约为 `rounds × cases × (runs_per_case × (1 target + 1 evaluator) + 1 optimizer) + baseline`，请按此预算 token 与 KV-cache。
- **上下文注入**：Target persona 注入完整 Profile；Optimizer prompt 注入公开证据与完整受管 Profile；rubric 与私有评估笔记**不**进入模型上下文（有测试覆盖）。
- **确定性开销**：digest、快照均为本地哈希/文件操作，不产生模型调用；并发受 `maxParallelEvaluations` 限制。

## 已知限制与待办

- 带模型凭据的 live E2E 尚未执行：`runtime.json.toolFilter` 的实际生效依赖官方 `spawn` provider 的 Tool Restriction 语义，已按 rc.6 类型核对但未经 live 验证。
- 插件提供上下文与文件事务边界，而非 OS sandbox（见上）。
- `evolution_status` 与 `evolution_rollback` 需要调用 Agent（`exec.agent`）；无 Agent 上下文会报 `MISSING_AGENT`。
- 单 Profile 互斥靠 `profile.lock` + `lockStaleMs` 过期判定，跨主机并发不在其列（无分布式锁）。

## 开发与验证

```bash
npm run build                          # 真实 @deepseek-ai/*@rc.6 声明的严格构建
npm test                               # 9 个离线单测 suite（mock worker）
node scripts/smoke-register.mjs        # 真实 dsh-tools / dsh-invariants 注册冒烟
dsh --profile <name> --dump-config     # 真实 launcher 的 bundle 组合验证
npm pack                               # 产出发布 tarball
```

验证分三层：

1. **单元测试**：glob/path traversal、Profile digest、Candidate 事务、快照验证与精确恢复、Benchmark digest 与 workspace 暴露检查、private rubric 不进 Optimizer Prompt、完整 Mock Worker 接受/拒绝路径。
2. **真实类型构建**：以发布版 `@deepseek-ai/*@0.1.0-rc.6` 的声明做严格构建，覆盖 `defineTool`、`ctx.subagents.start` 完整请求面、`Session.header.cwd`、`ObjectJsonSchema` 子集。
3. **真实 runtime 冒烟**：用真实注册表挂载本插件，验证四个工具注册、`./invariant` 伴侣注册、fiber dispose 后零泄漏（HMR 安全），并由真实 launcher 组合 bundle patch。

尚未执行的只有带模型凭据的端到端运行；目标 profile 的验收步骤见 [`COMPATIBILITY.md`](COMPATIBILITY.md)，完整构建记录见 [`BUILD_REPORT.md`](BUILD_REPORT.md)。

## 贡献

Issues 与 PR 欢迎。改动源码后请跑完上方的三层验证再提交；`dist/` 与源码同 commit 提交（git 安装依赖预构建产物）。

## License

[MIT](LICENSE)
