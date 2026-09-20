# CoResearch × Huabu：节点展示与关系连接设计

- 日期：2026-09-18
- 状态：设计提案；本次不实现 UI、共享命令或 Research Domain 服务。
- 参考实现：`/Users/zmj/Desktop/Huabu`，revision `057da9b1870fb42da91cecf9b83d9924b4ed6f89`。
- 上游：[研究画布架构](./research-canvas.md)、[领域对象映射](./huabu-domain-binding.md)。
- 适用范围：Step 1–8 的节点内容展示、缩放、展开、连接和关系审阅。

## 1. 设计目标

CoResearch 的画布需要同时满足三个阅读场景：

```text
远看：我想知道研究空间的结构和主线
近看：我想读懂某个 Problem、Paper、Hypothesis 或 Claim
审阅：我想知道这条关系是什么、依据是什么、是否已经确认
```

因此节点不能只有一种固定卡片，也不能把所有内容永久展开。节点需要有语义层级，关系需要有明确类型，用户在画布上的位置和连线动作需要与 Research Domain 的事实分开。

Huabu 的实现已经提供了可复用的交互基础：

- `PreviewCard` 将 cover、图标、标题和摘要组织成卡片。
- `NodePreviewContent` 将摘要 banner 和类型专属预览组合起来。
- `useNodeLOD` 让重型节点在屏幕宽度较小时切换到 minimal 表示。
- `NodeTakeoverLayer` 允许节点渐变成一个仍可交互的 mark。
- `NodeConnectAffordance` 提供四边连接端口、拖拽命中区和新节点创建。
- `CONNECT_NODES`、`DISCONNECT_EDGES`、`SET_EDGE_STYLE` 提供共享、可序列化的连接命令。

CoResearch 在这些机制上增加研究语义和版本约束。

## 2. 节点的三层内容模型

每个研究节点使用三层内容：

```text
Layer 0 · Identity
标题、类型、状态、颜色、版本标识

Layer 1 · Preview
一句摘要、关键标签、证据状态、上游/下游数量

Layer 2 · Detail
完整正文、来源、关系、审阅记录、可执行动作
```

三层的显示规则：

| 层级 | 显示位置 | 适合回答的问题 | 是否写入领域对象 |
|---|---|---|---|
| Identity | 卡片头部或 minimal mark | 这是什么？ | 只读投影 |
| Preview | 卡片主体 | 它大概说了什么？目前什么状态？ | 只读投影 |
| Detail | takeover、侧栏或详情面板 | 依据是什么？我能否编辑、确认或连接？ | 通过领域动作写入 |

节点本体只显示可快速扫描的内容。完整内容进入 Detail surface，避免在研究地图中把每篇论文和每个假设都渲染成无法阅读的大卡片。

## 3. Node Presentation Contract

```ts
type ResearchNodeDisplayState =
  | 'compact'
  | 'preview'
  | 'detail'
  | 'editing'
  | 'stale'
  | 'blocked'

interface ResearchNodePresentation {
  nodeId: string
  entityRef: VersionedRef
  entityKind: ResearchEntityKind
  displayState: ResearchNodeDisplayState
  title: string
  typeLabel: string
  accent: AccentToken
  summary: string | null
  keywords: string[]
  status: ResearchStatus
  evidenceState: EvidenceState | null
  relationCounts: {
    incoming: number
    outgoing: number
    unresolved: number
  }
  sourceCount: number
  contentAvailability: 'preview_only' | 'hydrated' | 'loading' | 'error'
  canEditDraft: boolean
  canConfirm: boolean
  canConnect: boolean
}
```

`ResearchNodePresentation` 是投影 DTO，不是 Research Domain 的第二份事实。`summary`、`keywords`、`relationCounts` 可重新计算；`entityRef`、revision、contentHash、status 和 evidenceState 必须来自领域对象。

## 4. 不同节点怎样展示

### 4.1 Seed / Focus / Problem

这类节点代表用户研究决定，优先展示：

```text
标题
一句 statement
confirmed / draft / stale
scope 标签
关键来源数量
```

卡片结构：

```text
┌─────────────────────────────┐
│ PROBLEM · confirmed         │
│ History-dependent           │
│ interaction attribution     │
│                             │
│ 效应是否依赖此前的 Edit？    │
│ scope: skill · tool · memory│
│ sources 4 · risks 2         │
└─────────────────────────────┘
```

Problem 与 Focus 的正文可编辑，但 confirmed 节点进入 Detail 后只能编辑 draft。节点上的确认标记是只读状态；用户通过详情面板提交 `ConfirmResearchRevision`。

### 4.2 Work / Version / Fragment

论文节点采用 Huabu `PreviewCard` 的 cover + info 结构：

```text
┌─────────────────────────────┐
│ [paper cover / favicon]      │
│ Agentic Harness Engineering │
│ 2026 · paper                │
│                             │
│ component observability     │
│ ablation · edit prediction  │
│                             │
│ reused 2 · challenges 1     │
└─────────────────────────────┘
```

Preview 只显示由 Reader 或 Resolver 确认过的摘要。论文的原文、页码、段落、版本和引用操作在 Detail 中显示；摘要生成失败时保留标题与来源链接，不用模型生成文本填空。

Fragment 不应和整篇 Work 使用同一种卡片：它要显示精确引用片段、定位信息和它支持的 claim。

```text
Fragment card
┌─────────────────────────────┐
│ EVIDENCE · grounded         │
│ “...”                       │
│ Paper A · p. 4 · §3.2       │
│ supports: Claim C-03        │
└─────────────────────────────┘
```

### 4.3 Hypothesis / Prediction

Hypothesis 节点采用颜色较弱、文字较强的卡片，显示机制和 falsification hook：

```text
H1 · hypothesis
Edit effects depend on prior state.

prediction 2 · null defined
status: proposed / selected / rejected
```

Prediction 不应只作为 Hypothesis 的 bullet。若它被用于连接 Method 或 Evaluation，应成为独立可连接节点；这样用户可以看见哪一条 prediction 没有被方法覆盖。

### 4.4 Method / Component / Claim

Method 组件显示职责，不显示实现代码：

```text
METHOD COMPONENT
Typed Edit Lineage

records: edit · parent state · outcome
tests: P1 · P2
role: core
```

Claim 节点显示要证明的句子和当前支持状态：

```text
CLAIM · primary
Targeted replay estimates history-dependent interaction.

supports: Attribution Fidelity
evidence: planned
```

Claim 的 `planned`、`partial` 和 `grounded` 必须区分。Method proposal 不能因为放进 Idea Frame 就显示为事实。

### 4.5 Evaluation / Baseline / Review

Evaluation 节点显示它要区分的 claim；Baseline 显示它排除的解释；Review 节点显示阻塞项。

```text
EVALUATION · primary
Attribution Fidelity
supports: M1
compare: Full Replay Oracle
```

```text
REVIEW · needs revision
2 weak links · 1 freshness issue
```

Review 节点不能被折叠成普通 Note，否则用户会错过阻塞状态。它需要保留一个可见 status mark，并在详情中列出可接受、编辑和拒绝的 Review Comment。

## 5. Semantic Zoom 与节点层级

Huabu 对 note、pdf、web 等重型节点使用基于屏幕宽度的 minimal LOD，并带 hysteresis，避免缩放临界点闪烁。CoResearch 采用三层显示：

```text
screen width >= 180 px   preview card
90–180 px                compact identity + status
< 90 px                  semantic mark / takeover
```

阈值必须按屏幕尺寸而非 Canvas 坐标判断。节点从 preview 进入 compact 时保留类型图标、短标题和状态颜色；进入 mark 时保留节点类型、confirmed/stale/blocked 和未读 Review 数。

不同节点的缩放策略：

| 节点 | compact | takeover |
|---|---|---|
| Paper | favicon + 短标题 | paper mark + evidence count |
| Problem | P 图标 + 标题 | Problem mark + status |
| Hypothesis | H 图标 + 编号 | hypothesis mark + prediction count |
| Method | wrench / method mark | core / supporting 状态 |
| Review | review mark | blocked / needs-review 状态 |
| Agent Node | agent avatar + unread dot | agent mark + running/error |

采用 Huabu Question Node 的连续 takeover 方式：mark 从卡片角落平滑移动到节点中心，边的终点和连接端口同步过渡。这样缩放时连接关系不会突然跳到另一个位置。

## 6. Detail Surface：从节点读完整内容

节点点击只打开 Detail，不把卡片无限放大。Detail Surface 有三种入口：

```text
单击：选中节点，显示轻量预览
双击：打开详情 takeover / inspector
Agent Node：打开绑定对话，同时显示当前上下文
```

Detail 面板固定使用同一信息顺序：

```text
1. Identity：类型、标题、版本、状态
2. Statement：完整正文或摘要
3. Evidence：来源、Fragment、检查时间、coverage
4. Relations：所有 typed incoming / outgoing links
5. Review：未决评论、冲突、用户动作
6. Actions：编辑 draft、连接、确认、返回上游
```

`NodePreviewContent` 的结构可以作为前端适配器：先渲染 `AiSummaryBanner`，再渲染 entity-specific Preview；详情面板负责 Research Domain 语义，不把 Domain 写入逻辑放进 Preview 组件。

## 7. 连接动作的两种入口

### 7.1 从连接端口拖拽

复用 Huabu `NodeConnectAffordance` 的四边 source/target handles。端口采用 outward hit area，避免侵入节点内容区域。

```text
用户按住节点边缘端口
        ↓
出现 pending edge
        ↓
拖到另一个节点
        ↓
显示 relation picker
        ↓
选择关系类型和依据
        ↓
创建 visual edge 或 relation proposal
```

拖拽到空白处时，复用 Huabu 的“创建连接节点”模式，但 CoResearch 先让用户选择实体类型：Question、Note、Prediction 或 Review Comment。不能由拖拽方向猜出研究类型。

### 7.2 从节点快捷动作连接

选中一个节点后，浮动 toolbar 显示 `Connect`。用户点击目标节点或多选目标，系统根据两端实体类型给出推荐关系，但关系仍需用户选择或确认：

```text
Problem → Hypothesis
  explains / challenges

Hypothesis → Method
  tests / operationalizes

Method → Evaluation
  evaluated_by / supports

Paper / Fragment → Claim
  supports / challenges

Closest Work → Method
  overlaps / reuses / differentiates
```

推荐关系来自类型矩阵，不来自模型自由生成。

## 8. Relation Picker

连接完成前，画布显示轻量 relation picker：

```text
┌──────────────────────────────┐
│ Connect Problem → Hypothesis │
│                              │
│ ○ explains                   │
│ ○ challenges                 │
│ ○ motivates                  │
│                              │
│ evidence: [add source]       │
│ status: proposal             │
│ [Create proposal] [Cancel]   │
└──────────────────────────────┘
```

三种关系状态：

```text
visual       只有布局意义，不代表研究事实
proposal     Agent 或用户提出，等待证据 / 用户审阅
confirmed    领域服务已验证，带 sourceRefs 和 contentHash
```

用户创建 `visual` 连线应当快捷；用户创建 `proposal` 或 `confirmed` 关系必须经过 picker。Agent 只能创建 proposal，不能直接创建 confirmed relation。

## 9. Typed Relation Matrix

```ts
type ResearchRelationType =
  | 'contains'
  | 'motivates'
  | 'explains'
  | 'tests'
  | 'operationalizes'
  | 'supports'
  | 'challenges'
  | 'reuses'
  | 'overlaps'
  | 'differentiates'
  | 'evaluated_by'
  | 'compares_against'
  | 'derived_from'
  | 'blocks'
```

```ts
interface ResearchRelationProposal {
  id: string
  projectId: string
  from: VersionedRef
  to: VersionedRef
  type: ResearchRelationType
  status: 'visual' | 'proposal' | 'confirmed' | 'rejected' | 'stale'
  sourceRefs: string[]
  rationale: string | null
  createdBy: 'user' | 'agent' | 'system'
  expectedRevision: number | null
  contentHash: string | null
}
```

允许关系矩阵：

| from | to | 推荐关系 |
|---|---|---|
| Seed / Focus | Direction | explores |
| Direction | Work | contains / represented_by |
| Work / Fragment | Limitation / Claim | supports / challenges |
| Problem | Hypothesis | explained_by / motivates |
| Hypothesis / Prediction | Method / Operation | tests / operationalizes |
| Method Claim | Evaluation | evaluated_by / supports |
| Evaluation | Baseline | compares_against |
| Closest Work | Method | overlaps / reuses / differentiates |
| Review | 任意对象 | blocks / challenges |

领域关系枚举可以比 Canvas 的普通 edge style 更严格。`EdgeStyle.label` 只作为渲染字段，真实关系类型来自 `ResearchRelationProposal.type`。

## 10. Edge 展示策略

复用 Huabu 的 edge style 能力，但把视觉规则绑定到关系状态：

| 状态 / 类型 | 线型 | 箭头 | 颜色语义 |
|---|---|---|---|
| visual | dotted | none | 中性灰 |
| proposal | dashed | forward | relation accent |
| confirmed supports | solid | forward | green / evidence accent |
| confirmed challenges | solid | forward | red / warning accent |
| stale | dashed | forward | muted amber |
| blocks | solid | forward | danger accent |

边标签只在选中、悬停或 zoom 足够时显示；远看只保留线型、箭头和颜色，防止整个 Canvas 被文字淹没。标签内容来自关系类型的本地化名称，不使用自由句子。

## 11. 边创建的事务路径

画布命令与领域关系创建分成两个动作：

```text
1. CanvasExecution
   CONNECT_NODES / SET_EDGE_STYLE
   → 立即显示 visual edge 或 pending proposal edge

2. ResearchRelationCommand
   CreateRelationProposal / ConfirmRelation
   → 领域服务校验端点、版本、类型和来源

3. Projection update
   → 回写 relation status、label、stroke、contentHash
```

不能在 `CONNECT_NODES` 的 payload 中直接伪造 `confirmed`、sourceRefs 或 evidenceState。Canvas edge 创建成功而领域关系创建失败时，保留 visual edge 并显示 `needs_review`，不能静默显示成 confirmed。

## 12. 连接冲突与 stale 处理

连接时服务端校验：

```text
端点是否属于当前 project
端点 revision 是否仍然匹配
关系类型是否符合 matrix
是否存在同类型重复关系
来源是否可读
是否有 Review blocker
```

失败反馈：

```text
not-found       端点已删除或未同步
stale           端点已产生新 revision
invalid-type    两端不允许该关系
duplicate       已存在相同 confirmed relation
missing-source  proposal 缺少必要 evidence
blocked         Review 尚未解决
```

端点 revision 更新后：

- visual edge 保持不变。
- proposal edge 标记 stale，等待重新审阅。
- confirmed relation 保留历史版本，但当前投影显示 stale。
- 用户重新确认后创建新 relation revision。

## 13. 连接后的局部上下文

连接本身会改变 Agent Node 的上下文，但不会追溯修改旧对话。每次 Agent 运行保存：

```ts
interface AgentContextSnapshot {
  agentNodeId: string
  selectedRefs: VersionedRef[]
  parentFrameRef: string | null
  nearbyNodeIds: string[]
  connectedRelationIds: string[]
  capturedAt: string
}
```

用户应能在 Agent Node 上看到“本次使用的节点”和“本次运行时的关系”。移动节点或新增连线只影响下一次运行，除非用户显式刷新上下文。

## 14. 位置和关系的独立性

```text
拖动 Paper 到 Method Frame
→ 更新 position / parentId
→ 不创建 reuses 关系

拖动边缘连线并选择 reuses
→ 创建 relation proposal
→ 不改变 Paper 的 entityKind
```

Frame 是视图分组；typed Edge 才表达研究语义。布局器可以按 Step、时间线或关系类型排列，但自动布局不能改变关系类型，也不能覆盖用户锁定的位置。

## 15. 由深模块承载的接口

建议把复杂性集中在三个模块，而不是散落到每个节点组件：

```ts
interface ResearchNodeProjection {
  project(entity: VersionedResearchEntity): ResearchNodePresentation
  projectDetail(entity: VersionedResearchEntity): ResearchDetailModel
}

interface ResearchRelationCoordinator {
  propose(input: RelationInput): Promise<RelationResult>
  confirm(input: ConfirmRelationInput): Promise<RelationResult>
  reject(input: RejectRelationInput): Promise<RelationResult>
}

interface CanvasResearchBinding {
  bind(entity: VersionedRef, canvasObjectId: string): Binding
  reconcile(binding: Binding): ProjectionDelta[]
  applyLayoutChange(change: LayoutChange): void
}
```

节点渲染器只需要知道 `ResearchNodePresentation`；关系渲染器只需要知道 `ResearchRelationView`。版本校验、关系矩阵、stale 传播和领域写入集中在 coordinator / binding 实现中，保持接口小而行为深。

## 16. 最小验证链路

```text
创建 Problem 与 Hypothesis 节点
→ 端口拖拽
→ Relation Picker 选择 explains
→ 创建 proposal edge
→ 添加 Fragment source
→ Confirm relation
→ edge 变为 solid + evidence accent
→ 修改 Hypothesis revision
→ edge 变为 stale
→ 用户重新审阅并创建新 relation revision
```

同时验证：

- 远距离缩放时节点仍显示类型与状态。
- 详情展开时摘要、正文、来源和关系可定位到同一 entity revision。
- `CONNECT_NODES` 失败不会留下半条 confirmed relation。
- visual edge 删除不删除 Research Relation。
- Agent 生成的关系保持 proposal 状态。
- 用户移动节点不会触发领域写入。
- 两个 Canvas 节点绑定同一实体时，内容更新保持一致而布局独立。

## 17. 与已有设计的衔接

本文细化 [huabu-domain-binding.md](./huabu-domain-binding.md) 的 Node / Edge Binding，补充内容展示、语义缩放、详情读取、连接入口、关系矩阵和 stale 传播。

Step 8 的 `Idea`、`Review`、`Evidence Audit` 和 `Closest-Work Stress Test` 都使用同一套节点与关系机制：Review Comment 通过 `blocks` 或 `challenges` 连接目标对象；Evidence Fragment 通过 `supports` 或 `challenges` 连接 Claim；Idea Snapshot 通过引用关系汇总对象，不复制正文。

Research Wiki 继续持有论文和证据事实，Idea Space 继续持有用户确认的研究决定。Agent 可以提出节点和关系，用户确认后才改变 confirmed domain state。

## 18. 核查依据

本设计依据 Huabu 本地源码：

- `apps/web/src/components/Nodes/PreviewCard.tsx`
- `apps/web/src/components/Nodes/NodePreviewContent.tsx`
- `apps/web/src/components/Nodes/NodeConnectAffordance.tsx`
- `apps/web/src/components/Nodes/NodeWrapper.tsx`
- `apps/web/src/hooks/useNodeLOD.ts`
- `apps/web/src/hooks/useNodeTakeover.ts`
- `apps/web/src/config/semanticZoom.ts`
- `packages/shared/src/types/canvas/edge.ts`
- `packages/shared/src/types/canvas/command.ts`

本次只读取源码和已有设计文档，没有修改 Huabu，也没有验证 CoResearch 的实现链路。
