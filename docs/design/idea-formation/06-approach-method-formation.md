# CoResearch Step 6：Approach / Method Formation

- 日期：2026-09-18
- 状态：设计提案；本次不实现页面、Skill、服务、方法代码或真实文献检索。
- 上游：[Step 5 · Hypothesis Formation](./05-hypothesis-formation.md)。
- 关联：[Step 4 · Problem Formation](./04-problem-formation.md)、[Step 2 · Research Landscape](./02-research-landscape.md)、[Idea 结构设计](../idea-structure.md)。
- 下游：[Step 7 · Research Design](./07-research-design.md)。
- 产品流程真值：[Research Flow](../research-flow.md)。Flow 把 Approach Selection 与 Method & Evaluation Co-Design 拆开：本文前半对应 Approach，方法组成与评价对齐归 [07-research-design.md](./07-research-design.md)。

## 1. Step 6 解决什么

**把用户确认的机制假设与可证伪 predictions，转化为一个最小、可实现、能够区分假设成立与否的 Research Approach / Method。**

前五步已经回答：

```text
Step 1 · Seed        我想研究什么
Step 2 · Landscape   这个领域有哪些研究路线
Step 3 · Direction   我真正想继续走哪条路线
Step 4 · Problem     当前 frontier 上有什么具体困难
Step 5 · Hypothesis  我认为这个困难为什么发生，什么观测会推翻解释
```

Step 6 回答：

> 为了检验这个 Hypothesis，我应该用什么最小机制获得有区分力的观测？

它不回答“我能造一个多复杂的系统”，也不提前决定完整 benchmark、运行预算和论文实验表。方法的价值来自它能否检验核心 prediction、处理已知 confounder，并相对现有方法形成可核查的技术差异；模块数量不构成理由。

```text
ConfirmedHypothesisSet
      ↓
从 predictions / confounders 推导 Method Requirements
      ↓
生成并比较不同 Approach Families
      ↓
用户选择主路线、oracle / supporting role 或退回修改假设
      ↓
具体化最小对象、操作与观测
      ↓
Prediction-to-Method Coverage Check
      ↓
Method-level Closest-work Probe
      ↓
删除无法追溯到 requirement 的复杂度
      ↓
Method Thesis + Confirmed Method
```

Step 6 设计的是**取得证据的机制**；Step 7 继续把它组织为 Method、Closest Methods、Claims、Evaluation 与 Baselines。具体 benchmark、样本规模、metric、预算和 run order 属于后续 Evidence Plan。

## 2. 输入、前置条件与输出

### 2.1 输入

直接实现 Step 5 定义的交接：

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

type VersionedRef = {
  id: string
  revision: number
  contentHash: string
}
```

服务必须读取确认版本的 Problem、Hypothesis、predictions、null expectations、confounder handling、closest-work assessment 与剩余不确定性。只传一段“假设摘要”是不够的，因为方法覆盖检查需要逐条 prediction 与对立解释。

允许 `contested` 或 `inconclusive` 的 Hypothesis 进入 Step 6。对应不确定性必须继承到 Method，不因用户开始设计技术路线而自动消失。

### 2.2 前置条件

进入 Step 6 至少满足：

```text
✓ Problem 已确认
✓ Hypothesis Set 已确认
✓ 至少一条 core prediction 含 null expectation
✓ mechanismUnit 已明确
✓ confounder 有处理意图
```

如果 prediction 连可比较的观测都无法表达，退回 Step 5；Step 6 不用复杂方法掩盖不可证伪的假设。

### 2.3 输出

```ts
interface ConfirmedResearchMethod {
  schemaVersion: 1
  id: string
  projectId: string
  problemRef: VersionedRef
  hypothesisSetRef: VersionedRef
  landscapeRef: LandscapeRef
  revision: number
  title: string
  thesis: string
  primaryApproachRef: ApproachRef
  supportingApproaches: Array<{
    approachRef: ApproachRef
    role: 'oracle' | 'baseline' | 'validation_aid' | 'fallback'
  }>
  requirementRefs: string[]
  objectRefs: string[]
  operationRefs: string[]
  componentRefs: string[]
  predictionCoverageRefs: string[]
  confounderHandlingRefs: string[]
  feasibilityAssessmentRef: string
  closestWorkAssessmentRefs: string[]
  rejectedComplexity: RejectedComponent[]
  methodBoundary: MethodBoundary
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

这里的 `confirmed` 只表示“用户确认用这条技术路线继续形成证据计划”。它不表示方法有效、方法新颖、因果识别成立或实验会成功。

## 3. 区分 Approach、Method 与 Method Thesis

三个对象不能混成一段自然语言：

| 对象 | 回答的问题 | 示例 |
|---|---|---|
| Approach Family | 用哪类策略检验假设 | Edit Lineage + Targeted Replay |
| Method Specification | 具体记录什么、控制什么、执行什么、观察什么 | 保存 parent state，对高不确定 edit context 做 replay |
| Method Thesis | 一句话说明核心机制与预期能力 | 用 typed lineage 与 selective replay 估计 history-dependent interaction |

用户先比较 Approach，再共同具体化 Method。系统不能把自己最先生成的实现方案直接写成已选方法；Method Thesis 也不能把待验证效果写成结果，例如“准确识别所有交互”或“显著降低成本”。

## 4. 从 Prediction 推导最小 Requirements

系统先问：**为了让每条 prediction 有可区分的观测，最少需要记录和控制什么？**

以 Step 5 的示例为例：

```text
P1  同一个 edit 在不同 component context 下效果不同
P2  最终组件集合相同，但 edit 顺序不同，outcome 可能不同
P3  joint effect 不等于 isolated effects 的简单相加
```

可推导出：

```text
R1 记录每次 Harness Edit
R2 标明 Edit 修改的 component
R3 保存 Edit 发生前的 Harness State
R4 能在可比较条件下重放相同 task
R5 能构造不同 edit order / combination
R6 能观测 outcome 与运行变异
R7 隔离或测量已确认的 utilization confounder
```

```ts
interface MethodRequirement {
  id: string
  source: {
    predictionIds: string[]
    confounderIds: string[]
    problemClaimIds: string[]
  }
  statement: string
  kind: 'observe' | 'control' | 'intervene' | 'compare' | 'measure'
    | 'confounder_handling' | 'feasibility'
  necessity: 'required' | 'supporting'
  rationale: string
  verificationStatus: 'derived' | 'user_edited' | 'confirmed'
}
```

Requirement 是从上游推导的设计约束，不是组件愿望清单。若无法指出来源 prediction 或 confounder，默认不进入 V1。

## 5. 候选 Approach Families

系统提出 2–4 条机制上不同的路线。候选需要覆盖同一组核心 predictions，才能进行公平比较；无法覆盖的候选必须显示缺口。

### 5.1 A · Full Factorial Replay

```text
枚举 Edit combinations
+
枚举 Edit orders
+
重复运行并比较 outcome
```

- 优势：对小规模问题解释直接，可作为近似 gold-standard。
- 限制：组合与顺序快速增长，成本高，难以直接扩展。
- 合适角色：small-scale oracle、验证基准或早期可行性检查。

### 5.2 B · Edit Lineage + Targeted Counterfactual Replay

```text
记录 Edit → Parent State → New State 的 lineage
+
定位高不确定或高影响的 context / pair / sequence
+
只对这些位置构造 targeted replay
```

- 优势：保留 component context 与历史路径，直接对应 H1/H2。
- 限制：需要定义选择 replay 的准则；若状态不可重建，反事实比较会失效。
- 合适角色：主方法候选。

### 5.3 C · Learned Interaction Estimator

```text
state + edit + context → predicted effect
```

- 优势：可利用大量历史 runs，可能降低显式 replay 数量。
- 限制：预测准确不等于归因有效；模型也可能只学习 task、agent 或 evaluator 偏差。
- 合适角色：在数据与识别条件充分时的扩展，不默认进入 V1。

### 5.4 D · Bundle-level Attribution

```text
failure pattern → edit bundle → outcome
```

- 优势：与实际修复决策的单位一致，避免强行分配单组件 credit。
- 限制：如果核心问题正是 component interaction，它可能改变分析单位，从而绕开 Problem。
- 合适角色：替代问题表述，或在用户确认 mechanismUnit 为 bundle 时作为主路线。

这些路线是**不同策略**，不要求角色上完全互斥。一个方案可以选择 B 为 primary、A 为 oracle；但系统必须明确各自角色，不能把多个完整方法堆成一个“更丰富”的贡献。

```ts
interface ApproachCandidate {
  id: string
  sessionId: string
  name: string
  strategy: string
  requiredCapabilities: string[]
  coverage: Array<{ predictionId: string; status: 'full' | 'partial' | 'none' }>
  confounderHandling: Array<{ confounderId: string; status: 'controlled' | 'measured' | 'unhandled' }>
  assumptions: string[]
  strengths: string[]
  limitations: string[]
  estimatedComplexity: 'low' | 'medium' | 'high' | 'unknown'
  proposedRole: 'primary' | 'oracle' | 'baseline' | 'fallback'
  origin: 'user' | 'agent_proposal' | 'literature_adapted'
  sourceRefs: string[]
  status: 'proposed' | 'selected' | 'rejected' | 'parked'
}
```

`estimatedComplexity` 是形成阶段的相对判断，不是 Step 7 的计算预算。

## 6. 用户选择的是检验机制，不是模型品牌

推荐交互：

```text
PRIMARY APPROACH
Edit Lineage + Targeted Counterfactual Replay

SUPPORTING ROLE
Small-scale Full Factorial Replay · oracle

REJECTED FOR V1
Learned Interaction Estimator · 归因解释过弱且增加模型依赖
Bundle-level Attribution · 改变了当前 component-interaction 问题
```

用户可以选择、组合明确角色、改写、提出自己的路线，或退回 Step 5。若用户选择的路线无法覆盖 core prediction，系统展示缺口并阻止确认，但允许保存为 draft。

## 7. 将 Approach 具体化为最小 Method

### 7.1 核心对象

```ts
interface EditEvent {
  editId: string
  componentType: 'skill' | 'tool' | 'memory' | 'control' | 'other'
  parentStateId: string
  resultingStateId: string
  changeDescription: string
  trigger: string
  timestamp: string
  observedOutcomeRef: string | null
}

interface HarnessState {
  stateId: string
  parentStateIds: string[]
  activeSkillsRef: string
  activeToolsRef: string
  memoryStateRef: string
  controlConfigurationRef: string
  environmentRef: string
  contentHash: string
}

interface ReplayQuery {
  id: string
  targetEditIds: string[]
  sourceStateId: string
  comparisonStateIds: string[]
  counterfactualSequences: string[][]
  taskSetRef: string
  controlledFactors: string[]
  measuredFactors: string[]
  expectedObservationRefs: string[]
}
```

对象必须足以重建一次比较。只记录“改了 memory，分数提高 3%”无法检验路径依赖，因为 parent state、task、执行条件与替代顺序都丢失了。

### 7.2 操作与组件

```ts
interface MethodOperation {
  id: string
  name: string
  inputObjectRefs: string[]
  outputObjectRefs: string[]
  servesRequirementIds: string[]
  servesPredictionIds: string[]
  assumptions: string[]
}

interface MethodComponent {
  id: string
  name: string
  responsibility: string
  requirementIds: string[]
  predictionIds: string[]
  necessityArgument: string
  removableImpact: string
  status: 'required' | 'supporting' | 'deferred' | 'rejected'
}
```

示例最小流水线：

```text
Capture Edit + State
      ↓
Build Typed Edit Lineage
      ↓
Select Uncertain Context / Sequence
      ↓
Construct Replay Query
      ↓
Execute Comparable Replays
      ↓
Estimate Main / Interaction / History Effects
```

“估计”在这里是方法操作，不是已证实的识别能力。它依赖的可交换性、状态重建、随机性与测量条件必须写进 assumptions，并在 Step 7 形成证据计划。

## 8. Prediction-to-Method Coverage Gate

每条核心 prediction 都要绑定 intervention、contrast 与 observation：

| Prediction | Method action | Contrast | 可区分观测 |
|---|---|---|---|
| P1：同一 edit 在不同 context 下效果不同 | 在多个可重建 Harness State 上 replay 同一 edit | `effect(e | s1)` vs `effect(e | s2)` | context-conditioned effect difference |
| P2：顺序改变 outcome | 比较 `A→B` 与 `B→A`，控制最终组件集合 | 两条 sequence | order-dependent outcome difference |
| P3：joint effect 非简单相加 | 执行 isolated 与 joint replay | `effect(A,B)` vs `effect(A)+effect(B)` | interaction residual |

```ts
interface PredictionMethodCoverage {
  id: string
  predictionId: string
  requirementIds: string[]
  operationIds: string[]
  intervention: string
  contrast: string
  observation: string
  nullObservation: string
  confounderHandlingRefs: string[]
  status: 'covered' | 'partially_covered' | 'uncovered' | 'infeasible'
  limitations: string[]
}
```

Gate 规则：

1. 任一 core prediction 为 `uncovered`，当前方法不能确认。
2. `partially_covered` 只有在缺口被写入 `remainingUncertainty`，且不影响 dominant claim 时才允许继续。
3. `infeasible` 通常触发修改 Method、收窄 Hypothesis，或退回 Step 5。
4. 只产生支持性观测、不保留 null / rival contrast 的设计不通过。

## 9. Confounder Handling

Step 5 传入的 confounder 不能在 Step 6 消失。每个 confounder必须选择处理方式：

```ts
interface ConfounderHandlingPlan {
  id: string
  confounderId: string
  strategy: 'control' | 'measure' | 'stratify' | 'sensitivity_analysis'
    | 'explicitly_out_of_scope'
  implementation: string
  residualRisk: string
  affectsPredictionIds: string[]
}
```

例如 utilization confounder 可以通过固定执行 Agent、记录 component invocation、或分层比较“update quality”与“realized benefit”处理。具体指标、样本规模与敏感性分析属于 Step 7；Step 6 只要求技术路线具备处理入口，并明确残余风险。

## 10. 可行性检查

方法进入 closest-work probe 前先做最小可行性检查：

```text
State capture       能否完整快照并恢复 Harness State？
Intervention        能否在不改变其他关键因素时替换 Edit / 顺序？
Replay comparability 相同 task 与环境能否合理复现？
Stochasticity       能否观测并重复随机执行，而不是把单次差异当效应？
Measurement         Outcome 是否可读取，是否受 verifier / tampering 影响？
Cost envelope       小规模 oracle 与主方法是否原则上可运行？
```

```ts
interface MethodFeasibilityAssessment {
  id: string
  checks: Array<{
    dimension: string
    status: 'feasible' | 'partially_feasible' | 'unknown' | 'blocked'
    evidenceRefs: string[]
    limitation: string | null
  }>
  summary: 'feasible_for_planning' | 'conditional' | 'blocked'
}
```

`feasible_for_planning` 只允许进入 Step 7，不等于实现已经完成。若快照不可恢复或 replay 不可比较，而方法核心依赖反事实回放，必须标 `blocked`，不能靠措辞绕过。

## 11. Method-level Closest-work Probe

Problem 与 Hypothesis 查过文献，不代表方法设计没有直接先例。此处围绕核心操作而非营销名称检索：

```text
edit lineage + agent harness
targeted counterfactual replay + agent adaptation
sequential intervention attribution + evolving systems
history-dependent component interaction estimation
```

邻近领域的方法也应纳入，因为它们可能已经解决 sequence、interaction 或 attribution 的技术核心。

```ts
interface MethodClaim {
  id: string
  statement: string
  type: 'representation' | 'selection' | 'intervention' | 'estimation'
    | 'efficiency' | 'integration'
  operationRefs: string[]
}

interface MethodClosestWorkAssessment {
  id: string
  methodClaimId: string
  status: 'direct_match' | 'partial_overlap' | 'adjacent_method'
    | 'no_direct_match_in_search' | 'inconclusive' | 'not_checked'
  closestWorkRefs: string[]
  overlap: string
  remainingDifference: string
  coverageRef: string
  checkedAt: string
}
```

处理规则：

- `direct_match`：展示重叠；收窄、改为复现/扩展、换方法或退回上游。
- `partial_overlap`：把差异绑定到具体 MethodClaim，不使用“整体方法不同”。
- `adjacent_method`：说明需要适配什么，以及适配本身是否构成研究贡献仍待验证。
- `no_direct_match_in_search`：只能表示本次检索未命中，不能改写成“novel method”。
- `inconclusive`：保留未确定性并限制 Method Thesis 的表述。

Step 6 不执行完整论文 positioning，也不宣布 novelty。它只保证用户没有在明显的最近邻方法面前盲目继续。

## 12. Simplicity Gate

每个模块都必须回答：

```text
它服务哪条 requirement？
它检验哪条 prediction？
删掉它会损失哪种必要观测？
已有组件能否承担同一职责？
```

无法回答则删除或延后。

```ts
interface RejectedComponent {
  name: string
  proposedPurpose: string
  decision: 'rejected' | 'deferred' | 'merged'
  reason: 'no_prediction_link' | 'duplicate_responsibility' | 'premature_optimization'
    | 'weakens_identifiability' | 'outside_scope' | 'excess_cost'
  reconsiderWhen: string | null
}
```

示例：

```text
× Critic Agent            未增加 P1/P2/P3 的可区分观测
× Separate Memory Bank    与现有 lineage storage 职责重复
× Graph Neural Network    在 V1 中只增加 estimator，尚无必要性证据
× Meta-Optimizer          属于自动搜索扩展，不是检验当前 Hypothesis 的条件
```

Simplicity Gate 不是要求方法永远简单，而是要求复杂度由 evidence need 驱动。若某个 learned estimator 确实是规模化检验 P2 的唯一可行路径，它可以保留，但必须记录必要性与识别风险。

## 13. 形成 Method Thesis 与 Boundary

推荐模板：

```text
We [core operation] over [research object]
to test / estimate [mechanism-level target]
under [scope / constraint],
while avoiding or controlling [main limitation].
```

示例：

> We represent harness evolution as a typed edit lineage and selectively replay high-uncertainty edit contexts to estimate history-dependent and interaction effects without exhaustive combinatorial evaluation.

中文：

> 将 Harness 演化表示为类型化 Edit Lineage，并对高不确定性的 Edit Context 进行定向 Counterfactual Replay，以在不进行完整组合枚举的情况下估计历史依赖与交互效应。

“without exhaustive combinatorial evaluation” 是设计目标，不应在实验前写成已实现的效率结论。

```ts
interface MethodBoundary {
  targets: string[]
  supportsClaims: string[]
  doesNotClaim: string[]
  assumptions: string[]
  deferredExtensions: string[]
}
```

本例可以明确：

```text
targets
• Edit-level history dependence
• pair / small-set component interaction

doesNotClaim
• 完整恢复真实因果图
• 对任意大规模 Edit 集合做无偏归因
• 自动生成最优 Harness
• 已证明比所有 attribution 方法更高效
```

## 14. 最终 Step 6 页面

```text
STEP 6 · APPROACH / METHOD

Problem
────────────────────────────────────────
Isolated attribution may not explain sequential interaction.

Hypothesis
────────────────────────────────────────
Edit effects depend on component context and prior edit history.

Predictions                  Coverage
P1 context dependence       ● covered
P2 order dependence         ● covered
P3 non-additive joint effect ● covered

Candidate approaches
────────────────────────────────────────
A Full factorial replay
  ✓ strong small-scale oracle
  ✗ combinatorial cost

B Edit lineage + targeted replay
  ✓ preserves state and history
  ✓ covers P1 / P2 / P3
  △ replay selection still needs validation

C Learned estimator
  ✓ scalable candidate
  ✗ predictive fit may not identify attribution

Selected
────────────────────────────────────────
B · primary
A · validation oracle

Method thesis
────────────────────────────────────────
Typed edit lineage + selective replay for history-dependent
interaction estimation.

Simplicity gate
────────────────────────────────────────
× Critic Agent   × GNN   × Meta-Optimizer

Closest-work status
────────────────────────────────────────
● partial overlaps found
◐ differentiation still under verification

[View prediction mapping] [Compare approaches]
[Edit method] [Confirm approach]
```

“Confirm approach” 是显式用户动作。AI 可以提出、比较和建议，不能自动提交用户的技术路线。

## 15. 完成 Gate 与失败路径

Step 6 完成需要：

```text
✓ Method 直接对应 Confirmed Problem
✓ Method 能检验所有核心 predictions
✓ confounders 有明确处理入口
✓ 每个主要组件都有必要性论证
✓ 已形成最小 viable mechanism
✓ 做过 method-level closest-work check
✓ 明确拒绝或延后的复杂度
✓ assumptions 与 doesNotClaim 已记录
✓ 用户确认这条技术路线
```

仍不要求：

```text
✗ 完整实验矩阵
✗ benchmark 与样本规模最终确定
✗ 运行预算和 run order
✗ 方法已实现或已有结果
✗ 方法 novelty 已确认
```

失败处理：

| 情况 | 动作 |
|---|---|
| 核心 prediction 无法覆盖 | 修改 Approach；若原则上不可观测则退回 Step 5 |
| confounder 无法控制或测量 | 收窄 claim、改为 sensitivity boundary，或阻塞确认 |
| replay 状态不可恢复 | 更换干预设计；不可用文字假装 counterfactual 成立 |
| closest work 直接覆盖方法 | 展示重叠并收窄、改为复现/扩展或换路线 |
| 方法只能预测、不能支持 attribution | 降级 claim 或补充可识别的 intervention |
| 用户加入无 prediction link 的模块 | 进入 rejected/deferred，不进入 confirmed V1 |
| 最小方法仍不可执行 | 标记 `blocked`，保留过程并退回上游选择 |

## 16. Step 6 → Step 7 交接

```ts
interface ResearchDesignRequest {
  projectId: string
  methodRef: { id: string; revision: number; contentHash: string }
  problemRef: ProblemRef
  hypothesisSetRef: VersionedRef
  landscapeRef: LandscapeRef
  predictionRefs: string[]
  methodClaimRefs: string[]
  predictionCoverageRefs: string[]
  confounderHandlingRefs: string[]
  closestWorkAssessmentRefs: string[]
  remainingUncertainty: string[]
  requestId: string
}
```

Step 7 回答：

> 这个 Method 与已有方法是什么关系？它真正要证明哪些 claims？哪些 Evaluation 与 Baseline 能够区分这些 claims？

Step 7 先确定研究设计逻辑。后续 Evidence Plan 再确定 dataset / task、metric、ablation、样本规模、成功判据、失败解释、资源预算与 run order。

完整链条：

```text
1 Seed
→ 2 Landscape
→ 3 Direction
→ 4 Problem
→ 5 Hypothesis
→ 6 Approach / Method
→ 7 Research Design
```

## 17. 状态、版本与存储

```ts
interface MethodFormationSession {
  id: string
  projectId: string
  hypothesisSetRef: VersionedRef
  status: 'deriving_requirements' | 'comparing_approaches' | 'specifying_method'
    | 'checking_coverage' | 'checking_closest_work' | 'simplifying'
    | 'method_ready' | 'method_confirmed' | 'blocked' | 'parked'
  requirementIds: string[]
  approachCandidateIds: string[]
  selectedApproachIds: string[]
  methodDraftId: string | null
  confirmedMethodId: string | null
  createdAt: string
  updatedAt: string
}
```

目标目录：

```text
research/methods/<method-id>/
├── manifest.json
├── drafts/<revision>.json
├── confirmed/<revision>.json
├── requirements/<requirement-id>.json
├── approaches/<approach-id>.json
├── objects/<object-id>.json
├── operations/<operation-id>.json
├── components/<component-id>.json
├── coverage/<coverage-id>.json
├── assessments/<assessment-id>.json
├── decisions/<decision-id>.json
└── views/<revision>/method.md

research/method-formation/<session-id>/
├── state.json
└── probes/<probe-id>.json
```

Work、Version、Fragment、Question 与文献证据仍由 Research Wiki 持有；Method 只保存引用与用户研究决策，不复制一套可编辑文献事实。确认版本走不可变快照、`contentHash` 与 `requestId` 幂等。新增 core prediction、替换 primary approach 或改变 mechanismUnit 都创建新 revision，并使旧的 Step 7 handoff 失效。

## 18. Skill 与服务边界

未来的 method-formation Skill 可协调：

- `derive_method_requirements`：从 prediction / confounder 推导最小约束。
- `propose_approach_families`：生成机制不同的候选路线与角色建议。
- `compare_approaches`：按覆盖、假设、可行性与复杂度比较。
- `specify_method_objects`：定义最小对象、操作与组件。
- `map_predictions_to_method`：执行 intervention / contrast / observation 覆盖检查。
- `assess_method_feasibility`：检查状态恢复、干预、重放、测量与成本条件。
- `probe_method_claim`：对核心操作做 closest-work 检索。
- `run_simplicity_gate`：删除或延后无必要性组件。
- `confirm_method`：由领域服务校验显式用户动作后提交。

Agent 负责提出、解释、比较与指出缺口；Searcher / Resolver / Reader 负责文献核查；领域服务负责引用完整性、版本、校验、幂等与提交；用户负责确认要采用的技术路线。

## 19. Golden Path 示例

以下是合成示例，不表示该方法已实现、有效或新颖。

```text
Confirmed Hypothesis
Harness edit effect depends on component context and prior edit path

Predictions
P1 same edit, different state → different effect
P2 same final components, different order → different outcome
P3 joint effect ≠ isolated effect sum

→ 推导 R1–R7

→ 比较候选
   A Full Factorial Replay
   B Edit Lineage + Targeted Replay
   C Learned Interaction Estimator
   D Bundle-level Attribution

→ 用户选择
   B as primary
   A as small-scale oracle

→ 具体化对象
   EditEvent / HarnessState / ReplayQuery

→ Coverage Gate
   P1: replay same edit across states
   P2: compare A→B with B→A
   P3: compare joint with isolated estimates

→ Closest-work Probe
   partial overlap / adjacent methods / unresolved differentiation

→ Simplicity Gate
   reject Critic Agent / extra memory / learned estimator in V1

→ Method Thesis
   Typed lineage + selective replay for history-dependent interaction estimation

→ 用户确认

→ Step 7 形成 Method & Evaluation co-design
```

## 20. 验收场景

| 场景 | 应满足的不变量 |
|---|---|
| 系统一开始给出复杂 Agent 架构 | 先退回 requirements；无 prediction link 的模块不得进入 V1 |
| 候选路线只有措辞不同 | 合并；候选必须在 intervention、representation 或 inference 上有实质差异 |
| B 为主方法、A 为 oracle | 允许，但每条路线角色明确，不合并成两个主贡献 |
| 方法覆盖 P1/P2，未覆盖 P3 | Gate 不通过或显式收窄 Hypothesis 后创建新 revision |
| 用户选择 learned estimator | 展示 prediction 与 attribution 的区别，要求识别假设或降级 claim |
| Step 5 confounder 未处理 | Gate 不通过，不允许从 Method 状态中删除 |
| 找到直接同类方法 | 标 direct_match，展示差异不足，不自动宣布 novelty |
| 检索没有直接命中 | 写 no_direct_match_in_search，不写“首次提出” |
| 用户新增 GNN 但无必要性 | 写入 rejected/deferred，并保留理由 |
| state snapshot 不可恢复 | feasibility=blocked，不声称可做 counterfactual replay |
| 用户确认 Method | 生成不可变快照；不写“方法已验证” |
| Step 7 接收 | 获得 claims、predictions、coverage、confounders、feasibility 与不确定性 |

完成标准：用户能够说明“为什么选这条 Approach、它怎样逐条检验 Hypothesis、最小对象和操作是什么、哪些复杂度被拒绝、与最近邻方法还有哪些待核查差异”。

## 21. 与现有设计的衔接

本文实现 [Step 5](./05-hypothesis-formation.md) 定义的 `MethodFormationRequest`，把 `ConfirmedHypothesisSet` 的 predictions 与 confounders 转化为 `ConfirmedResearchMethod`，并定义 `ResearchDesignRequest` 供 Step 7 使用。

它也延续 [Idea 结构设计](../idea-structure.md) 的 Human-led 原则：AI 提出 Approach、Method objects 与删减建议，用户确认技术路线；Idea 引用确认的 Method 版本，不复制一份独立可编辑的方法真值。文献事实继续归 Research Wiki，Method 层只保存 evidence refs、assessment 与设计决策。

## 22. 参考与使用边界

主要依据是用户此次提供的 Step 6 流程，保留“最小 requirements → 候选 Method Families → 用户选择 → 核心对象 → prediction mapping → closest-work check → simplicity gate → Method Thesis → 用户确认”的主线，并补充输入输出契约、可行性、confounder、版本、失败路径与 Step 7 交接。详细实验计划不在本文范围内。

本地 [ARIS research-refine](../../../references/Auto-claude-code-research-in-sleep/skills/research-refine/SKILL.md) 强调冻结 Problem Anchor、选择最小充分机制、围绕一个 dominant contribution 并拒绝无必要性的复杂度；本文借鉴这些约束，但不执行其论文级打分与自动 refinement 循环。本地 [ARIS experiment-plan](../../../references/Auto-claude-code-research-in-sleep/skills/experiment-plan/SKILL.md) 要求从 claim 推导最小 convincing evidence、成功/失败判据与 run order；这些属于 Research Design 之后的 Evidence Plan。

本文没有验证任何 Harness 领域结论，也没有执行方法级检索。Full Factorial Replay、Edit Lineage、Targeted Counterfactual Replay 等均为设计示例；只有在真实项目中取得版本化来源、coverage 与 closest-work assessment 后，才能进入 Method 状态。
