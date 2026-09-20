# CoResearch Workspace 设计文档

> **⚠️ 大部分内容已被 SaaS 架构决策地图取代**（2026-09-19 起）。本文假设 CoResearch 是本地文件系统 workspace（`.pi/` 挂载能力、`research/` 目录即 source of truth）；CoResearch 现在是多租户 SaaS，能力（Agent 工具/技能）内置在代码里、不做运行时挂载发现（[ADR 0006](../adr/0006-agent-worker-pi-coding-agent-sdk.md)），研究状态落 Postgres（`research_entities`/`research_relations`，[CONTEXT.md](../../CONTEXT.md)）。**本文第 4 节的实体/关系建模思路（Problem/Idea/Paper/Claim + 关系分离、失败记忆不删除只改状态）原则上成立，是 `research_entities`/`research_relations` 表设计的概念来源**，只是物化方式从 markdown 文件变成数据库行。第 2/3/6/8 节描述的目录结构和文件物化方式已过期，标了 `> **Superseded**` 的地方请看最新决策。当前真值：仓库根目录 [CONTEXT.md](../../CONTEXT.md)、决策地图 [`.scratch/coresearch-saas-architecture/map.md`](../../.scratch/coresearch-saas-architecture/map.md)、[docs/adr/](../adr/)。本文其余部分保留作为设计历史记录，不删除。

- 状态：Draft v1
- 日期：2026-09-16
- 背景：参考 ARIS（Auto-Research-In-Sleep）的架构原则，对 CoResearch 的 Workspace 目录设计做收敛与重构
- 产品流程：[Research Flow](./research-flow.md)。本文管研究状态如何落盘，不定义用户从兴趣走到 Idea 的步骤。

---

## 1. 背景与动机

CoResearch 之前的 Workspace 设计（`research/{problem,idea,literature}`）本质上是"文档页面思维"：每类信息对应一个会被不断覆盖的文件。这带来几个问题：

- 无法表达 idea 的演化历史（v1 → 被拒绝 → v2 → reframe → v3）
- literature 相关信息（论文本身 / 论文与 idea 的关系 / 聚合视图）混在一起，难以长期维护
- 框架能力（skill 实现）与研究状态（研究进展数据）没有边界，容易互相污染
- 跨 skill 协作依赖"Agent 自己记得该做什么"，没有显式契约，行为容易漂移
- 运行时管理数据（trace、event、manifest）没有独立空间

参考 ARIS 后提炼出以下应当遵守的架构原则：

1. 能力源码只维护一份，项目只挂载能力（不复制实现）
2. 项目里保存的是研究状态，不是框架实现
3. Skill 之间通过明确的 Artifact Contract 协作，而非隐式约定
4. Research Wiki（研究状态）是跨 Session 的长期记忆，包括失败记录
5. trace / event / manifest 拥有独立的管理空间，不与业务数据混放
6. 入口文档（AGENTS.md）只是 routing index，具体行为由各 Skill 自己的 SKILL.md 定义
7. 跨模块集成要靠 predicate + artifact + verifier 显式表达，不能靠"Agent 自己记得"

本设计文档的目标：把这些原则落到 CoResearch 的目录结构、数据契约和分层模型上。

---

## 2. 最终目录结构（V1）

> **Superseded**：这是本地文件系统 workspace 的目录树，CoResearch SaaS 不用它——`.pi/` 挂载机制被 [ADR 0006](../adr/0006-agent-worker-pi-coding-agent-sdk.md) 的自定义 `ResourceLoader`（内置、不做运行时发现）取代，`research/` 换成 Postgres 的 `research_entities`/`research_relations`/`proposals`，`.coresearch/` 的 trace/event 换成 `agent_runs`/`agent_messages`（[ADR 0011](../adr/0011-agent-messages-store-pi-session-entries-directly.md)），`artifacts/`/`uploads/` 换成 Supabase Storage + `blobs` 元数据表。下面的树状结构保留作为"当初怎么想的"记录。

```text
workspace/
│
├── AGENTS.md                     # routing index，不含具体行为规范
│
├── .pi/                           # Agent 能力挂载点（由 `pi install` 管理，不手工维护）
│   ├── settings.json              # 已挂载 package 清单（source of truth）
│   └── npm/
│       └── node_modules/
│           └── <package>/         # 每个 extension/skill 包的实际代码（npm 管理）
│
├── .coresearch/                   # 系统运行管理数据，非业务研究状态
│   ├── manifest.json
│   ├── links.json                 # 本项目挂载了哪些 skill/extension/agent
│   ├── events.jsonl                # 长期事件流（idea.created / claim.challenged ...）
│   └── traces/
│       └── <run-id>/
│           ├── request.json
│           ├── events.jsonl
│           ├── tool-calls.jsonl
│           └── result.json
│
├── research/                      # 研究状态图（核心）
│   ├── index.md                   # 当前活跃 problem/idea/claim/paper 导航
│   ├── context.md                 # 给 Agent 的高层研究上下文
│   ├── timeline.md                # 研究方向演化的时间线记录
│   │
│   ├── problems/
│   │   └── <problem-id>/
│   │       ├── problem.md
│   │       ├── evidence.md
│   │       └── state.json
│   │
│   ├── ideas/
│   │   └── <idea-id>/
│   │       ├── idea.md
│   │       ├── state.json         # status / parent / confidence / createdFrom
│   │       └── history.md
│   │
│   ├── papers/
│   │   └── <paper-id>.md
│   │
│   ├── claims/
│   │   └── <claim-id>.md
│   │
│   ├── experiments/
│   │   └── <experiment-id>/
│   │
│   ├── relations/
│   │   └── edges.jsonl            # 实体间关系（supports / overlaps / motivates ...）
│   │
│   └── views/                     # 由实体+关系生成的聚合视图，不手工维护
│       ├── gap-map.md
│       └── query-pack.md          # 压缩后的研究上下文，供下游 skill 消费
│
├── artifacts/                     # 人类消费的生成产物（非 canonical）
│   ├── generated/
│   ├── exports/
│   └── previews/
│
├── uploads/                       # 外部输入
│
└── scratch/                       # 临时工作区
```

> V1 不再预先拆分 `artifacts/{reports,html,tables,figures}`，产物类型用 metadata（如 `{"type": "html", "source": "idea-003"}`）标注，量大后再按需分类，避免过早设计目录分类法。

---

## 3. 四层模型

> **Superseded**：四层的**概念**（能力/研究状态/产物/系统管理分离）成立，物化方式已变——"Research State 是唯一的 source of truth"这条原则现在由 Postgres 的 `research_entities` 承担（画布是它的投影，不是相反，见 [research-canvas.md](./canvas/research-canvas.md) 第 3 节），不是 `research/` 目录。

```text
┌───────────────────────────────┐
│       Agent Capability         │  .pi/ (skills, extensions)
└───────────────┬────────────────┘
                │ operates on
                ▼
┌───────────────────────────────┐
│       Research State           │  research/（problems/ideas/papers/
│                                 │  claims/experiments + relations）
└───────────────┬────────────────┘
                │ generates
                ▼
┌───────────────────────────────┐
│         Artifacts               │  artifacts/（HTML/report/figure）
└───────────────────────────────┘

System management（横向，不参与上面的数据流）
───────────────────────────────
.coresearch/ — manifest / links / events / trace
```

职责边界：

| 目录 | 角色 | 是否 canonical |
|---|---|---|
| `.pi/` | Agent 能力挂载 | 否（只读引用） |
| `.coresearch/` | 系统运行管理 | 否（运行时数据） |
| `research/` | 研究状态图 | 是（source of truth） |
| `artifacts/` | 生成视图 | 否（可随时重新生成） |
| `uploads/` | 外部输入 | 是（输入侧的 source） |
| `scratch/` | 临时工作 | 否 |

核心原则：**Research State 是唯一的 source of truth**，Artifacts 是从它派生的 view，可以随时重建、更换渲染方式（HTML/React/Graph/Dashboard）而不影响底层数据。

> 实现备注：`.pi/` 下的能力挂载完全由 `pi install` / `pi remove` / `pi list` 管理，不手工创建或编辑其中的文件。`pi install <source> -l` 会把包代码放进 `.pi/npm/node_modules/<package>`，并把挂载记录写入 `.pi/settings.json`；`pi list -a` 可查看当前项目实际挂载了哪些包及其落地路径。这是 pi CLI 自身的机制，本设计不重新定义它。

---

## 4. 研究状态：从"页面"到"实体图"

### 4.1 不再用页面覆盖，而是维护实体集合

`ideas/idea.md`（单文件覆盖）→ `ideas/<idea-id>/`（每个 idea 独立、可并存、可追溯 parent/history）。

`idea-003/state.json` 示例：

```json
{
  "id": "idea-003",
  "status": "active",
  "parent": "idea-002",
  "problemIds": ["problem-001"],
  "confidence": 0.62,
  "createdFrom": ["paper-021", "critique-018"]
}
```

失败的 idea/problem 不删除，只改 `status`（如 `rejected`），作为防止重复探索的记忆，这一点直接借鉴 ARIS Research Wiki 的做法。

### 4.2 实体与关系分离

```text
Problem ──motivates──▶ Idea
Idea ──based_on──▶ Paper
Idea ──proposes──▶ Claim
Claim ──supported_by──▶ Paper
Idea ──evaluated_by──▶ Experiment
```

关系统一存放于 `research/relations/edges.jsonl`：

```json
{"from": "paper-013", "to": "idea-003", "type": "overlaps"}
{"from": "paper-001", "to": "claim-004", "type": "supports"}
```

`research/views/*.md`（如 `gap-map.md`、`literature-map.md`）是从实体 + 关系生成的聚合视图，不手工维护，可随时重新生成。

### 4.3 导航与压缩上下文

- `research/index.md`：当前活跃 problem / idea / claim / paper 的导航入口
- `research/timeline.md`：研究方向演化记录（问题何时提出、论文何时挑战了某假设、idea 何时被废弃）
- `research/context.md`：面向 Agent 的高层研究上下文
- `research/views/query-pack.md`：压缩后的研究上下文（当前 problem/idea、关键 claim、已知 gap、被拒绝的 idea、核心论文、开放问题），供下游 skill（如 brainstorm/search）消费，避免每次都读整个 workspace

---

## 5. Artifact Contract：Skill 间协作的显式契约

> **Superseded 注**：下文"每个 skill 声明输入/输出实体契约"的思路成立，但"skill"现在特指 [ADR 0006](../adr/0006-agent-worker-pi-coding-agent-sdk.md) 里内置在代码仓库、通过自定义 `ResourceLoader` 加载的 Pi Skill，不是 `.pi install` 挂载的独立包；下面举例的文件路径（`research/problems/<id>/state.json` 等）同样已过期，参照 [CONTEXT.md](../../CONTEXT.md) 的 Research Entity 概念理解契约的精神。

不依赖"Agent 自己记得该做什么"，每个 skill 声明输入/输出的实体契约：

```text
research/problems/<id>/state.json  (ProblemState)
          ↓  problem-framing skill
research/ideas/<id>/state.json     (IdeaState[])
          ↓  literature-position skill
research/claims/<id>.md            (ClaimState)
```

示例 TypeScript 契约：

```ts
interface ProblemState {
  id: string
  statement: string
  observations: string[]
  tensions: string[]
  evidence: Ref[]
  openQuestions: string[]
}
```

每个 skill 明确声明：消费什么状态、产出什么状态，而不是自由写文件、由 coordinator 猜测结果在哪里。

### 5.1 集成契约：predicate + artifact + verifier

跨模块集成不能写成"Searcher 发现重要论文时，应该记得更新 literature"这种模糊描述，而要写成：

```text
Predicate:  paper.status == accepted
Action:     ingestPaper()
Artifact:   research/papers/<id>.md
Relation:   relations/edges.jsonl 中追加一条边
Verifier:   paper 文件存在 且 关系记录有效
```

每一次跨 skill 集成都应该能回答：触发条件是什么、产出的 artifact 路径是什么、如何验证集成确实发生了。

---

## 6. `.coresearch/`：系统运行管理，与研究状态解耦

> **Superseded**：这些运行时数据现在是 Postgres 表——`agent_runs`（[ticket 19](../../.scratch/coresearch-saas-architecture/issues/19-agent-worker-run-scheduling.md)）、`agent_messages`（[ADR 0011](../adr/0011-agent-messages-store-pi-session-entries-directly.md)）——不是 `.coresearch/` 目录下的 JSON/JSONL 文件。"系统管理数据与业务研究状态解耦"这条原则不变。

`.coresearch/` 只放运行时/系统管理数据，不放业务研究状态：

- `manifest.json`：workspace 元信息（schemaVersion、projectId、workspaceVersion）
- `links.json`：本项目挂载了哪些 skill/extension/agent（对应 `.pi/` 的引用清单）
- `events.jsonl`：长期事件流，例如：
  ```json
  {"type": "idea.created", "id": "idea-003"}
  {"type": "claim.challenged", "id": "claim-005"}
  {"type": "paper.added", "id": "paper-031"}
  ```
  这条事件流是前端 Idea Evolution Timeline 的数据来源。
- `traces/<run-id>/`：单次 Agent Run 的完整记录（request/events/tool-calls/result），用于调试和复现。

---

## 7. Skill 源码组织：SKILL.md 是行为规范本身

> **Superseded 注**：Huabu 实际的 skills 系统（`.agents/skills/` + `skills.route.ts`）核查后是内置 Agent 自己的 prompt 目录/斜杠命令，不是"第三方可挂载扩展"（[ticket 16](../../.scratch/coresearch-saas-architecture/issues/16-agent-extension-architecture.md) 的核查记录）。下文"SKILL.md 是行为规范本身、AGENTS.md 只做 routing"这条组织原则依然合理，但 `packages/skills/<name>/` 这种目录形态要不要照搬、要不要在阶段二单独定，还没有对应的 ticket——先留在这里当已知的开放问题。

`AGENTS.md` 只做 routing：告诉 Agent 现在在哪、有哪些资源、有哪些全局规则。具体某个能力"怎么做"由该 skill 自己的 `SKILL.md` 定义，不写进 AGENTS.md 或 coordinator 的巨大 system prompt。

```text
packages/skills/problem-framing/
├── SKILL.md          # 行为规范
├── schema.ts          # 输入/输出契约
├── scripts/
└── references/
```

好处：AGENTS.md 保持精简稳定；单个 skill 的行为变更不影响入口文档；能力可以独立版本化和复用。

---

## 8. Artifacts：research state 与展示产物彻底分离

> **Superseded**：`research/` 换成 Postgres，下面举的文件路径已过期，但"canonical source 和渲染产物分离"这条原则不变。

`research/ideas/idea-003/idea.md` 是 canonical source。`artifacts/generated/idea-003.html` 是从它渲染出的 view，不应手工编辑，也不是 source of truth。

```text
Research State → Renderer → Artifact
```

这使得前端展示形式（HTML / React / Graph / Timeline / Dashboard）可以自由更换，而不触碰底层研究状态。

> 当前选定的主展示形式是**研究画布**：React 19 + `@xyflow/react` 自建应用，共享命令引擎两端跑、服务端唯一权威。画布是 Commitment Space，只投影用户已保存或确认的研究对象；Conversation 才是 Exploration Space。流程见 [Research Flow](./research-flow.md)：Seed → Direction Exploration → Deep Dive → Research Question → Problem → Hypothesis → Approach → Method & Evaluation → Idea。研究内容字段由投影器写入（用户与 Agent 的普通编辑被服务端拒绝），用户写布局与批注，确认经画布详情面板与领域服务完成。架构参考 microsoft/Huabu（MIT）。见 [研究画布设计](./canvas/research-canvas.md)。

---

## 9. 与此前设计的差异（变更点）

| 此前 | 现在 | 原因 |
|---|---|---|
| `research/{problem,idea,literature}` 单文件覆盖 | `research/{problems,ideas,papers,claims,experiments}/<id>/` 实体集合 | 支持演化历史、并存版本、失败记忆 |
| `literature/` 混装一切 | `papers/` + `relations/edges.jsonl` + `views/` | 实体、关系、视图职责分离，长期可维护 |
| `.coresearch/` 概念缺失或与 research 混放 | `.coresearch/` 独立存放 manifest/links/events/trace | 系统管理数据与业务研究状态解耦 |
| Skill 协作靠隐式约定 | Artifact Contract + predicate/artifact/verifier | 避免 Agent 行为漂移，跨模块集成可验证 |
| AGENTS.md 承载具体行为规则 | AGENTS.md 仅 routing，行为规则下沉到各 SKILL.md | 入口文档保持稳定，行为变更局部化 |
| artifacts 目录提前按类型细分 | V1 只分 generated/exports/previews，类型走 metadata | 避免过早设计，量大后再细分 |

---

## 10. 核心结论

> **Superseded（结论本身依然成立，物化方式变了）**：CoResearch SaaS 化后，"目录结构只是这个图的一种物化表示"这句话里的物化表示从文件系统换成了 Postgres——原句改写：

> **A persistent research state graph materialized as Postgres tables (`research_entities`/`research_relations`), projected onto a Canvas that is never itself the source of truth.**

CoResearch Workspace 的定位应从"Agent 可以操作的一堆文件"升级为一个 `Problem ↔ Idea ↔ Paper ↔ Claim ↔ Experiment` 构成的实体关系图（历史原句："A persistent research state graph materialized as a Pi-compatible workspace"，`.pi/` 挂载这条已经不成立，保留原句供对照）；这个模型比"idea.md + literature/"更适合支撑后续的多人协作、Agent 协同、Canvas 渲染和 Idea Evolution 时间线等需求。

---

## 11. 后续开放问题（待讨论，非本文档结论）

- `research/views/*` 的生成时机：实时生成 vs. 定期批量生成
- `relations/edges.jsonl` 规模增长后是否需要索引/查询层（而非纯 append-only 文件）
- 多 Agent 并发写入 `research/` 时的锁 / 合并策略
- `.coresearch/events.jsonl` 与 `research/timeline.md` 的关系：前者是系统事件流，后者是否应该是前者的一个投影视图而非独立维护
