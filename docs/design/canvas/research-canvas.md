# CoResearch 研究画布：架构设计

> **⚠️ 部分内容已被 SaaS 架构决策地图取代**（2026-09-19 起）。本文写于"独立仓、本地文件系统落盘"的假设下；CoResearch 现在是多租户 SaaS，真值落在 Postgres（Supabase 托管），不是 `research/` 目录或 `space.json`。命令模型、托管字段所有权、投影用普通命令这几条核心思路**原样成立**，是这次改装直接沿用的部分；存储形状、Agent 工具名、数据流图这几处需要按下面标了 `> **Superseded**` 的地方读最新版本。完整、经核实的当前真值见仓库根目录 [CONTEXT.md](../../../CONTEXT.md)、决策地图 [`.scratch/coresearch-saas-architecture/map.md`](../../../.scratch/coresearch-saas-architecture/map.md) 和 [docs/adr/](../../adr/)。本文其余部分保留作为"当初为什么这么设计"的记录，不删除。

- 日期：2026-09-18
- 状态：设计提案；**替代此前的 tldraw 方案**（`tldraw-research-canvas.md` 已删除）。本次不安装依赖、不写代码。
- 参考实现：`/Users/zmj/Desktop/Huabu`（microsoft/Huabu，MIT）——下文引用的文件路径均相对该仓库。
- 实现级依据：[Huabu 画布实现逆向 + 原生重构](./huabu-reverse-engineering.md)（逐文件读源码的结果，含保留/砍掉/改动清单）。
- 决策：画布承担全流程总览；确认类操作通过画布详情面板与领域服务完成，完整证据仍可打开对应步骤视图审阅。
- 关联：[Research Flow](../research-flow.md)、[Idea Formation](../idea-formation/README.md)、[Workspace 设计](../workspace.md)。

## 1. 为什么换掉 tldraw

tldraw 方案解决的是"怎么画"，而 CoResearch 的难点从来不是画，是这四件事：

1. Agent 要能修改画布，并且每条修改的成败对它可见、可纠错。
2. 画布内容要能落到磁盘、能版本化、能撤销、能多端同步。
3. 有一部分节点字段**只能由后端业务逻辑写**，用户和 Agent 的普通编辑必须被拒绝。
4. 用户手工布局与系统生成内容必须能共存而不互相覆盖。

Huabu 这四件事都已经实现并写成了文档。第 3 条尤其关键——它恰好是 CoResearch"画布是投影、`research/` 是唯一真值"这条原则在工程上的落点，而 tldraw 只给了一个前端 store，这部分要从零设计。

## 2. 从 Huabu 借什么

### 2.1 三层命令模型

`docs/architecture/canvas-command-architecture.md` 的核心：

```text
Web 手势 → CanvasUiIntent（仅前端）→ resolver → CanvasExecution → executor
Agent 响应 → CanvasCommand[]        →           CanvasExecution → executor
executor → 校验、应用、trace、快照、后效
```

- **`CanvasUiIntent`**：只在 web 端存在，负责消化选区、剪贴板、拖拽会话、视口、矩形命中这些**易失的前端状态**，把模糊手势解析成显式操作数。它不能共享给 Agent。
- **`CanvasCommand`**：唯一被 executor 接受的类型，必须 JSON 可序列化、不依赖 UI 状态、操作数显式、无法应用时返回 `applied: false` 且无副作用。
- **`CanvasExecution`**：批次/事务边界——哪些命令一起校验执行、哪些折叠成一个撤销步、哪些属于同一条 action trace、提交后跑哪些后效。

这层划分对 CoResearch 直接可用：Step 3 的"点击路线卡"是 UiIntent，Step 4 的"投影器新增一个 Problem 节点"是 Command，"一次 Landscape 刷新导致的整批重绘"是一个 Execution。

### 2.2 同一引擎两端跑，服务端是唯一权威

引擎在 `packages/shared/src/canvas-engine/`，web 和 server 共用。UI 手势先在本地跑一遍拿到乐观反馈，然后 POST 到 `/api/canvas/:canvasId/execute`；Agent 的命令批次**直接在服务端执行**。服务端持久化后广播 delta，web 端用 `applyDeltas` 应用（版本门控，`localVersion >= toVersion` 跳过），不做本地重放。

这条对 CoResearch 意义很大：研究状态的写入必须经领域服务，而画布的乐观反馈又不能卡住。Huabu 的答案是"两端同引擎、一端有权威"，正好同时满足。

### 2.3 Agent 走同一命令 schema

> **Superseded**：Agent **不**暴露任何画布命令工具——两轨模型（Candidate/Proposal）定下来后，Agent 没有合法场景需要直接发画布命令，见 [ADR 0007](../../adr/0007-agent-tool-set-drops-canvas-commands.md)。下文"逐条结果可见""新建 id 回传"这两条性质原样保留，只是现在体现在 `propose_candidates`/`propose_revision`（[ADR 0004](../../adr/0004-candidate-vs-proposal-two-track-model.md)）和 accept 事务（[ADR 0005](../../adr/0005-candidate-acceptance-transaction-shape.md)）上，不是一个叫 `space_commands` 的工具。

Agent 只暴露一个 `space_commands` 工具，参数 schema 从共享 Zod 契约生成。两条性质让 Agent 循环自纠错：

- **逐条结果可见**：每条命令返回 `applied` 和失败时的类型化 `reason`（如 `CONNECT_NODES → invalid-target`）。整批被拒就是 no-op，版本不变。
- **新建的 id 会回传**：Agent **不允许自带 id**，服务端 `preAssignIds()` 分配，结果在 `results[].nodes` 回显，下一轮用真 id 连线，而不是自己编一个。

CoResearch 的 Agent 提案 Problem Candidate / Hypothesis 时完全适用这套：提案失败要有具体原因，不能静默丢弃。

### 2.4 托管节点所有权（CoResearch 的关键借鉴）

Huabu 有两处现成的"这个字段不归画布命令管"的机制：

**Agent Node 字段所有权**（`packages/shared/src/canvas-engine/agentNodeOwnership.ts`）：一个 Agent Node 的读模型不等于写 DTO。`bindingState`、`invocationToken`、`status`、`errorMessage`、`viewed`、`threadId` 属于服务端业务路径，共享的所有权投影会把这些字段从浏览器保存中剔除，**服务端校验会拒绝显式写入，包括标了 `originator.source: system` 的请求**。

**World preview 托管身份**（`apps/server/src/modules/canvas/world-preview-policy.ts`）：`spacePreview` 节点只能由系统协调创建；UI 和 Agent 批次不能重新指向、改类型，也不能删除一个目标仍存活的预览（包括通过删除祖先 Frame 绕过）。用户仍可移动、缩放、放进 Frame。

这两条合起来就是 CoResearch 要的东西：**研究内容字段由投影器写，布局字段由用户写，两者在同一个节点上共存且互不越界。**

### 2.5 投影用普通命令，不发明新命令

`world-previews.ts` 的做法值得照抄：系统协调只表达为普通的 `CREATE_NODES` / `CONNECT_NODES` / `DELETE_NODES` 批次，协调器自己负责选择扩展、生命周期、顺序和补偿。CoResearch 的投影器同样**不新增命令类型**，只用 `source: 'system'` 的普通批次——这样撤销、delta、同步、action log 全部自动复用。

### 2.6 存储与技术栈

> **Superseded**：下面这套文件存储形状是 Huabu 原版的，CoResearch 是 Postgres SaaS，不落文件系统。当前 schema 是 `canvases`/`canvas_nodes`/`canvas_layout`/`canvas_edges`/`canvas_projections`/`canvas_deltas`（[ADR 0008](../../adr/0008-canvas-canonical-storage-unified-nodes.md)/[0010](../../adr/0010-restore-structured-frame-layout.md)），字节走 Supabase Storage。CAS 版本/每 Canvas 一把写锁这两条原则保留，但锁是 Postgres 咨询锁不是进程内锁（[ADR 0002](../../adr/0002-canvas-concurrency-and-realtime-sync.md)）。

存储形状（`docs/architecture/canvas-storage.md`）：

```text
<space>/
  space.json          # canvasId, title, version, state:{nodes,edges}
  nodes/<label>.md    # frontmatter: id/type/label/src + markdown 正文
  .artifacts/         # 二进制
  .history/
    events.jsonl      # action log，每行 { ts, payload: RecentAction }
    delta-log.jsonl   # executor 的 delta 日志
```

结构记录与字节分两个 port（`StructuredStore` / `BlobStore`），Disk 与 SQLite 两种后端，字节永远是文件。版本用 CAS，每 Canvas 一把非重入写锁。

技术栈（`apps/web/package.json`）：

| 项 | Huabu | CoResearch |
|---|---|---|
| 画布 | `@xyflow/react` 12 | 同 |
| 框架 | React 19 + Vite 6 + TS | 同 |
| 状态 | zustand | 同 |
| 样式 | Tailwind 4 + 设计 token | 同 |
| 富文本 | Milkdown 7 | 同（Problem / Hypothesis 正文需要） |
| 路由 | react-router 7 | 同 |
| 包管理 | pnpm workspace | 同 |
| 桌面 | Electron | V1 不做 |
| 手绘 | perfect-freehand + simplify-js | V1 不做 |

边路由器依赖的是 `@xyflow/system` 而非 `@xyflow/react`，所以共享引擎可以在服务端跑——这个细节决定了"同一引擎两端跑"能否成立，照搬。

## 3. 关键差异：Huabu 的画布是真值，CoResearch 的画布是投影

这是唯一不能照抄的地方，且这条原则本身**没有变**——只是"CoResearch 的 source of truth"现在的准确说法是 Postgres 的 `research_entities`（project-scoped 的 Research Domain，见 [CONTEXT.md](../../../CONTEXT.md)），不是文件系统的 `research/` 目录。Huabu 里 `space.json` 就是 source of truth；CoResearch 的画布必须是 Research Domain 的投影，否则"确认绑定 contentHash""上游改了要标 stale"这些 Research Flow 的核心契约全部失效。

解决办法是把节点数据分成三类，各有各的写入者：

```ts
interface CrEntityNodeData {
  // ① managed —— 只有投影器能写，用户/Agent 的普通命令被服务端拒绝
  entityKind: 'seed' | 'direction' | 'phase' | 'focus' | 'problem'
    | 'claim' | 'hypothesis' | 'prediction' | 'work' | 'question' | 'probe'
    // Step 6
    | 'requirement' | 'approach' | 'operation' | 'component'
  refId: string
  refRevision: number
  refContentHash: string
  status: string          // 该实体自身的状态枚举，原样携带
  origin: string          // user / agent / literature / …
  confirmed: boolean
  stale: false | StalenessReason
  summary: string         // 投影时生成的摘要文本

  // ② layout —— 用户写，投影器不覆盖
  //    position / size / parentId / frameColumn 用 Huabu 既有字段

  // ③ annotation —— 用户写
  userNote?: string
  pinned?: boolean
}
```

投影器的协调规则（照 `reconcileWorldPreviews()` 的形状）：

- 缺失的实体 → 在确定性的空槽位创建节点
- 目标已删除的节点 → 移除
- 已存在的节点 → **保留节点身份与用户几何**，只更新 managed 字段
- `refContentHash` 与 `research/` 当前值不符 → 置 `stale`，不撤销任何确认

三条硬约束（与上一版一致，现在有了执行机制）：

1. **画布上的删除只影响视图**——但现在这不是靠约定，是靠托管身份策略：删除一个 `confirmed` 的研究节点会被服务端拒绝，就像 Huabu 拒绝删除目标存活的 spacePreview。
2. **用户画的箭头 ≠ 研究关系边**。研究边由投影器以 `source: 'system'` 创建并带 `basis`/`evidenceRefs`；用户自己连的边是普通 edge，样式区分，不进 `research/wiki/graph/`。
3. **确认动作不在画布上发生**。缩略节点不是用户确认时看过的完整内容，`contentHash` 绑定不了。画布只提供"打开这一步"的入口。

## 4. 节点类型：少而不是多

上一版列了 11 个自定义 shape。改为**一个 `crEntity` 节点类型 + `data.entityKind` 判别**，理由是所有研究实体共享同一套所有权策略、staleness 规则和视觉编码；11 个类型意味着 11 处要各自保证这些规则。

复用 Huabu 既有类型：

| 用途 | 节点类型 |
|---|---|
| 研究实体（15 种 kind） | `crEntity`（新增） |
| Step 泳道 | `frame`，`layout: 'column'` |
| 证据摘要 / 用户笔记 | `note` |
| 向 Agent 追问 | `question`（Huabu 的 Agent Node） |
| 论文原文 | `pdf` / `web` |

`question` 节点直接给了"在画布上和 Agent 对话"的能力，这正是 Step 2–5 里"追问这条路线""补充核查这个问题"需要的交互——不用自己造。

### 4.1 视觉编码

状态区分不得只靠颜色（`01-seed.md:112`）。每个节点固定带文字标签 + 边框样式：

```text
confirmed              实线   ✓ 已确认
draft / proposed       虚线   ○ 草稿
needs_verification     点线   ◐ 待核查
contested              双线   ⚠ 冲突
stale                  灰化   ↻ 上游已更新
```

**Step 4 与 Step 5 的状态语义方向相反**（`supported` 是好消息，`directly_studied` 是坏消息），所以 `entityKind: 'hypothesis'` 的"已被直接研究"必须显示为 `⊙ 已有工作覆盖`，不能借用 ✓。这是跨文档审查发现的冲突在视图层的强制隔离。

## 5. 仓库选择：Fork 还是独立仓

| 方案 | 代价 | 风险 |
|---|---|---|
| **A. Fork Huabu** | 几乎零画布工作量，直接得到桌面端、同步、Agent 节点、存储 | 要跟上游，且 CoResearch 的"画布是投影"与 Huabu"画布是真值"的模型差异要在 fork 里长期维护 |
| **B. 独立仓，照架构重写**（推荐） | 命令引擎 + 存储 + 同步要自己实现，约数周 | 可控；`research/` 天然是真值，不必和上游模型对抗 |
| C. 作为 Huabu 扩展 | 最轻 | Huabu 的扩展点（`.ext/` 命名空间、agent teams）不覆盖自定义节点类型，做不到 |

推荐 **B**，但**先把 Huabu 跑起来当活参考**：它的 `canvas-engine/` 有完整测试套件（`__tests__/` 下 10 个文件覆盖 delta、高度权威、树序不变量、自环等），照着实现能省掉大部分踩坑。C 方案经核查不成立——扩展命名空间只给存储隔离，不给节点类型注册。

## 6. 包结构

> **Superseded**：下面的 `apps/server` 是单体假设，现在拆成 CoResearch API + Agent Worker 两个进程（[ADR 0001](../../adr/0001-hybrid-backend-supabase-as-infra.md)/[0006](../../adr/0006-agent-worker-pi-coding-agent-sdk.md)），`write-coordinator` 也从进程内锁换成 Postgres 咨询锁（[ADR 0002](../../adr/0002-canvas-concurrency-and-realtime-sync.md)）。共享引擎（`canvas-engine/` 及其 8→9 条命令）这部分原样成立。

```text
packages/
├── shared/
│   ├── canvas-engine/        # 照 Huabu：executor / commands / delta / postEffects
│   ├── types/canvas/         # command.ts / node.ts / execution.ts / edge.ts
│   └── research/             # CoResearch 专属：实体类型、ownership 投影
apps/
├── web/                      # React 19 + Vite + xyflow + zustand
│   ├── handler/canvasCommand/  # uiIntent + resolvers（仅前端）
│   └── store/canvasStore.ts
└── server/
    ├── canvas/               # executor 入口、write-coordinator（每 Canvas 一把锁）
    └── research/projector/   # research/ → 系统命令批次
```

依赖方向照 Huabu 的规则：`pages → components/handler/hooks/store/api`，`utils` 不得向上引用。新命令加在共享引擎的 `commands/` 并注册到 `HANDLERS`/`COMMAND_META`，不加在 web 里。

## 7. 数据流

> **Superseded**：文件路径换成 Postgres 表，SSE 换成 Supabase Realtime（[ADR 0002](../../adr/0002-canvas-concurrency-and-realtime-sync.md)），投影/命令模型不变：

```text
research_entities / research_relations（Postgres，source of truth）
      ↓ projector 读取 + 与当前画布 diff
系统命令批次（CREATE_NODES / MERGE_NODE_DATA / CONNECT_NODES / DELETE_NODES，source: 'system'）
      ↓ 共享 executor（服务端权威）
canvas_nodes + canvas_layout + canvas_projections + canvas_deltas（Postgres）
      ↓ Supabase Realtime 快路径 + GET .../deltas?afterVersion=N 权威 catch-up
web applyDeltas（版本门控）
```

原文（历史记录，方法论不变，路径已过期）：

```text
research/（source of truth）
      ↓ projector 读取 + 与当前画布 diff
系统命令批次（CREATE_NODES / MERGE_NODE_DATA / CONNECT_NODES / DELETE_NODES，source: 'system'）
      ↓ 共享 executor（服务端权威）
space.json + nodes/*.md + delta-log.jsonl
      ↓ SSE 广播 delta
web applyDeltas（版本门控）
```

用户侧写入只有两类，都不经投影器：布局（position/size/parent）和批注（note 节点、userNote、自由边）。批注可以被"提升"为研究输入——画布提供"把这条批注作为追问发给这一步"，由步骤页接收为 `user_message` 再走原流程；批注本身永远不是研究状态。

### 7.1 Staleness 传播

这是跨文档审查中指出的、五份步骤文档都没定义的缺口，在这一层给出统一落点：

```ts
type StalenessReason =
  | 'upstream_revision_changed'
  | 'upstream_assessment_changed'
  | 'landscape_refreshed'
```

投影时逐节点比对 `refContentHash`，不一致则置 `stale` 并在跨泳道的派生边上显示 ↻。**`stale` 不撤销任何确认**——与 `04-problem-formation.md:409`"新文献不会自动撤销用户已确认的 Problem"、`03-direction-focus.md:337`"决定属于用户"一致。画布只负责让它可见。

## 8. 交互边界

| 动作 | 画布上 | 机制 |
|---|---|---|
| 浏览、缩放、搜索 | ✅ | |
| 展开节点看证据 | ✅ | 读投影内的引用 |
| 打开对应步骤页 | ✅ | 双击 |
| 写批注 / 移动 / 分组 | ✅ | 普通命令 |
| 向 Agent 追问 | ✅ | `question` 节点 |
| 发起 Probe | ✅ 入口 | 执行与预算归领域服务 |
| 确认 Seed / Focus / Problem / Hypothesis / Method / Research Design | ✅ | 画布详情面板 + 领域服务，绑定 contentHash |
| 编辑 statement / scope / claim | ❌ | managed 字段，服务端拒绝写入 |
| 删除已确认的研究节点 | ❌ | 托管身份策略拒绝 |
| 手工建立研究关系边 | ❌ | 只能由投影器创建 |

## 9. 实施顺序

1. **共享引擎最小集**：`CREATE_NODES` / `MERGE_NODE_DATA` / `SET_NODE_GEOMETRY` / `CONNECT_NODES` / `DELETE_NODES` + delta + 执行语义（逐条校验、一个撤销步、全拒即 no-op）。照 Huabu 的测试套件写测试。
2. **`crEntity` 节点 + ownership 投影**：managed 字段的服务端拒绝路径，这是整个设计成立的前提，必须先于 UI。
3. **投影器只读跑通**：Seed + 一条 Direction + Focus，三个节点一条派生边，从真实 `research/` 读。
4. staleness 检测与 ↻。
5. 补齐 Problem / Claim / Hypothesis / Prediction / Method 泳道。Step 6 的 `PredictionMethodCoverage` 是一条跨泳道边（Prediction → Operation）：哪条 prediction 由哪个操作检验，覆盖不全在画布上应当一眼可见，这是 Step 6 Coverage Gate 的视图对应物。
6. 右侧证据面板；布局与批注持久化。
7. `question` 节点接 Agent；双击进步骤页。

第 2 步是分水岭：先有所有权边界，再有 UI。反过来做的话，UI 会先把 managed 字段当普通字段编辑，之后很难收回。

## 10. 验收场景

| 场景 | 应满足的不变量 |
|---|---|
| 用户拖动研究节点 | 位置持久化，managed 字段不变 |
| 用户编辑 Problem 节点正文 | 服务端拒绝，返回类型化 reason |
| Agent 批次试图删除已确认节点 | 拒绝；整批若无其他变更则 no-op，版本不变 |
| Agent 新建节点后要连线 | 用 `results[].nodes` 回传的真 id，不能自带 id |
| 上游 Problem 出现新 revision | 下游 Hypothesis 置 stale，确认状态不变 |
| Landscape 刷新导致路线合并 | 保留节点身份与用户几何，只更新 managed 字段 |
| claim 状态为 no_direct_match_in_search | 显示 ◐ 与文字标签，不显示 ✓，不出现"gap" |
| hypothesis 被判定 directly_studied | 显示 ⊙，不复用 Step 4 的 ✓ |
| 投影器写入中途失败 | `research/` 完好，批次整体回滚，不留半个投影 |
| 用户画一条箭头连两个 Direction | 普通 edge，样式区分，不进 research/wiki/graph/ |
| 批注被提升为追问 | 进入对应步骤的 user_message，批注本身不改研究状态 |

## 11. 未决项

- 多人协作与实时同步：Huabu 有 SSE 广播 + 版本 CAS 的完整方案（`canvas-realtime-sync.md`），V1 单人可先不做，但存储版本号要从一开始就留。
- 桌面端（Electron）不在 V1。
- 步骤页尚未实现，画布的"双击进入"暂时指向占位。
- 大图性能与自动布局：~~Huabu 的结构化 Frame 求解器相当复杂，V1 用简单分层布局，不照抄~~——**已推翻**，见 [ADR 0010](../../adr/0010-restore-structured-frame-layout.md)：Step 泳道的删除空隙压缩/内容变长让位这两个真实场景靠简单分层布局处理不了，最终恢复了 `SET_FRAME_LAYOUT`（`gridLayout.ts` 完整保留，V1 产品策略只暴露 `free`/`column`）。

## 12. 参考与使用边界

本文的 Huabu 事实来自其仓库内文档与源码：`docs/architecture/canvas-command-architecture.md`、`canvas-storage.md`、`web-architecture.md`，以及 `packages/shared/src/types/canvas/node.ts`、`apps/web/package.json`。**未运行该应用，未验证其性能、同步或存储表现**；引用的是它的架构决策，不是对其实现质量的实证判断。

Huabu 为 MIT 许可（Microsoft Corporation）。若采用方案 B（独立仓），架构借鉴不产生许可义务；若直接复制其源码，需保留版权与许可声明。

领域流程与 Gate 以 [Research Flow](../research-flow.md) 为准；分步契约见 [Idea Formation](../idea-formation/README.md)。
