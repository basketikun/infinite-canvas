# CoResearch Step 5：Hypothesis Formation / Explanation Formation

- 日期：2026-09-17
- 状态：设计提案；本次不实现页面、Skill、服务或真实文献检索。
- 上游：[Step 4 · Problem Formation](./04-problem-formation.md)。
- 关联：[Step 2 · Research Landscape](./02-research-landscape.md)、[Step 3 · Direction Exploration](./03-direction-focus.md)、[Idea 结构设计](../idea-structure.md)。
- 下游：[Step 6 · Approach / Method Formation](./06-approach-method-formation.md)。
- 产品流程真值：[Research Flow](../research-flow.md)。本步对应 Flow 的 Hypothesis Formation：先解释问题为何发生，再进入 Approach。

## 1. Step 5 解决什么

**在确认的 Research Problem 与任何方法设计之间，插入一层显式的机制解释：用户必须先说明“我认为这个问题为什么会发生”，并把它写成可证伪的假设。**

前四步的分工是：

```text
Step 1 · Seed        我想研究什么
Step 2 · Landscape   这个领域有哪些研究路线
Step 3 · Direction   这条路线从最早到今天怎么发展
Step 4 · Problem     截至当前 frontier，到底有什么具体问题
```

Step 5 回答的是：

> 为什么这个 Problem 会发生？我对背后的机制有什么可证伪的解释？

这一层存在的理由是阻断一种常见退化：从“现有 attribution 不够好”直接跳到“那我设计一个 graph / framework / agent”。一旦跳过机制解释，后续方法就只能用模块数量而不是解释力来论证价值，研究变成 method-first。Step 5 的产物让 Step 6 有一个可回答的问题：**要检验这个机制，需要什么方法**，而不是**我能造什么新框架**。

```text
ConfirmedResearchProblem
      ↓
系统基于 Landscape 轨迹 + Problem claims 提出候选机制解释
      ↓
用户选择 / 改写 / 自行提出机制
      ↓
Core Hypothesis（draft，含 confounder 与 out-of-scope）
      ↓
转写为 Testable Predictions（含反向预期）
      ↓
按 mechanism claim 分别做最近邻文献核查
      ↓
收窄 / 放弃 / 拆分 / 保留并标注未验证
      ↓
确定 Hypothesis Boundary
      ↓
Confirmed Hypothesis Set
```

Step 5 不设计方法，不选择模型结构，不设计完整实验，也不对假设作 novelty verdict。它只保证：解释存在、可被证伪、与 Problem 不同义反复、核心机制 claim 查过最近邻工作。

## 2. 输入与输出

### 2.1 输入

即 Step 4 定义的交接结构：

```ts
interface HypothesisFormationRequest {
  projectId: string
  problemRef: { id: string; revision: number; contentHash: string }
  focusRef: FocusRef
  landscapeRef: LandscapeRef
  claimAssessmentRefs: string[]
  coverageRefs: string[]
  outstandingIssueIds: string[]
  requestId: string
}
```

服务校验 Problem 已 confirmed、hash 匹配、引用可读。Step 5 必须完整读取 Problem 的 claim 拆解、assessment 状态、最近邻比较与 `ProblemScope`，不接受被去掉出处的 summary。

Problem 的 `assessmentSummary` 允许是 `contested` 或 `inconclusive`；这些未确定性继承到 Hypothesis，不因为“现在开始讲机制了”而消失。特别地，Problem 中标为 `unresolved` 的分析单位（例如“效应归于单个 Edit 还是 Edit bundle”）在 Step 5 通常必须被回答——假设要指明机制作用在什么对象上。

### 2.2 输出

```ts
interface ConfirmedHypothesisSet {
  schemaVersion: 1
  id: string
  projectId: string
  problemRef: { id: string; revision: number; contentHash: string }
  landscapeRef: LandscapeRef
  revision: number
  coreStatement: string
  hypotheses: HypothesisRef[]          // 采纳为 core 的机制解释
  confounders: ConfounderRef[]         // 承认存在但不作为研究对象
  rejectedAlternatives: Array<{
    hypothesisId: string
    reason: 'user_declined' | 'substantially_studied'
      | 'not_falsifiable' | 'out_of_scope'
    evidenceRefs: string[]
  }>
  predictionRefs: string[]
  scope: HypothesisScope
  assessmentSummary: 'supported_for_formation' | 'contested' | 'inconclusive'
  remainingUncertainty: string[]
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

`supported_for_formation` 表示“这组解释值得投入检验”，不表示机制已成立，也不表示解释唯一。被放弃的候选必须保留在 `rejectedAlternatives` 中并记录原因：后续 Step 6/7 需要知道哪些解释被主动排除，而不是从未想到。

## 3. 首屏：不要求用户空白想假设

用户很难在空白页上写出机制假设。系统先基于 Step 3 的研究主线与 Step 4 的 Problem claims，提出若干**互相区分的机制解释**，每个解释必须说明：它解释 Problem 的哪一部分、来自哪条证据或推断、如果成立会预期看到什么。

```text
STEP 5 · HYPOTHESIS
Problem：连续多组件 Harness 演化中，单 Edit 评估可能不足以解释 improvement

We know the problem. Now: why might this happen?

H1 · Cross-component interaction        来源：轨迹推断 + Problem claim B
Skills / Tools / Memory 并非独立发挥作用；
一个 Tool edit 是否有效，取决于当前 Skill 是否会调用它、
Memory 是否提供了合适上下文。
[为什么提出这条] [查文献] [采纳] [改写]

H2 · Path dependence                    来源：轨迹推断 + 邻近文献动机
Harness 演化具有路径依赖：即使最终组件集合相同，
A → B → C 与 B → A → C 也可能得到不同结果，
因为后续 edit 建立在当时的 Harness State 上。
[为什么提出这条] [查文献] [采纳] [改写]

H3 · Attribution confounding            来源：邻近文献动机
观察到的 performance gain 不等于 edit quality：
它同时由 edit 本身、当前其他 components、
以及执行 Agent 是否真正利用这个 edit 共同产生。
[为什么提出这条] [查文献] [采纳] [标为 confounder]

[我自己描述机制] [这些都不是我想检验的]
```

用形式化记号表达 H1 有助于后续转写为 prediction：

```text
effect(edit A) ≠ constant
effect(edit A | current harness state)
```

候选生成规则：

1. 候选之间必须**机制不同**，不是同一解释的措辞变体。系统应显式说明两条候选的区分点（不同的 predictions）。
2. 每条候选标注 `origin`：`literature_supported`（已有工作直接给出该机制）、`literature_motivated`（邻近工作使该机制合理但未验证本问题）、`trajectory_inference`（从演化轨迹推断）、`user`。
3. 系统不得把 `literature_motivated` 说成“文献已表明”。例如 HCL 这类工作把 harness 建模为随经验持续变化的外部状态并研究 retention/forgetting，这为“结果依赖历史 harness state”提供了邻近背景，但不等于验证了本项目具体的 path-dependence 假设——H2 只能标为 `literature_motivated`。
4. 至少保留一条**否定候选**：Problem 也可能根本不由复杂机制引起（例如效应可加，只是测量噪声大）。缺少这条，后续 predictions 很容易只设计成支持性证据。

```ts
interface HypothesisCandidate {
  id: string
  sessionId: string
  problemRef: ProblemRef
  title: string
  mechanism: string              // 什么导致什么，作用在哪个对象上
  explains: string[]             // 对应 Problem 的哪些部分 / claim id
  origin: 'user' | 'agent_inference' | 'literature_supported'
    | 'literature_motivated' | 'trajectory_inference'
  sourceRefs: string[]
  distinguishedFrom: Array<{ candidateId: string; distinguishingPrediction: string }>
  role: 'proposed' | 'core' | 'confounder' | 'out_of_scope' | 'rejected'
  status: 'draft' | 'verifying' | 'revising' | 'ready' | 'substantially_studied'
    | 'not_falsifiable' | 'parked'
}
```

## 4. 用户选择与 Core Hypothesis 草稿

假设用户说明：

> 我最感兴趣 H1 + H2。H3 可以当成一个 confounder，但不是我的核心问题。

系统据此整理 core statement，并保留角色划分：

```text
CORE HYPOTHESIS · DRAFT

Harness edits have context-dependent effects:
the contribution of an edit depends both on
the other active harness components
and on the sequence of prior edits
that produced the current harness state.
```

中文表述：

> Harness Edit 的效果不是固定的边际贡献，而具有上下文依赖性：它既取决于当前其他 Harness Components，也取决于此前 edits 形成当前 Harness State 的演化路径。

此时状态仍是：

```text
status = proposed / draft
```

不是 confirmed scientific truth。系统在页面上必须保持这个区分：Step 5 的“确认”只表示“这是我要检验的解释”。

把多条 hypothesis 合成一句 core statement 时，不能让子假设消失。H1 与 H2 各自可被独立证伪，合成语句只是叙述层；`hypotheses` 数组仍分别保存，predictions 也分别绑定。若用户选择的两条机制之间没有共同变量，系统不应强行合并，而应保留两个并列 core hypothesis。

## 5. 把 Hypothesis 变成可证伪

这是 Step 5 最关键的一步。不可接受的假设形态：

> “Harness components 之间存在复杂关系。”

它不可检验：没有任何观测结果会与它冲突。系统必须对每条 core hypothesis 追问：

> **如果这个 Hypothesis 是错的，我们应该观察到什么？**

并把答案写成 prediction。每条 prediction 同时写出 null expectation（假设为假时的预期）与 signal（支持假设的观测）。

### Prediction 1 · Component context

```text
若不存在 component interaction：
effect(Tool edit | Skill A) ≈ effect(Tool edit | Skill B)

若差异显著：支持 context dependence
```

### Prediction 2 · Edit order

```text
若不存在 path dependence：
A → B → C 与 B → A → C
在最终组件集合相同时结果应接近

若最终配置相同但性能明显不同：支持 history dependence
```

### Prediction 3 · Additivity

```text
若 isolated attribution 足够：
sum(individual edit effects) ≈ joint observed effect

若 joint effect ≠ sum(individual effects)：出现 interaction signal
```

```ts
interface TestablePrediction {
  id: string
  hypothesisIds: string[]
  statement: string
  nullExpectation: string        // 假设为假时应观察到什么
  signal: string                 // 什么观测支持假设
  comparisonUnit: string         // 比较什么对象：edit / bundle / harness version
  requiredContrast: string       // 需要构造的对照：同 edit 不同 context 等
  confoundersToControl: string[] // 引用 ConfounderRef
  feasibility: 'appears_testable' | 'needs_design' | 'unclear'
  origin: 'user' | 'agent'
  status: 'draft' | 'accepted'
}
```

`feasibility` 只做粗判：能否原则上构造对照。**如何构造、用什么 benchmark、跑多少 seed 属于 Step 6**，Step 5 不展开实验设计。但如果任何一条 prediction 连原则上的对照都写不出来（`unclear`），这是假设表述太模糊的信号，应退回第 4 节改写，而不是留给 Step 6 消化。

Prediction 还必须通过**同义反复检查**：若把 prediction 的内容抽掉机制词后与 Problem statement 等价，说明假设只是把问题换了说法。例如“单 Edit 评估不足以解释 improvement”本身不是假设，“因为效应依赖 edit 顺序”才是。

## 6. 让 Literature 来攻击 Hypothesis

确定 predictions 后，仍不进入 Method，而是先问：

> 已有研究是否已经验证过同样的机制？

### 6.1 拆成 mechanism claims 分别检索

沿用 Step 4 的做法：不搜索整个长句，把 hypothesis 拆成 3–5 条核心 claim，每条用多种表达分别检索。

```text
Claim H1  Harness edit effects depend on other components.
Claim H2  Harness edit effects depend on edit history.
Claim H3  Joint effect differs from sum of isolated effects.
```

查询表达示例：

```text
harness component interaction
history dependent harness evolution
sequential edit effect
path dependence self improving agents
interaction attribution agent harness
```

```ts
interface HypothesisProbe {
  id: string
  candidateId: string
  claimIds: string[]
  landscapeRef: LandscapeRef
  asOf: string
  queryPlan: Array<{ query: string; rationale: string; framing: 'direct_term'
    | 'mechanism_paraphrase' | 'adjacent_field' | 'recent_window' }>
  budget: ProbeBudget
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  coverageId: string | null
  resultId: string | null
}
```

Step 5 的检索与 Step 4 有一处关键差别：**机制常常在别的领域被研究过**。顺序效应、交互效应、路径依赖在实验设计、因果推断、组合优化、软件配置研究中都有成熟处理。这类结果应以 `adjacent_field` 标注纳入，它可能直接提供检验手段（对 Step 6 有用），但不能被当作本领域的 prior work 用来宣称问题已解决或未解决。

### 6.2 假设已被直接研究

```text
H1 · Cross-component interaction

Status
🟡 PARTIALLY / DIRECTLY STUDIED

Closest work
<Work, Version, 具体机制与实验条件>

Your current formulation overlaps on
<哪些范围被覆盖>

Remaining distinction
<还剩什么没有被这项工作回答>

[缩窄假设] [放弃 H1] [继续查 H2] [保留并记录重叠]
```

系统不得通过替换术语保住原假设。可接受的动作只有：显式收窄（并记录 `narrowedFrom`）、放弃（写入 `rejectedAlternatives`）、或保留但标注重叠。若用户选择收窄，predictions 必须同步重写——旧 prediction 可能已被已有工作回答。

### 6.3 未找到直接工作

```text
H2 · Path dependence

Current search
No direct match identified.

Closest neighboring work
<邻近工作及其覆盖范围>

Status
NEEDS FURTHER VERIFICATION
This is not proof of novelty.
```

与 Step 4 保持同一克制：允许 `no_direct_match_in_search`，禁止显示 “novel hypothesis” 或 “gap confirmed”。

### 6.4 文献与假设冲突

若检索到直接反证（例如有工作报告 edit 顺序不影响最终性能），系统不得隐藏。处理方式：展示反证的适用条件（任务、规模、harness 类型），让用户判断本项目设置是否落在其外。若落在其内，假设应被放弃或重述为“在何种条件下反证不成立”；后者是一个新的、更窄的假设，需重新走第 5 节。

```ts
interface HypothesisClaimAssessment {
  id: string
  claimId: string
  asOf: string
  checkedAt: string
  status: 'directly_studied' | 'partially_studied' | 'contradicted'
    | 'no_direct_match_in_search' | 'needs_verification' | 'inconclusive'
  evidenceRefs: string[]
  closestWorkComparisons: Array<{
    workId: string
    overlap: string
    difference: string
    comparisonEvidenceRefs: string[]
  }>
  coverageId: string
  rationale: string
  remainingUncertainty: string
}
```

## 7. Hypothesis Boundary

最后一问，防止假设无限扩张：

```text
这个 Hypothesis 暂时不解释哪些东西？
```

```text
Include
✓ cross-component interaction
✓ sequential edit history
✓ state dependence

Treat as confounder
~ beneficiary utilization
~ execution stochasticity

Out of scope
× forgetting
× tampering
× base-model training
```

```ts
interface HypothesisScope {
  included: ScopeItem[]
  confounders: Array<ScopeItem & {
    handling: 'measure' | 'hold_fixed' | 'acknowledge_only'
  }>
  excluded: ScopeItem[]
  unresolved: ScopeItem[]
  mechanismUnit: string          // 机制作用的对象：edit / bundle / state transition
  outcomeVariable: string | null // 机制影响什么可观测量
}
```

三层语义与 Step 4 的 `ProblemScope` 一致，但新增 `confounders`：它们是**承认会影响观测、但本假设不解释**的因素。H3（utilization）正属于此类——“Harness Updating Is Not Harness Benefit”一类工作指出“能生成有用 harness update”与“下游 agent 能真正从该 harness 获益”不是同一种能力，因此 utilization 确实可能混杂归因。把它记为 confounder 且 `handling` 明确，意味着 Step 6 必须处理它，而不是忽略它。

`mechanismUnit` 必须在 Step 5 结束前确定。若 Step 4 把分析单位留作 `unresolved`，Step 5 需要在此关闭；仍无法确定时，`assessmentSummary` 不能是 `supported_for_formation`。

## 8. 最终 Step 5 页面

```text
┌─────────────────────────────────────────────────────┐
│ STEP 5 · HYPOTHESIS                                 │
│                                                     │
│ Problem                                             │
│ Individual edit evaluation may not explain          │
│ continual multi-component harness evolution.        │
├─────────────────────────────────────────────────────┤
│ CURRENT HYPOTHESIS                     draft        │
│                                                     │
│ The effect of a harness edit is context-dependent:  │
│ ① it depends on other active components             │
│ ② it depends on the sequence of prior edits         │
│                                                     │
│ [Edit]                                              │
├─────────────────────────────────────────────────────┤
│ TESTABLE PREDICTIONS                                │
│                                                     │
│ P1  Same edit, different component context          │
│     → different effect                              │
│ P2  Same final components, different edit order     │
│     → different outcome                             │
│ P3  Joint effect ≠ sum of isolated effects          │
├─────────────────────────────────────────────────────┤
│ LITERATURE CHECK                                    │
│                                                     │
│ Cross-component interaction   ◐ partial / checking  │
│ History dependence            ○ no direct match yet │
│ Additive attribution          ○ checking            │
│                                                     │
│ [View Sources] [Search Deeper]                      │
├─────────────────────────────────────────────────────┤
│ SCOPE                                               │
│ Core         interaction · history dependence       │
│ Confounders  utilization · stochasticity            │
│ Out of scope forgetting · tampering · training      │
├─────────────────────────────────────────────────────┤
│ ALTERNATIVES CONSIDERED                             │
│ H3 attribution confounding → kept as confounder     │
│ H0 effects are additive, noise only → to be tested  │
├─────────────────────────────────────────────────────┤
│ [Ask Literature] [Edit] [Confirm Hypothesis]        │
└─────────────────────────────────────────────────────┘
```

页面固定显示三件事：状态是 draft 而非事实、每条 claim 的独立检索状态、以及被考虑过的其他解释。`◐ / ○` 不得聚合成单一“已验证”标记。

## 9. 用户确认规则

| 操作 | 含义 |
|---|---|
| 选择候选 Hypothesis | 表达兴趣，不确认解释成立 |
| 采纳为 core | 写入 draft，状态仍为 proposed |
| 标为 confounder | 承认其影响，交由 Step 6 控制 |
| 接受 prediction | 认可这是自己愿意接受的证伪条件 |
| 运行 HypothesisProbe | 核查机制 claim，不代表用户立场 |
| 编辑 scope | 更新 revision |
| 点击 Confirm Hypothesis | 确认当前 contentHash |

确认只表示“这是我真正想检验的解释”。它不表示机制成立、不表示解释唯一、不表示 novelty 已证明。确认后编辑创建新 draft revision；新增 core hypothesis、扩大 included 范围或改写 prediction 时旧确认不能沿用。

## 10. 完成 Gate

Step 5 完成需要：

```text
✓ Hypothesis 明确解释 Problem
✓ 不是同义反复 Problem
✓ 至少有一个可证伪 prediction（含 null expectation）
✓ 核心 mechanism claims 做过 closest-work search
✓ 考虑过至少一条替代解释，并记录取舍原因
✓ mechanismUnit 与 confounder handling 已确定
✓ 用户确认这是自己真正想检验的解释
```

仍**不要求**：

```text
✗ 已经设计方法
✗ 已经决定模型结构
✗ 已经设计完整实验
✗ 已经证明 novelty
```

允许 `no_direct_match_in_search`、`contested`、`inconclusive` 的 Hypothesis 进入 Step 6，未确定性随交接保留。若核心机制被判定为 `directly_studied` 且用户不愿收窄，原假设不能直接确认；用户需收窄、换一条候选、或显式保存为“复现/扩展既有机制”的假设。

## 11. Step 5 → Step 6 交接

```ts
interface MethodFormationRequest {
  projectId: string
  hypothesisSetRef: { id: string; revision: number; contentHash: string }
  problemRef: ProblemRef
  landscapeRef: LandscapeRef
  predictionRefs: string[]
  confounderRefs: string[]
  claimAssessmentRefs: string[]
  coverageRefs: string[]
  outstandingIssueIds: string[]
  requestId: string
}
```

Step 6 问的是：

> 为了检验这个 Hypothesis，我们需要怎样的 Research Approach / Method？

而不是“我能造什么新框架”。交接把 predictions 与 confounders 一并传下去：方法的合格标准是**能产生区分 prediction 真假的观测**，并处理已记录的 confounder；模块数量不构成理由。Step 6 也不得把 Step 5 的 `no_direct_match_in_search` 改写为 confirmed novelty。

完整链条：

```text
1 Seed → 2 Landscape → 3 Direction Trajectory → 4 Problem → 5 Hypothesis → 6 Approach / Method
```

Step 5 是 Problem 与 Method 之间的桥：先决定“我相信什么机制值得检验”，再决定“我该造什么东西来检验它”。

## 12. 状态、版本与存储

```ts
interface HypothesisFormationSession {
  id: string
  projectId: string
  problemRef: ProblemRef
  landscapeRef: LandscapeRef
  status: 'proposing' | 'selecting' | 'predicting' | 'verifying'
    | 'revising' | 'hypothesis_ready' | 'hypothesis_confirmed' | 'parked'
  candidateIds: string[]
  coreCandidateIds: string[]
  predictionIds: string[]
  probeIds: string[]
  confirmedHypothesisSetId: string | null
  createdAt: string
  updatedAt: string
}
```

目标目录：

```text
research/hypotheses/<hypothesis-set-id>/
├── manifest.json
├── drafts/<revision>.json
├── confirmed/<revision>.json
├── candidates/<candidate-id>.json
├── predictions/<prediction-id>.json
├── assessments/<assessment-id>.json
├── decisions/<decision-id>.json
└── views/<revision>/hypothesis.md

research/hypothesis-formation/<session-id>/
├── state.json
└── probes/<probe-id>.json
```

Work、Version、Fragment 与文献 Question 仍由 Research Wiki 持有；Hypothesis 引用它们，不复制第二份可编辑事实。Hypothesis、prediction、取舍决定与确认属于用户研究状态；运行 trace 属于 `.coresearch/`；页面是可重建投影。确认走不可变快照、contentHash 与 requestId 幂等；Probe 完成与投影生成使用可恢复提交协议，投影失败不丢失 Hypothesis 或 Assessment。

## 13. Skill 与服务边界

未来的 hypothesis-formation Skill 可协调：

- propose_mechanisms：基于 Problem claims 与 Landscape 轨迹生成互相区分的候选解释。
- select_hypotheses：记录用户对 core / confounder / out-of-scope 的划分。
- derive_predictions：把假设转写为带 null expectation 的 prediction。
- check_falsifiability：同义反复检查与不可证伪表述检测。
- decompose_mechanism_claims：拆出最少必要的机制 claim。
- probe_hypothesis_claim：发起最近邻检索。
- revise_hypothesis：根据评估生成可审阅修改。
- confirm_hypothesis：由领域服务校验用户动作后提交。

Searcher、Resolver、Reader 与 temporal verification 复用 Step 2 服务。Agent 负责提案与解释；服务负责版本、校验、幂等与提交；用户负责确认自己要检验什么。

## 14. Golden Path 示例

以下为合成示例，不表示当前用户已确认该假设，也不表示示例工作的覆盖已被本次验证。

```text
Confirmed Problem
连续多组件 Harness 演化中，单 Edit 评估是否足以解释 improvement

→ 系统提出 H1 交互 / H2 路径依赖 / H3 归因混杂 / H0 可加且仅有噪声

→ 用户选 H1 + H2 为 core，H3 记为 confounder，H0 保留为待检验对立面

→ Core Hypothesis（draft）
   edit 的贡献依赖其他活跃组件与此前 edit 序列

→ Predictions
   P1 同 edit 不同组件上下文 → 效应不同
   P2 最终组件相同、顺序不同 → 结果不同
   P3 joint effect ≠ sum of isolated effects

→ 按 claim 分别检索
   H1 部分/直接被研究 → 收窄或记录重叠
   H2 未直接命中 → no_direct_match_in_search
   H3 已有工作指出 utilization 与 update quality 不同 → 记为 confounder

→ 确定 boundary 与 mechanismUnit

→ Confirmed Hypothesis Set

→ Step 6 设计能区分 P1/P2/P3 的 Approach
```

## 15. 验收场景

| 场景 | 应满足的不变量 |
|---|---|
| 系统提出候选机制 | 每条标注 origin，literature_motivated 不写成“文献已表明” |
| 两条候选措辞不同但机制相同 | 合并或标出区分性 prediction，不并列展示 |
| 用户提出的假设不可证伪 | 阻止进入 Gate，要求写出 null expectation |
| 假设与 Problem 同义反复 | 同义反复检查触发，退回改写 |
| 用户只选支持性 prediction | 保留至少一条对立解释（如 H0 可加性） |
| 核心机制已被直接研究 | 展示重叠与剩余差异，原假设不直接确认 |
| 检索到直接反证 | 展示反证适用条件，不隐藏；收窄需重走 prediction |
| 机制检索未命中 | no_direct_match_in_search，不写“novel hypothesis” |
| 邻近领域有成熟顺序效应方法 | 标 adjacent_field，可供 Step 6 借用，不当作本领域 prior work |
| 用户标 H3 为 confounder | 写入 scope.confounders 并指定 handling，Step 6 必须处理 |
| Step 4 的 unresolved 分析单位 | Step 5 关闭 mechanismUnit，否则不得进入 Gate |
| 关键来源限流 | needs_verification / partial，显示失败来源 |
| 确认后新增 core hypothesis | 旧确认失效，创建新 draft revision |
| 重复确认 | 只产生一个 confirmed 快照 |
| Step 6 接收 | 同时得到 predictions、confounders、assessment 与未决项 |

完成标准：用户能说清“我认为问题为什么发生、什么观测会推翻这个解释、这个机制别人查过没有、以及它暂时不解释什么”。

## 16. 与现有设计的衔接

本文实现 [Step 4](./04-problem-formation.md) 定义的 `HypothesisFormationRequest`，把 Problem 的 claim 拆解与未确定性转化为机制解释与可证伪 prediction，并定义 `MethodFormationRequest` 供 Step 6 实现。

它也细化 [Idea 结构设计](../idea-structure.md) 中 problem 与 why_unsolved 之外的一层：Step 4 保存“不足在哪”，Step 5 保存“为什么会不足”以及“怎样才算说错了”。后续 Idea 引用 `ConfirmedHypothesisSet`，不复制一份独立可编辑的 hypothesis 真值。

## 17. 参考与使用边界

主要依据是用户此次提供的 Step 5 流程，保留“候选机制 → 用户选择 → 可证伪 predictions → 文献攻击 → boundary → 确认”的主线，并补充候选生成规则、prediction 结构、评估状态、失败路径、版本与交接契约。

本地 [ARIS novelty-check](../../../references/Auto-claude-code-research-in-sleep/skills/novelty-check/SKILL.md) 把提案拆成核心技术 claims 并逐项检索最近邻工作；本文只借鉴 claim 分解与多表达检索，Step 5 不执行其 novelty verdict、评分或自动推进。[research-refine](../../../references/Auto-claude-code-research-in-sleep/skills/research-refine/SKILL.md) 强调冻结 Problem Anchor、偏好最小充分机制、拒绝用模块数量论证贡献，这与本步骤“方法围绕已锚定的机制展开”的立场一致；但该 Skill 的迭代评分循环不属于 Step 5。[kill-argument](../../../references/Auto-claude-code-research-in-sleep/skills/kill-argument/SKILL.md) 的对抗式审阅可作为第 6.4 节反证处理的未来参考，其论文级 accept/reject 判定不在本步骤范围内。

ARIS 的整体流程更偏 `landscape → idea generation → novelty check → refinement`；CoResearch 在此之间显式插入 Problem 与 Hypothesis 两步，使 Method 只能围绕已确认的机制解释设计。

本文没有验证任何领域结论，也没有执行 harness 领域检索。AHE、GSME、HCL、“Harness Updating Is Not Harness Benefit”等名称与机制描述只能在真实 Step 2/4/5 取得版本化原文证据后进入产品状态。
