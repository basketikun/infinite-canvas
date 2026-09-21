# CoResearch Step 3：Direction Exploration 与 Focus 确认

- 日期：2026-09-17
- 状态：设计提案；本次不实现页面、Skill 或服务。
- 上游：[Step 2 · Research Landscape](./02-research-landscape.md)。
- 关联：[Step 1 · Seed](./01-seed.md)、[Idea 结构设计](../idea-structure.md)。
- 下游：[Step 4 · Problem Formation](./04-problem-formation.md)。
- 产品流程真值：[Research Flow](../research-flow.md)。Flow 把 Direction Exploration 放在 Deep Dive 之前：候选先活在 Conversation，用户保存进 Canvas 后才成为 Direction；结束条件是至少一个 `selected_for_deep_dive`，不是确认最终 Focus。若与 Flow 冲突，以 Flow 为准。

## 1. Step 3 解决什么

**让用户在 Research Landscape 中浏览、追问并确认自己真正想继续研究的 Focus。**

Step 2 形成领域地图；Step 3 保存用户在这张地图中的选择。它回答“地图里的哪一部分吸引我，以及我具体想继续追问什么”。

```text
ResearchLandscape
      ↓
选择一条路线或自由描述兴趣
      ↓
查看这条路线的已知演化和当前状态
      ↓
用户提出更具体的追问
      ↓
必要时补充文献核查，定位追问
      ↓
整理并确认 Focus
      ↓
Step 4 · Problem Formation
```

Step 3 不要求用户已经知道 Research Question，也不生成正式 Hypothesis、Method 或 Contribution。它可以显示问题线索及核查状态，但不会把 Focus 自动升级为 gap。

## 2. 输入与输出

### 2.1 输入

```ts
interface DirectionExplorationRequest {
  projectId: string
  landscapeRef: {
    id: string
    revision: number
    snapshotHash: string
  }
  seedRef: {
    id: string
    revision: number
    contentHash: string
  }
  coverageId: string
  directionIds: string[]
  outstandingIssueIds: string[]
  requestId: string
}
```

Step 3 固定读取一个 Landscape revision。页面可提示存在新版本，但不会在会话中静默换图或替换路线。

输入 Landscape 可以是 `ready` 或 `partial`。partial 时，缺失来源、未完成核查和路线不确定性持续显示。`insufficient_evidence` 只提供宽兴趣探索、修改 Seed 或继续 Step 2；不能假装已有成熟研究路线。

### 2.2 输出

Step 3 的正式输出只有 ConfirmedFocus：

```ts
interface ConfirmedFocus {
  schemaVersion: 1
  id: string
  projectId: string
  seedRef: { id: string; revision: number; contentHash: string }
  landscapeRef: { id: string; revision: number; snapshotHash: string }
  revision: number
  title: string
  statement: string
  parentDirectionRefs: DirectionRef[]
  interestRefs: InterestRef[]
  boundaryNotes: string[]
  unresolvedTerms: string[]
  literaturePosition: {
    relatedWorkIds: string[]
    relatedQuestionIds: string[]
    assessment: 'mapped' | 'partially_mapped' | 'needs_verification'
    assessmentRefs: string[]
  }
  provenance: FocusProvenance[]
  status: 'draft' | 'confirmed'
  confirmation: null | {
    actorId: string
    actionRef: string
    contentHash: string
    confirmedAt: string
  }
  createdAt: string
  updatedAt: string
}
```

Focus 保存用户兴趣，不保存“这个问题确实尚未解决”的结论。`literaturePosition.assessment` 描述系统是否已将兴趣定位到当前地图，并不评价研究价值。

## 3. 页面流程

### 3.1 首屏：选择想继续看的区域

```text
STEP 3 · DIRECTION
Landscape 截止日期 · 覆盖状态 · 未完成项

看完这张 Research Landscape，你想继续了解哪一块？

A  Automatic Harness Evolution
   自动修改与验证 Harness

B  Experience-driven Adaptation
   从历史运行经验调整 Harness

C  Credit & Attribution
   判断一次修改为什么有效

D  Continual Harness Evolution
   长期变化、能力保留与遗忘

E  Harness Utilization
   Agent 是否真正调用并利用更新

F  Integrity / Governance
   修改带来的虚假提升与完整性风险

[直接描述：我比较关心……]
```

真实产品只显示当前 Landscape 中有证据的路线。A–F 是案例，不是固定 taxonomy。

用户可以选择一条路线，也可以直接描述兴趣。V1 不要求多选路线；当用户的自由描述跨路线时，系统可以建立多个 parentDirectionRefs。用户选择某路线只表示“想进一步了解”，不等于确认最终 Focus。

路线卡显示核心问题、当前能力、当前问题和 coverage 摘要。不给路线打“推荐分”或“创新潜力分”。系统可解释为什么某路线与 Seed 相关，但不替用户自动选择。

### 3.2 放大路线

假设用户选择 Credit & Attribution，页面展开：

```text
C · CREDIT & ATTRIBUTION

核心关切
Harness 修改后，如何理解性能变化来自哪里？

问题演化
只看整体结果
  → 验证单次修改
  → 判断应保留哪个 patch
  → 比较不同组件的贡献

方法演化
总分比较
  → 回归验证
  → edit outcome / credit
  → component observability / ablation

当前状态
已有能力        带范围和证据
仍在研究        经 Step 2 后续核查的问题
待进一步核查    证据不足或仅由系统推断的线索

[查看来源] [查看完整路线] [追问这条路线]
```

这份内容直接投影 Step 2 的固定快照。Step 3 不重新改写路线历史。每一项可以回到来源、版本与 coverage。

### 3.3 用户追问与局部核查

用户可能问：

> 如果 skills、tools、memory 一起变化，怎么知道是谁起作用？

系统先在现有 Landscape 中检索相关 Work、Question、Approach 和 Statement。若现有快照不足，明确提出补充核查：

```text
这个追问涉及多个组件共同变化时的归因。
当前地图覆盖了组件消融、patch credit 和持续演化，
但还不能判断是否已有工作直接研究组合效应。

[基于当前地图继续整理]
[补充核查这个问题]
```

用户发起补充核查后，生成 FocusProbe。它是小范围的文献定位任务，不替代 Step 2 的全图重建。

```ts
interface FocusProbe {
  id: string
  explorationSessionId: string
  landscapeRef: LandscapeRef
  userQuestion: string
  normalizedQuestion: string
  scope: string
  queryPlan: string[]
  budget: ProbeBudget
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  result: null | {
    adjacentEvidenceRefs: string[]
    directEvidenceRefs: string[]
    conflictingEvidenceRefs: string[]
    uncoveredAspects: string[]
    position: 'covered' | 'partially_covered' | 'needs_verification'
    coverageId: string
  }
}
```

Probe 使用 Step 2 的 Work resolver、Reader 和 temporal verification；结果写入 Research Wiki，并形成新的局部评估。它不会在后台把原 Landscape revision 改成新图。用户之后可选择刷新 Step 2 生成新的 Landscape revision。

“本次未找到直接工作”只能输出 needs_verification。它不能写成 open gap、novel 或无人研究。

## 4. 从用户追问收敛为 Focus

用户进一步说明：

> 我关心的不是单个 component 谁重要，而是一个 edit 的作用会不会依赖之前发生的 edit。

系统整理为 Focus draft：

```text
当前 Focus · 待确认

在 Agent Harness 持续演化过程中，
当 Skills、Tools 和 Memory 被连续修改时，
我想进一步理解一个 Harness Edit 的作用
如何依赖此前的 Harness 状态和修改历史。

来源路线
Credit & Attribution
Continual Harness Evolution

当前文献定位
已有相邻研究；是否直接覆盖历史依赖的交互归因仍需核查。

尚未形成
具体研究问题、假设、方法与贡献

[编辑] [看看其他路线] [确认 Focus →]
```

系统可以将用户用语归一化成简短标题，例如 “Sequential, history dependent attribution in continual harness evolution”，但正文优先使用用户能核对的语言。专业术语如果不是用户原话，保存为 Agent paraphrase，并保留原始消息引用。

Focus 可以位于路线交叉处，但不需要为此引入独立的 Cross-direction 产品模式。多个 parentDirectionRefs 足以表达来源。

## 5. Focus 数据结构的语义

### 5.1 InterestRef

```ts
interface InterestRef {
  id: string
  kind: 'user_message' | 'direction' | 'phase' | 'approach'
    | 'question' | 'paper_fragment' | 'probe_result'
  targetId: string
  relation: 'selected' | 'clarifies' | 'narrows' | 'connects' | 'challenges'
  note: string
}
```

用户消息是第一来源。文献对象帮助定位，但不会把系统路线自动变成用户观点。

### 5.2 BoundaryNotes

BoundaryNotes 只保存用户明确表达或为了防止歧义而由用户确认的边界，例如：

- 关注连续修改中的历史依赖。
- 暂时不把单组件重要性排序作为中心。
- 关注 Skills、Tools 与 Memory；Control Logic 尚未确认。

不能根据没有被提到的对象自动产生 exclusion。用户说“更关心 X”也不必解释成“完全排除 Y”。

### 5.3 Focus 不是 Problem

| Focus 可以包含 | 留给 Step 4 |
|---|---|
| 感兴趣的现象、对象和范围 | 具体可研究的问题陈述 |
| 来源路线和相邻工作 | “现有方法在哪些条件下不足”的证据 |
| 用户追问原话 | 可证伪的假设 |
| 已覆盖、部分覆盖或待核查的定位 | gap 是否成立及其边界 |
| 用户明确的兴趣边界 | 方法、实验和贡献 |

Focus statement 可以是陈述或开放式兴趣，不要求写成问号结尾。Step 4 才判断能否从它形成一个或多个 Problem Candidate。

## 6. 用户确认规则

以下操作具有不同语义：

| 操作 | 写入 |
|---|---|
| 点击路线卡 | 浏览状态，不创建 ConfirmedFocus |
| “我对 C 感兴趣” | 选择路线，建立探索草稿 |
| 提出追问 | 保存用户消息与 Focus draft 的来源 |
| 发起 Probe | 创建研究任务，不确认 Focus |
| “对，就是这个”或点击确认 | 确认当前 hash 对应的 Focus |
| 编辑已确认 Focus | 创建新 draft revision，不改写旧确认 |

确认绑定完整 Focus 内容及引用的 Landscape revision。系统增加新范围、组件或术语后必须重新展示；不能沿用旧确认。

用户可以在 Probe 未完成时确认兴趣，Focus 的 position 为 needs_verification。确认的含义是“我想继续研究这里”，不是“这里存在 gap”。

## 7. 探索会话与状态

```ts
interface DirectionExplorationSession {
  id: string
  projectId: string
  seedRef: SeedRef
  landscapeRef: LandscapeRef
  status: 'browsing' | 'focusing' | 'focus_ready'
    | 'focus_confirmed' | 'parked'
  selectedDirectionRefs: DirectionRef[]
  activeFocusDraftId: string | null
  confirmedFocusId: string | null
  probeIds: string[]
  createdAt: string
  updatedAt: string
}
```

状态表示产品进度，不表示文献判断。用户可以退回浏览、比较另一条路线或保留多个未确认草稿。V1 最终确认一个 active Focus 进入 Step 4；其他草稿标记 parked，不删除。

多个相互独立的兴趣若用户都要继续，应创建多个 Focus，分别进入后续流程。不能把它们强行拼成一个很宽的 Focus。

## 8. Landscape 更新与失效处理

探索会话固定 Landscape revision。若 Step 2 后续刷新：

1. 展示“研究地图有更新”。
2. 给出相关路线的合并、拆分、新证据和问题状态变化。
3. 保留原 Focus 与原引用。
4. 用户选择重新定位时创建新的 Focus revision 或 assessment，不改写历史确认。

路线 ID 变化需要 Step 2 提供 replacement / merged_into / split_into 对应关系。没有可靠对应时标记 source direction unavailable，仍保留原快照标题与内容。

一个新的论文挑战 Focus 只改变 literaturePosition，不撤销用户兴趣。用户可以继续、修改或放弃，决定属于用户。

## 9. Step 3 完成 Gate

Focus Ready 需要：

1. Focus statement 非空，用户能理解其含义。
2. 至少一个用户消息或明确选择作为来源。
3. 绑定 Seed 与固定 Landscape revision。
4. 来源路线或“地图外兴趣”已明确。
5. 文献定位状态与未核实事项公开。
6. 用户明确确认当前内容 hash。

不要求：

- 文献已经证明这是 gap。
- novelty 已确认。
- 已形成 Research Question。
- 已选择 Hypothesis、Method 或 Experiment。
- Probe 必须返回 covered 或未覆盖。

Focus 若完全位于地图外，也可以确认，但标记 `partially_mapped` 或 `needs_verification`。Step 4 先补定位或形成候选问题，不能把地图外自动解释为创新。

## 10. Step 3 → Step 4 交接

```ts
interface ProblemFormationRequest {
  projectId: string
  focusRef: { id: string; revision: number; contentHash: string }
  seedRef: SeedRef
  landscapeRef: LandscapeRef
  probeRefs: ProbeRef[]
  outstandingIssueIds: string[]
  requestId: string
}
```

交接前验证 Focus confirmed、hash 匹配、引用存在。Step 4 返回 problemFormationSessionId。相同 requestId 幂等。

Step 4 必须能够读取：用户原话、Focus 的边界、来源路线、相关 Work/Question、Probe coverage 及未完成核查。它不能只收到一段失去出处的 Focus 文本。

Focus 为 needs_verification 时允许进入 Step 4，但下游必须保留该状态。Step 4 形成 Problem Candidate 后还要验证具体前提，不得把 Focus 的兴趣确认当成问题成立证据。

## 11. 页面与交互细节

页面采用两层结构：路线列表与选中路线详情。追问发生在右侧对话或路线详情下方；用户不需要理解 Probe、Assessment 等内部名称。

用户看到的状态语言：

| 内部状态 | 页面文案 |
|---|---|
| mapped | 已在当前地图中找到直接相关研究 |
| partially_mapped | 找到相邻研究，具体关注点只覆盖了一部分 |
| needs_verification | 当前地图不足以判断，需要继续核查 |
| landscape partial | 这张地图仍有来源或核查缺口 |

Probe 运行时显示查询范围、已检查来源和停止原因。失败或取消后保留用户追问与 Focus draft，不丢失选择。

“确认 Focus”旁展示一句解释：“保存你想继续深入的方向；下一步才形成并验证具体研究问题。”

## 12. 存储边界

建议目标结构：

```text
research/foci/<focus-id>/
├── manifest.json
├── drafts/<revision>.json
├── confirmed/<revision>.json
├── decisions/<decision-id>.json
└── views/<revision>/focus.md

research/explorations/<session-id>/
├── state.json
└── probes/<probe-id>.json
```

Focus 属于用户研究状态；Landscape、Work、Question 与 Fragment 属于 Research Wiki；页面投影可重建；运行 trace 仍在 `.coresearch/`。

Probe 新发现的 Work、Fragment 和 Assessment 写入 Wiki。Probe 的用户问题、预算、coverage 与本地结果引用属于研究记录，不能只留在可清理日志中。

正式确认使用不可变快照、contentHash 和 requestId；重复点击不创建重复 Focus。多文件实现必须通过领域服务提供可恢复提交，不能由 Agent 自由写入并自行宣布确认。

## 13. 逻辑能力边界

未来可用一个 direction exploration Skill 协调以下操作：

- list_directions：读取固定 Landscape 的路线。
- inspect_direction：查看路线、来源与覆盖。
- ask_direction：基于当前地图回答并指出证据缺口。
- probe_focus：启动局部文献核查。
- draft_focus：从用户语言整理可编辑草稿。
- confirm_focus：由领域服务验证用户动作后提交。

逻辑上可以由一个用户可见 Main Agent 完成，无需为浏览、检索和整理分别新增运行进程。Agent 可以提议 Focus；用户提交 Focus。

## 14. Golden Path 示例

以下是模拟流程，不代表已执行文献调研或当前用户已确认该 Focus。

```text
Step 2 提供路线：
A 自动演化 / B 经验适配 / C 归因 / D 持续演化 / E 利用 / F 完整性

用户选择 C
→ 只记录选择并展开 C 的路线

用户问多个组件共同变化如何归因
→ 先查当前 Landscape
→ 若证据不足，由用户发起局部 Probe
→ 返回相邻覆盖与 needs_verification

用户进一步说明关注 edit 对过去状态的依赖
→ 整理 Focus draft
→ 连接 C 与 D 两条来源路线
→ 显示边界、相邻工作和未核查项

用户确认
→ 保存 ConfirmedFocus
→ 进入 Step 4
```

预期 Focus：

> 在 Agent Harness 持续演化过程中，我想理解一个 Harness Edit 的作用如何依赖此前的 Harness 状态与修改历史。

此时 Problem、Hypothesis、Method、Novelty 和 Contribution 均尚未建立。

## 15. 验收场景

| 场景 | 应满足的不变量 |
|---|---|
| 用户打开路线 | 不自动创建或确认 Focus |
| 用户说“C 有意思” | 只保存兴趣选择，系统整理仍待确认 |
| 用户自由描述地图外兴趣 | 可以建草稿，标记 needs_verification |
| Focus 横跨两条路线 | 保存多个 parentDirectionRefs，不造新固定模式 |
| Probe 未找到直接工作 | 输出 needs_verification，不宣布 gap |
| Probe 发现直接覆盖 | 更新定位并展示证据，不替用户放弃兴趣 |
| Landscape 是 partial | 缺失项始终随 Focus 和交接携带 |
| Landscape 更新 | 保留原快照，用户决定是否重新定位 |
| 用户确认后编辑 | 新 draft revision，旧 confirmed 快照不变 |
| 重复点击确认 | 只产生一次正式提交 |
| 页面刷新或服务重启 | 选择、追问、Probe 和确认状态可恢复 |
| Step 4 接收 Focus | 同时得到来源、coverage 和待核实项 |

完成标准是：用户能说清自己对哪部分真正感兴趣，系统能说明它位于当前地图的哪里、有哪些相邻研究和哪些判断仍未核实。

## 16. 与现有设计的衔接

本设计保持 [Step 2](./02-research-landscape.md) 的 `Step 2 → Step 3` 契约，并进一步定义 explorationSessionId、固定 Landscape revision、局部 Probe 与 ConfirmedFocus。

它也修订 [Idea 结构设计](../idea-structure.md) 中“文献直接提出 Problem 候选”的产品时机：Step 3 先让用户选择并确认 Focus；具体 Problem Candidate 推迟到 Step 4。Idea 的十维结构继续用于更后面的 Idea Development，不在 Step 3 提前创建。

## 17. 参考与使用边界

主要依据是用户本轮提供的 Step 3 简化流程。本文保留“选择路线 → 放大路线 → 用户追问 → 局部核查 → 确认 Focus”的主线，并补充固定快照、局部检索、状态与版本契约。

本地 [ARIS idea-discovery](../../../references/Auto-claude-code-research-in-sleep/skills/idea-discovery/SKILL.md) 在 literature survey 后进入 idea generation，并在非自动模式让用户调整范围。CoResearch 在两者之间增加独立的用户导航阶段，用于保存人的研究兴趣。这里只作流程比较，没有执行其中的自动选择和 idea generation 指令。

本文没有运行任何 harness 文献检索，也没有验证示例中 A–F 路线或 AHE、GSME、HCL 的实际覆盖。示例只能作为未来 fixture；真实页面必须读取 Step 2 产生的有来源数据。
