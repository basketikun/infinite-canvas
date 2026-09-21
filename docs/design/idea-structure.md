# CoResearch Idea 结构设计

> 从“我想研究 agent harness 自进化”到一个有依据、可修订的研究问题。

- 日期：2026-09-17
- 状态：设计提案，尚未修改 schema、脚本或 HTML。
- 关联：[Research Flow](./research-flow.md)、[空间设计](./space.md)、[Workspace 设计](./workspace.md)。
- 产品流程以 [Research Flow](./research-flow.md) 为准。十维是 Idea 的内容骨架，不是必须按顺序填完的问卷，也不替代 Seed → Direction → Problem 的确认顺序。
- 本文将用户提供的访谈过程作为假设案例。案例中后续的选择、确认和 Pivot 均不代表用户在当前会话已作出这些研究决定。

## 1. 核心决定

**Idea 是一个持续演化的研究状态，包含用户选定的表述、尚未采纳的候选、文献判断与决策历史。** 十个维度是组织内容的骨架，不是必须按顺序填完的问卷。

```text
Idea
├── Identity                 稳定身份、生命周期、分支来源
├── Formulation              Seed、Scope、十维研究表述
├── Proposals                未采纳的解释、问题、假设与修改
├── Literature Assessments   带出处的支持、重叠、挑战与缺口候选
├── Decisions                谁采纳了什么，为什么
├── Versions                 语义里程碑 v0 → v1 → v2 → v3
└── Working State            当前编辑与访谈上下文
```

Research Wiki 保存来源和片段；Idea 只引用它们。Idea Meta Space 将当前表述、锚点、语义版本和开放问题组合成视图，不另存一份可独立编辑的 Idea。

三个必须独立的判断：

| 判断 | 示例 | 谁能决定 |
|---|---|---|
| 用户是否认可表述 | “这确实是我想研究的问题” | 用户 |
| 文献如何评价它 | “已有部分重叠，仍有未评估工作” | 有出处的审阅记录，允许争议 |
| 实验结果如何 | “在指定任务与指标下得到负结果” | 绑定实验与协议的结果记录 |

确认不等于证实，研究准备度不等于新颖性，负结果不等于想法应自动删除。

## 2. 内容结构：十维之外，补上 Scope

| 字段 | 应保存什么 | 不应自动推断什么 |
|---|---|---|
| seed | 用户原始兴趣或观察，保留原话 | 贡献、方法或创新性 |
| scope | 自进化的含义、对象、时间尺度和边界 | 完整研究问题 |
| problem | 对象、具体困难、待回答的问题 | “前人都没有解决” |
| why_unsolved | 已有方法的具体不足，以及可能的困难机制 | 仅凭复杂就宣称未解决 |
| hypothesis | 可反驳的预测、成立条件 | 只有方法名称的口号 |
| method | 计划干预什么，如何实施与比较 | 已经有效的结论 |
| novelty | 与最近邻工作的明确差异表述 | 全球范围的首创保证 |
| evidence | 已有依据，以及单独标明的验证计划 | 把计划当结果 |
| constraints | 资源、数据、时间、适用范围 | 用户未指定的限制 |
| risks | 失败模式、触发条件、应对或停止条件 | 一般性的免责声明 |
| so_what | 得到不同结果时，各自有什么研究价值 | 只在正结果下成立的夸张承诺 |

Scope 是独立的结构化澄清对象，不增加第十一个“必填维度”。例如选择“根据经验持续修改”后可形成：

```json
{
  "meaning": "基于执行经验的持续 harness 更新",
  "editableComponents": ["skills", "tools", "memory"],
  "adaptationTimescale": "across_tasks",
  "modelWeights": "unspecified",
  "taskFamily": null,
  "nonGoals": []
}
```

用户没有说 control logic 或冻结模型权重，就不把它们自动写成已确认范围。后续问题若增加这些对象，需要再次展示差异。

`evidence` 内区分 `observations` 和 `validationPlan`：前者引用论文或实验，后者保存待测假设、比较条件、指标、判据和成本。`risks` 维度引用结构化风险条目，避免顶层 risks 与维度正文分别维护同一内容。

## 3. 最小类型契约

以下为目标模型示意，不是已落地的接口。字段 ID 和引用关系应由领域服务校验。

```ts
type DimensionId =
  | 'seed' | 'problem' | 'why_unsolved' | 'hypothesis' | 'method'
  | 'novelty' | 'evidence' | 'constraints' | 'risks' | 'so_what'

type Adoption = 'unknown' | 'draft' | 'confirmed'
type Origin = 'user' | 'agent' | 'import'

interface Statement {
  id: string
  summary: string
  detail: string
  origin: Origin
  derivation: 'verbatim' | 'paraphrase' | 'inference'
  sourceRefs: string[]          // 消息、片段、实验等，必须能解析
  adoption: Adoption
  confirmation: null | {
    decisionId: string
    contentHash: string         // 认可的是这一版具体表述
  }
}

interface IdeaState {
  schemaVersion: 2
  id: string
  title: string                // 可由 seed 生成描述性标题，不自动包装贡献
  lifecycle: 'exploring' | 'active' | 'parked' | 'rejected' | 'superseded'
  stateRevision: number        // 乐观锁和内部状态快照编号
  currentVersionId: string     // 用户可见语义里程碑
  parent: null | { ideaId: string; versionId: string }
  scope: Statement | null      // 结构化 scope payload 与此表述关联
  dimensions: Record<DimensionId, Statement | null>
  openQuestionIds: string[]
  riskIds: string[]
  proposalIds: string[]
  createdAt: string
  updatedAt: string
}
```

空维度使用 null，界面显示 unknown。来源与认可正交：用户可以采纳 AI 的推断，此时保留 `origin: agent` 和 `derivation: inference`，增加用户 confirmation，不能改成 `source: user` 来掩盖来源。

逐字记录的 Seed 可由该条用户消息直接形成确认依据，无需重复点击。模型概括、扩展或增加范围时则是 draft；“A 有意思”只确认关注 A，不等于认可系统随后写出的整段问题。

编辑已确认内容会使新表述回到 draft，原确认仍属于旧内容；用户明确执行“保存并确认”时可以一次完成。新文献挑战不撤销用户的历史确认，而增加独立的审阅状态。

### 3.1 Proposal：候选不能覆盖当前表述

```ts
interface Proposal {
  id: string
  ideaId: string
  baseStateRevision: number
  kind: 'clarification' | 'problem' | 'hypothesis' | 'revision' | 'pivot'
  changes: Array<{
    target: DimensionId | 'scope'
    beforeStatementId: string | null
    after: Statement
  }>
  rationale: string
  anchorIds: string[]
  alternativeGroupId: string | null
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
}
```

H1 局部反事实回放、H2 交互图、H3 edit bundle 是候选方向，并不天然互斥。只有产品明确要求本轮选择一种验证路线时，才将它们作为单选组；否则允许组合和改写。

### 3.2 Anchor 与 Assessment：事实和比较判断分开

```ts
interface LiteratureAnchor {
  id: string
  ideaId: string
  targetStatementId: string
  dimension: DimensionId | 'scope'
  fragmentId: string
  relation: 'context' | 'inspires' | 'provides_method' | 'supports'
    | 'contradicts' | 'overlaps' | 'reframes' | 'gap_signal' | 'reveals_risk'
  rationale: string
  reviewStatus: 'proposed' | 'accepted' | 'rejected' | 'needs_review'
  origin: Origin
}

interface Assessment {
  id: string
  targetStatementId: string
  anchorIds: string[]
  status: 'unassessed' | 'supported_in_scope' | 'contested' | 'insufficient'
  coverageId: string
  rationale: string
}
```

`strong_overlap` 不另造关系类型；重叠程度可在理由和结构化比较项中表达。`TRANSFER` 不另造维度：根据含义关联 constraints、risks、hypothesis 或 evidence。

Fragment 必须保存 paperId、实际 sourceVersion、原文和 locator。摘要就是合法片段，但标记 `sourceLevel: abstract`；不能伪装成全文实验表格。关系目标绑定 Statement ID，因此编辑后不会把旧依据静默套用到新内容；新表述的沿用锚点须重新评估。

Paper A 与 Paper B 的 same_problem 也是带依据的解释，不因它们同属一个关键词就自动确认。引用关系、主题相近和方法继承应分别记录。

## 4. 版本：stateRevision 与 semanticVersion 分开

上一份空间文档把每次用户提交称为 Revision。本次进一步规定：**内部提交保留完整记录，用户看到的 v0/v1/v2 只标记语义里程碑。**

| 层 | 何时变化 | 用途 |
|---|---|---|
| 编辑草稿 | 自动保存或手工保存 | 恢复未完成编辑，不作为正式结论 |
| stateRevision | 用户采纳、正式状态修改 | 并发校验、可追溯快照 |
| semanticVersion | 用户认可范围收敛、问题重构或重大假设/方法变更 | 演化时间线 |
| assessmentRevision | 新检索、新判断或锚点审阅 | 更新文献定位，不自动改 Idea |

例如修正一句话可令 stateRevision 从 12 变成 13，但仍显示“v3，后续编辑”。v3 本身指向不可变快照；当前状态另指向 13，不能偷偷改写 v3 的内容。

```ts
interface SemanticVersion {
  id: string
  ideaId: string
  number: number
  stateRevision: number
  parentVersionId: string | null
  kind: 'seed' | 'clarification' | 'refinement' | 'pivot'
  decisionId: string
  summary: string
}
```

Pivot 是语义版本的一种：用户采纳了研究方向改变，并记录 before、after、原因和触发材料。AI 可以建议这是 Pivot，但不自动提交。若新旧方向都继续探索，创建带 parent 引用的新 Idea，而不是将旧方向覆盖或自动标为 rejected。

## 5. Readiness：显示缺什么，不给创新百分比

现有代码的六个 gate 是 problem、why_unsolved、hypothesis、method、evidence、so_what；用户材料中的六项则包含 novelty、没有 so_what。两套不能都叫同一个“2/6 gates”。

建议取消单一总分，使用三个独立检查面板：

| 面板 | 检查内容 | 通过后意味着什么 |
|---|---|---|
| 问题表述 | 用户认可 problem、研究范围、为何值得问 | 可以继续定位 |
| 文献定位 | 最近邻比较、覆盖说明、重要挑战的处理 | 在指定范围内有差异假说 |
| 最小验证 | hypothesis、method、验证计划、资源与判据 | 可以考虑开展一次 pilot |

这些是可解释的派生检查，不是生命周期强制门。允许用户只有 Seed 就检索，只有具体问题就做探索性验证；不能为了凑六项而生成虚假内容。

Novelty 保留两层：用户可以认可“我主张的差异是 X”，但文献评估仍可为 unresolved。更具体的 `noveltyReview` 状态为 unassessed / unresolved / supported_in_scope / overlap_found，必须绑定覆盖记录。它随新工作出现而重新开放，不设置永久“创新已确认”。新颖性评估应在问题形成时开始，贡献性结论则在最近邻比较后谨慎形成。

## 6. 访谈与检索的触发契约

```text
Seed → 澄清含义 → 轻量文献探查 → 问题候选
  → 用户选择与确认 → 聚焦探查 → 挑战/支持
  → 修改提案 → 用户决定 → 新定位 → 再探查
```

访谈控制器根据“最值得解决的不确定性”选择下一步，不固定按维度下标加一。

| 触发 | 建议动作 | 可保存结果 |
|---|---|---|
| Seed 加可检索的 Scope | light probe | SearchRun、候选来源 |
| 用户确认 problem 或显著改变 scope | focused probe | 最近邻比较、锚点候选 |
| 新文献直接重叠 | challenge | 未解决挑战与修改 Proposal |
| 新假设/方法被采纳 | 方法与验证相关检索 | 依据、替代路线、风险 |
| 候选差异成形 | closest-work probe | noveltyReview 与覆盖 |

自动只读检索由项目的检索偏好和预算控制；未开启时生成可点击的查询建议。重复触发按 Idea、表述 hash、查询和语料版本去重；结果只匹配发起时的表述，过期结果可入 Wiki，但不能当成当前定位。

SearchRun 保存查询词、来源、时间、成功/失败、已访问与未访问条目、停止原因。达到预算或没有新增线索时回到用户，展示剩余问题；不无限循环到模型宣布“新颖”。

## 7. 案例完整推演

本节后续用户回答均为演示假设。初始输入之外的确认不得被导入真实 Idea 状态。

### 7.1 v0：只有 Seed

用户：“我想研究 agent harness 自进化。”

创建稳定 ideaId 与 v0 Seed 快照。只保存 seed 的原话及消息确认依据，其余九维为空，scope 为空。标题可直接用原话的简短形式。

系统给出含义候选：跨任务积累并修改、单任务即时适配、递归修改运行环境、先探索。用户选第一项并补充 skills/tools/memory 后，形成 Scope 草稿；认可该范围后建立 v1 clarification。

### 7.2 v1：经验驱动的持续更新

发起轻量探查，先建立 Wiki 来源与摘要片段。核实的摘要表明 Meta-Harness 搜索 harness code，Self-Harness 从执行轨迹出发提出并回归验证修改；因此宽泛方向已有直接相关工作。[Meta-Harness](https://arxiv.org/abs/2603.28052v1)、[Self-Harness](https://arxiv.org/abs/2606.09498v3)。

这支持“需要进一步具体化”的产品反馈，不支持“用户所有潜在方向都没有价值”。系统提出归因、泛化、update 与 benefit 的区别、完整性风险四类候选问题，保留来源与未确定范围。

### 7.3 v2：多组件归因

假设用户选择归因。系统将其表述为 draft：“当 skills、tools 和 memory 共同修改时，如何判断各修改对整体表现的贡献？”用户认可后生成 v2 refinement，并发起聚焦探查。

MemoHarness 摘要将更广泛的组件归因留作未来工作，可作为 gap_signal；AHE 摘要直接讨论难以归因的 edits、可观测性和组件消融，可作为 overlaps。它们同时存在，不需要互相抵消。[MemoHarness](https://arxiv.org/abs/2607.14159v1)、[AHE](https://arxiv.org/abs/2604.25850v4)。

系统展示的是“归因问题有线索，但已有部分处理”，不能把 MemoHarness 的 future work 直接升级为整个领域的已知空白。

### 7.4 v3：连续演化中的组件交互

假设用户选择组合效应，系统提出更精确的问题：

> 在 skills、tools 和 memory 连续共同变化时，如何区分单个 edit 的作用与组件交互作用，并描述这种判断的适用条件？

用户确认方向调整后建立 v3 pivot，触发依据包括 AHE 的重叠和用户对组合效应的选择。若拟增加 control logic，另列范围扩展供确认。

`why_unsolved` 可以提出组合成本、随机评估、序列依赖三个解释。它们首先是 inference；用户选择并认可后成为已采纳表述，但仍需文献和实验支持，不能自动变成“已有工作未解决”的事实。

H1 局部反事实回放、H2 学习交互图、H3 评价 edit bundle 均保留为 pending Proposal。特别是 H1：相同随机种子不保证可比较的反事实，工具状态、记忆、任务分配与执行路径都可能变化；需要后续定义处理单位、对照、可回放条件和估计目标，当前不能宣称实现因果识别。

### 7.5 案例结束时，究竟保存了什么

| 内容 | 最终示例状态 |
|---|---|
| seed / scope | 用户在演示中明确认可 |
| problem | v3 表述已认可，存在进一步定位需求 |
| why_unsolved | 假设用户选择组合成本与序列依赖后确认；证据仍可能不足 |
| hypothesis / method | 多个候选，尚未采纳 |
| novelty | 未形成表述，review unresolved |
| evidence | 已有文献锚点；没有自己的实验结果 |
| constraints / risks / so_what | 可有待审提案，未替用户确认 |
| outcome | 未评估，不能设为 positive |

因此页面可显示“问题与困难表述已认可；假设待选；新颖性待定位；验证计划未形成”。不显示“找到创新点”。

后续以 interaction、sequential edits、attribution 等检索；还需关注 Harness Continual Learning 已讨论 harness-level forgetting、组件和受约束的演化，其摘要也报告组件消融，不能未经比较就排除重叠。[HCL](https://arxiv.org/abs/2608.19013v1)。

## 8. HTML / Meta Space 的数据映射

```text
Idea v3 · 当前表述                     [查看里程碑快照]
问题：已认可                          文献定位：尚待解决

维度列表 | 当前表述与待审修改 | 原文依据与比较理由
         | H1 / H2 / H3      | AHE：部分重叠
         | 编辑 / 采纳 / 拒绝| MemoHarness：空白线索

演化：v0 Seed → v1 范围澄清 → v2 归因 → v3 交互归因
```

当前表述与提案必须分栏或明确分区；选中问题只显示对应 Statement 的 anchors。历史版本展示当时的表述和定位，新 Wiki 重新评估历史版本必须另标“按当前文献重评”。

点击版本转折能查看 before/after、用户决定、原文片段；点击“采纳”绑定 proposalId、baseStateRevision、所选变更和用户动作。过期提案先重新比较；拒绝候选不删除 Wiki 文献。

## 9. 持久化与现有实现的衔接

沿用本地 state.json 入口，目标结构如下；本文不执行迁移。

```text
research/ideas/<idea-id>/
├── state.json                 # 当前正式表述，指向 stateRevision
├── drafts/                    # 未提交编辑
├── snapshots/<revision>.json  # 不可变正式状态快照
├── versions/<version-id>.json # 语义里程碑 → snapshot
├── proposals/<id>.json
├── decisions/<id>.json
├── assessments/<id>.json
└── views/                     # HTML 所需投影、idea.md、timeline
```

来源与原文归 Wiki；关系记录只维护一份，Idea/Statement 通过 ID 引用。快照固定当时采用的锚点和审阅记录，后续关系变化不能改写历史。领域记录属于 research，运行 trace 属于 .coresearch。

写入由单一领域服务串行处理，原子提交正式快照和当前指针，并通过 requestId 保证重复采纳幂等。版本和决策不得出现“已显示但对应快照不存在”的半提交状态。具体存储事务实现留给实现阶段，不能仅依靠多个文件顺次写入就声称可靠。

本次检查了 [schema.ts](./packages/skills/seed-interviewing/schema.ts) 与 [idea_model.py](./packages/skills/seed-interviewing/scripts/idea_model.py) 的当前本地内容，以下是目标差异：

| 当前结构 | 建议调整 |
|---|---|
| source 含 proposed/inferred，且禁止 inferred confirmed | origin、derivation、adoption 独立，保留原作者 |
| 维度 status 同时承载候选 | Proposal 独立保存；正式维度不被候选覆盖 |
| round 记录访谈次数 | round 仅作交互信息，不能代替状态或语义版本 |
| 六 gate + weighted readiness | 三个可解释检查面板，明确缺项 |
| evidence 主指最小验证 | 已有观察与验证计划显式分开 |
| 顶层 risks 与 risks 维度 | 风险实体一次维护，维度引用 |
| confidence 为数字 | 改为可空的用户自评，不由模型填默认科学可信度 |
| parent 仅 Idea ID | parentIdeaId + 来源版本，区分分支与修订 |
| 系统事件记录维度状态变化 | 正式快照保存实际内容及决策，能恢复 before/after |
| Paper → Idea 的宽关系 | 增加 Fragment → Statement 的细粒度锚点 |

迁移旧数据时保留旧记录，缺失的消息确认依据、原文锚点和历史内容标记 legacy/unavailable，不能伪造。目标 schemaVersion 2 需要单独迁移和验证。

## 10. Golden Path 验收契约

本例可成为后续固定 fixture，但尚未编写测试或执行完整产品流程。

| 场景 | 应验证的不变量 |
|---|---|
| 输入原始 Seed | 只确认逐字 Seed，其余字段未知 |
| 点击“归因有意思” | 仅记录关注，系统改写的问题仍待确认 |
| 用户采纳 AI 表述 | origin 仍为 agent，增加用户确认依据 |
| 导入 AHE 与 MemoHarness | 同时呈现重叠和 gap_signal，不投票合并 |
| 生成 H1/H2/H3 | 不改变正式 hypothesis 或 method |
| 修改已确认内容 | 新表述需要确认，旧版本保持完整 |
| 采纳语义 Pivot | 新里程碑绑定用户决定与触发材料 |
| 仅修改错别字 | 内部状态更新，不自动生成新语义版本 |
| 重复点击采纳 | 只产生一次正式提交 |
| 旧提案晚到 | 不覆盖新表述，重新评估或标记过期 |
| 文献来源升级 | 旧锚点保留原版本，新判断单独保存 |
| 只找到摘要 | 标记摘要级覆盖，不伪造章节证据 |
| 搜索失败或到达预算 | coverage 为 partial/failed，novelty 不通过 |
| 重启、重建视图 | 用户表述、提案、版本、决定与锚点仍一致 |

完成标准是：用户可以清楚回答“我现在选了什么，哪些还是 AI 候选，哪些文献挑战它，以及我是为什么改变方向的”。

## 11. 引用核查与边界

2026-09-17 已核对用户列出的八个 arXiv 页面标题、版本及摘要；不是全文审计，也不是该方向的系统性文献检索。本文仅采用摘要能支持的机制，未核实的细节不作为正式 Anchor。

| 论文 | 核对结果及用途 |
|---|---|
| [Meta-Harness v1](https://arxiv.org/abs/2603.28052v1) | 自动搜索 harness code，作为宽方向重叠依据 |
| [Self-Harness v3](https://arxiv.org/abs/2606.09498v3) | weakness mining、修改提案、回归验证，作为范围澄清依据 |
| [AHE v4](https://arxiv.org/abs/2604.25850v4) | 编辑可观测性、预测及消融，作为归因相关重叠依据 |
| [HarnessBank v2](https://arxiv.org/abs/2607.13683v2) | 当前标题与材料中的 GSME 不同；摘要支持基因库与 gated screening。材料所述 deterministic significance、WHERE × WHY、sealed-test 等细节本次未核实，不据此给 H3 建正式方法锚点 |
| [MemoHarness v1](https://arxiv.org/abs/2607.14159v1) | 经验适配，摘要明确保留更广泛组件归因，作为 gap_signal |
| [Updating / Benefit v1](https://arxiv.org/abs/2605.30621v1) | 区分生成更新与利用更新，作为候选问题和风险线索 |
| [Harness Tampering v1](https://arxiv.org/abs/2609.00069v1) | 摘要讨论虚假提升与完整性约束，作为风险线索 |
| [Harness Continual Learning v1](https://arxiv.org/abs/2608.19013v1) | 持续适配、遗忘、guarded evolution 与消融，作为进一步近邻比较对象 |

JIT-Agent 未提供对应链接且不影响本结构设计，本次不引用其具体机制。案例中的“连续演化交互归因是未解决问题”仍是候选判断，不能由以上八篇摘要推出。
