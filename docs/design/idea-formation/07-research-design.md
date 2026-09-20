# CoResearch Step 7：Research Design

## Method & Evaluation Co-Design

- 日期：2026-09-18
- 状态：设计提案；本次不实现页面、Canvas 命令、实验执行或真实领域检索。
- 上游：[Step 6 · Approach / Method Formation](./06-approach-method-formation.md)。
- 画布：[Huabu 领域映射与交互升级提案](../canvas/huabu-domain-binding.md)。
- 下游：Idea Synthesis / Review。
- 产品流程真值：[Research Flow](../research-flow.md)。本步对应 Method & Evaluation Co-Design：Claim ↔ Method ↔ Evaluation 同时设计，仍不做实验协议。

## 1. Step 7 解决什么

到 Step 6，用户已经确认了一个核心 Approach，例如：

```text
Typed Edit Lineage
+
Targeted Counterfactual Replay
```

Step 7 不再把用户带到一张新的实验表单，而是在同一个 Huabu Space 中回答三件事：

1. Method 由哪些必要机制组成？
2. 最近的方法已经解决了哪些部分，自己的区别在哪里？
3. 如果 Method 有价值，应从哪些评价维度与比较逻辑证明它？

因此 Step 7 是 **Method & Evaluation Co-Design**。它把研究设计变成一组相互连接、可以被用户移动和修改的研究对象：Method、Closest Method、Claim、Evaluation Dimension、Baseline 和待核查 Question。

它不确定具体 benchmark、数据量、seed 数、GPU、metric threshold 或 run order。那些属于后续实验执行规划；Step 7 先确定“要证明什么”和“什么比较能够证明”。

```text
Confirmed Method
      ↓
找 Closest Methods
      ↓
拆出可复用机制、已有能力与剩余差异
      ↓
用户删减并确认 Method 组成
      ↓
把 Method 绑定到 Hypothesis / Predictions
      ↓
提出 Method Claims
      ↓
选择 Evaluation Dimensions 与 Baseline Families
      ↓
用户确认 Research Design
      ↓
Idea Synthesis / Review
```

## 2. 与 Step 6 和实验计划的边界

| 步骤 | 主要问题 | 产物 |
|---|---|---|
| Step 6 | 为了检验 Hypothesis，需要什么最小 Method？ | Confirmed Research Method |
| Step 7 | 这个 Method 和已有方法是什么关系，应该证明什么？ | Confirmed Research Design |
| 后续执行规划 | 用什么任务、多少样本、什么顺序和预算取得证据？ | Evidence / Experiment Plan |

Step 7 可以提出“需要小规模 Full Replay 作为 oracle”，但不会决定 oracle 要跑多少实例。它可以要求“需要 Attribution Fidelity 证据”，但不会把具体阈值写成已确认结果。

## 3. 输入与输出

### 3.1 输入

```ts
interface ResearchDesignRequest {
  projectId: string
  methodRef: VersionedRef
  problemRef: VersionedRef
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

服务读取 Step 6 的 Method Thesis、对象与操作、coverage、feasibility、closest-work assessment、rejected complexity 和 method boundary。若用户在 Step 7 删除了核心 Method 组件，系统创建新的 Method draft revision，不能直接改写已经确认的 Method 快照。

### 3.2 输出

```ts
interface ConfirmedResearchDesign {
  schemaVersion: 1
  id: string
  projectId: string
  methodRef: VersionedRef
  problemRef: VersionedRef
  hypothesisSetRef: VersionedRef
  revision: number
  methodComponentRefs: string[]
  reusedMechanismRefs: string[]
  newMechanismRefs: string[]
  closestMethodRefs: string[]
  methodClaimRefs: string[]
  evaluationDimensionRefs: string[]
  baselineFamilyRefs: string[]
  hypothesisCoverageRefs: string[]
  openQuestionRefs: string[]
  designBoundary: {
    primaryClaims: string[]
    supportingClaims: string[]
    deferredClaims: string[]
    doesNotClaim: string[]
  }
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

`confirmed` 表示用户确认了研究设计的组织方式和主张边界。它不表示 Method 已经有效，也不表示后续实验一定支持这些 claims。

## 4. 画布布局

Step 7 在 Approach 附近创建一个 `Research Design` Frame：

```text
                    PROBLEM
                       │
                       ▼
                  HYPOTHESIS
                       │
                       ▼
                    APPROACH
                       │
                       ▼
        ┌─────────────────────────┐
        │     RESEARCH DESIGN     │
        │                         │
        │ Method                  │
        │ Evaluation              │
        │ Closest Methods         │
        │ Baselines               │
        └─────────────────────────┘
```

Frame 是空间组织，不是领域状态机。用户可以移动和重排卡片；实体的状态、版本、证据和确认仍由 Research Domain 管理。画布中的关系线分为自由视觉连接和绑定的研究关系，后者需要带 relation type 与 evidence refs。

## 5. 第一动作：查找 Closest Methods

Agent 进入 Step 7 后，先围绕 Step 6 的核心操作查找机制上最相似的方法：

```text
edit lineage
harness edit observability
patch credit
component attribution
counterfactual replay
sequential intervention
interaction attribution
```

每个 Closest Method 节点使用三段式结构：

```text
WHAT WE CAN REUSE
已有机制与可复用接口

WHAT IT ALREADY SOLVES
已经覆盖的 Problem / Hypothesis / Method claim

WHAT IT DOES NOT SOLVE
与当前 Method 的具体差异和未覆盖范围
```

示例：

```text
AHE
✓ editable component representation
✓ edit observability
✓ edit prediction
✓ component ablation

结论：Edit observability 不应再次包装成独立新贡献。
```

```text
GSME
✓ deterministic patch evaluation
✓ patch credit
✓ significance testing

结论：可靠判断 patch 是否带来 gain 应作为可复用机制或 baseline。
```

```text
HCL
✓ sequential harness state
✓ continual updates
✓ retention / guarded commit

结论：Harness 作为持续变化 State 的表示已经有相邻工作。
```

系统必须把“可以继承”与“可以宣称为贡献”分开保存：复用不等于新颖，存在差异也不自动等于新颖。

```ts
interface ClosestMethodCard {
  id: string
  workRef: string
  relevantMechanisms: string[]
  reusableMechanisms: string[]
  solvedClaims: string[]
  unsolvedClaims: string[]
  overlap: 'direct' | 'partial' | 'adjacent' | 'unclear'
  relation: 'reuse' | 'compare' | 'extend' | 'differentiate' | 'challenge'
  evidenceRefs: string[]
  status: 'proposed' | 'user_reviewed' | 'confirmed'
}
```

## 6. 拆出 Existing Building Blocks 与 Proposed Mechanism

Canvas 维护两个显式区域：

```text
EXISTING BUILDING BLOCKS

AHE
 └── Edit observability

GSME
 └── Deterministic credit

HCL
 └── Sequential state tracking
```

```text
YOUR PROPOSED MECHANISM

Typed Edit Lineage
        +
History-aware Counterfactual Replay
        +
Interaction Attribution
```

每个 Proposed Mechanism 必须连接至少一个 Method Claim 和一个 Hypothesis / Prediction。只有名称不同、职责和观测完全相同的机制会被合并或标为重复。

```ts
interface MechanismDisposition {
  id: string
  mechanismName: string
  sourceRefs: string[]
  disposition: 'reuse' | 'adapt' | 'new_under_investigation'
    | 'rejected_as_overlap' | 'deferred'
  reason: string
  relatedMethodRefs: string[]
  relatedClaimRefs: string[]
}
```

## 7. 用户参与 Method Co-Design

系统可以提出：

```text
Candidate Method

1. Typed Edit Lineage
2. Interaction Detector
3. Counterfactual Replay
4. Learned Attribution Model
5. Critic Agent
```

用户可以删除、合并、改名或降级：

```text
CORE
✓ Typed Edit Lineage
✓ Targeted Counterfactual Replay

SUPPORTING
~ Simple interaction screening

REJECTED / DEFERRED
× Learned attribution model
× Extra critic agent
```

系统每次响应用户修改时运行一次完整性检查：

```text
Method changed
      ↓
Does a Method Claim change?
      ↓
Does Hypothesis / Prediction coverage change?
      ↓
Does Evaluation remain able to support the claim?
      ↓
Update affected cards and mark stale items
```

删除一个组件不得静默删除其证据关系；相关 claim 标为 `needs_review`，用户决定删除 claim、改变方法或保留未覆盖状态。

## 8. Method 与 Hypothesis 对齐

Canvas 用有类型的关系呈现检验逻辑：

```text
H1
Edit effect depends on current component context
      │ tests
      ▼
Replay same edit under different states
```

```text
H2
Edit effect depends on prior edit sequence
      │ tests
      ▼
Compare alternative edit orders
```

```text
H3
Joint effect ≠ isolated effect sum
      │ tests
      ▼
Joint vs isolated replay
```

如果 Method Component 没有任何 Hypothesis 或 Prediction 指向，它应进入 Simplicity Review。若用户仍保留它，必须写明它属于 feasibility、confounder handling 或 supporting infrastructure。

```ts
interface HypothesisMethodLink {
  id: string
  hypothesisOrPredictionRef: string
  methodRef: string
  relation: 'tests' | 'operationalizes' | 'controls' | 'measures'
  observation: string
  status: 'proposed' | 'confirmed' | 'needs_review'
}
```

## 9. Method Claims

Method 通过 Claims 进入 Evaluation。系统不把 Method 名称自动当作 claim，而要求用户选择真正需要证明的主张：

```ts
interface MethodClaim {
  id: string
  statement: string
  claimType: 'mechanism' | 'attribution' | 'efficiency' | 'robustness'
    | 'utility' | 'generalization' | 'integration'
  methodComponentRefs: string[]
  predictionRefs: string[]
  primaryRole: 'primary' | 'supporting' | 'deferred' | 'anti_claim'
  minimumEvidenceDraft: string
  status: 'draft' | 'user_selected' | 'confirmed' | 'needs_review'
}
```

本例可以提出：

```text
Primary
M1  Targeted replay can recover history-dependent interaction effects.

Supporting
M2  Targeted replay requires fewer evaluations than exhaustive replay
    under a stated comparison scope.

Anti-claim to rule out
M3  Apparent interaction is only execution noise or task mix imbalance.

Deferred
M4  The method transfers across models and tasks.
```

Claim 的状态是用户研究状态；Agent 可以提出，但不能自动把 `new_under_investigation` 变成 confirmed contribution。

## 10. Evaluation Dimensions

系统先提出评价维度，用户排序并划定范围：

```text
A · Attribution Fidelity
B · Replay Efficiency
C · Robustness / Stochastic Stability
D · Downstream Harness Utility
E · Generalization
```

用户可以确认：

```text
PRIMARY
Attribution Fidelity
Replay Efficiency

SECONDARY
Downstream Utility

SUPPORTING ROBUSTNESS
Stochastic Stability

DEFERRED
Cross-model Generalization
```

```ts
interface EvaluationDimension {
  id: string
  name: string
  question: string
  supportsClaimRefs: string[]
  relatedPredictionRefs: string[]
  priority: 'primary' | 'secondary' | 'supporting' | 'deferred'
  minimumEvidenceDraft: string
  failureInterpretationDraft: string
  status: 'proposed' | 'user_selected' | 'confirmed' | 'needs_review'
}
```

Step 7 只确定评价逻辑。例如 `Attribution Fidelity` 需要回答“归因是否接近一个定义好的 oracle 或已知干预结果”；它不确定 oracle 的具体任务数量和统计阈值。

## 11. Baseline Families

Baseline 只描述比较逻辑和它要排除的解释：

```text
Aggregate Score
  问：不做 attribution 时，整体分数能解释多少？

Component Ablation
  问：单组件归因是否已经足够？

Patch-level Credit
  问：只给 patch 记功是否能解释 sequential interaction？

Full Replay Oracle
  问：Targeted Replay 换取了多少效率，损失了多少归因能力？
```

```ts
interface BaselineFamily {
  id: string
  name: string
  comparisonLogic: string
  rulesOut: string[]
  supportsClaimRefs: string[]
  requiredFor: 'primary' | 'supporting' | 'sanity_check'
  concreteInstantiation: string | null
  status: 'proposed' | 'selected' | 'deferred' | 'confirmed'
}
```

Step 7 不要求选择某一 benchmark 上的具体 baseline 实现。具体实现属于后续 Evidence Plan，并必须继承这里写明的比较目的。

## 12. 三类关键关系

画布关系至少要区分：

```text
Method Component ── implements ──> Method Claim
Hypothesis / Prediction ── tests ──> Method Operation
Method Claim ── must_be_supported_by ──> Evaluation Dimension
Evaluation Dimension ── compares_against ──> Baseline Family
Closest Method ── reuses / overlaps / challenges ──> Mechanism
```

关系对象：

```ts
interface ResearchDesignRelation {
  id: string
  fromRef: string
  toRef: string
  relation: 'implements' | 'tests' | 'operationalizes' | 'supports'
    | 'compares_against' | 'reuses' | 'overlaps' | 'challenges'
  evidenceRefs: string[]
  origin: 'user' | 'agent_proposal' | 'literature' | 'system'
  status: 'draft' | 'proposed' | 'confirmed' | 'needs_review'
}
```

自由连线可以帮助用户整理空间，但不能自动填充这些 typed relations。

## 13. Canvas 上的 Review 与确认

Step 7 的 Agent 操作遵循 Huabu 的“提出画布变更 → 用户 Review → Keep/Revert”路径。CoResearch 再加一层领域确认：

```text
Agent creates or edits cards
      ↓
Huabu review card
      ↓ Keep / Revert canvas change
用户打开完整 Research Design
      ↓
检查 claims、coverage、baseline、closest-work status
      ↓
Confirm Research Design revision
```

Keep 只保留画布变更；它不会确认 Method Claim，也不会确认 Evaluation Dimension。Confirm 必须记录 `designRevision`、`contentHash`、用户和 actionRef。

如果用户修改了 Method、删除了 Primary Claim 或把 Evaluation 从 Primary 改为 Deferred，设计 revision 递增，受影响的关系标记 `needs_review`。

## 14. Agent 在 Step 7 的四项职责

### 14.1 找最相似的方法

围绕 Method 的机制和操作检索，而不是继续做宽泛领域综述。

### 14.2 标出已有能力

告诉用户哪些机制可以复用、哪些 claim 已被覆盖、哪些差异仍需核查。

### 14.3 提出最小 Method 设计

把已有 building blocks 与待研究机制拆开，并主动询问每个模块服务哪条 prediction 或 claim。

### 14.4 反向检查 Evaluation

Method 每次发生语义修改，都重新检查：

```text
Method → Claims → Evaluation → Baselines
```

如果新的 Method Claim 没有 Evaluation，或原有 Evaluation 已不能支持修改后的 Claim，系统将其标为 `needs_review`，不能继续显示为完整设计。

## 15. 完成条件

Step 7 结束前需要：

```text
✓ Core Method 已形成
✓ Existing mechanisms 与 Proposed mechanisms 已分开
✓ Closest Methods 已有复用 / 重叠 / 差异关系
✓ Method 与 Hypothesis / Predictions 已对齐
✓ Primary 与 Supporting Method Claims 已选择
✓ Evaluation Dimensions 已排序
✓ Baseline Families 已说明比较逻辑
✓ 用户已审阅并确认 Research Design revision
```

仍不要求：

```text
✗ benchmark
✗ dataset
✗ sample size
✗ seed 数量
✗ exact metric threshold
✗ run order
✗ 已有实验结果
```

## 16. 失败路径

| 情况 | 系统动作 |
|---|---|
| Proposed Mechanism 已被 closest work 直接覆盖 | 标 `overlap=direct`，要求复用、收窄、扩展或改写 claim |
| Method Component 没有 Hypothesis / Claim 连接 | 进入 Simplicity Review，默认 deferred |
| Method 修改后 Evaluation 仍沿用旧 claim | 标 `needs_review`，阻止确认 |
| 只有总分，没有 attribution contrast | 提示无法证明 Attribution Fidelity |
| Baseline 只有名称，没有比较目的 | 要求补充 comparisonLogic |
| 用户把 Generalization 设为 Primary，但方法未覆盖 | 提醒收窄 claim 或补充设计，不自动扩展范围 |
| Agent 生成的关系没有 evidence refs | 保持 proposal 状态，不显示为文献事实 |
| Huabu Keep 后用户未确认研究设计 | 保持 draft，不生成 ConfirmedResearchDesign |

## 17. Step 7 → Idea Synthesis / Review

```ts
interface IdeaSynthesisRequest {
  projectId: string
  seedRef: VersionedRef
  landscapeRef: LandscapeRef
  focusRef: VersionedRef
  problemRef: VersionedRef
  hypothesisSetRef: VersionedRef
  methodRef: VersionedRef
  researchDesignRef: VersionedRef
  requestId: string
}
```

Idea Synthesis 将 Canvas 上已经确认的节点整理成一份可审阅的研究构想：Problem、Hypothesis、Method、Closest Work、Claims、Evaluation Logic、Open Questions 和证据边界。它不增加新的研究方向；发现矛盾时回到对应节点创建新 revision。

如果以后需要详细实验规划，Evidence Plan 从 `ConfirmedResearchDesign` 读取 Claims、Evaluation Dimensions 和 Baseline Families，再补充 benchmark、样本规模、metric、run order 和预算。它是研究设计的下游交付物，不应覆盖 Step 7 的决策。

## 18. 状态、版本与存储

```ts
interface ResearchDesignSession {
  id: string
  projectId: string
  methodRef: VersionedRef
  status: 'finding_closest_methods' | 'separating_mechanisms'
    | 'co_designing_method' | 'mapping_claims' | 'selecting_evaluation'
    | 'selecting_baselines' | 'ready_for_review' | 'confirmed' | 'blocked'
  cardIds: string[]
  relationIds: string[]
  closestMethodIds: string[]
  methodClaimIds: string[]
  evaluationDimensionIds: string[]
  baselineFamilyIds: string[]
  confirmedDesignId: string | null
  createdAt: string
  updatedAt: string
}
```

建议存储：

```text
research/designs/<design-id>/
├── manifest.json
├── drafts/<revision>.json
├── confirmed/<revision>.json
├── closest-methods/<id>.json
├── mechanisms/<id>.json
├── claims/<id>.json
├── evaluations/<id>.json
├── baselines/<id>.json
├── relations/<id>.json
└── views/<revision>/research-design.md

research/design-sessions/<session-id>/
├── state.json
└── probes/<probe-id>.json
```

这些是 Research Domain 对象。Huabu 的 `space.json`、节点 Markdown 与布局事件保存 Canvas 视图；两边通过 `ResearchCanvasBinding` 关联，不能互相当作唯一真值。

## 19. Golden Path

```text
Confirmed Approach
Typed Edit Lineage + Targeted Counterfactual Replay

→ Agent 查找 AHE / GSME / HCL 等 closest methods

→ Canvas 标出
   AHE observability       reuse
   GSME deterministic credit  reuse / compare
   HCL sequential state    overlap

→ 用户确认
   Core: Typed Edit Lineage + Targeted Replay
   Deferred: Learned Attribution Model
   Rejected: Extra Critic Agent

→ Method mapping
   H1 → same edit under different states
   H2 → alternative edit orders
   H3 → joint vs isolated replay

→ Claims
   M1 Attribution Fidelity  primary
   M2 Replay Efficiency     supporting
   M3 Execution noise       anti-claim
   M4 Generalization        deferred

→ Evaluation
   Attribution Fidelity     primary
   Replay Efficiency        primary
   Downstream Utility       secondary

→ Baselines
   Aggregate Score
   Component Ablation
   Patch-level Credit
   Full Replay Oracle

→ 用户确认 Research Design
→ Idea Synthesis / Review
```

## 20. 与已有设计的衔接

本文把 [Step 6](./06-approach-method-formation.md) 的 Method Thesis、components、coverage 与 closest-work assessments 放到 Huabu Canvas 上继续共同设计；它不会改变 Step 1–6 的领域 Gate。它将先前 README 中“Step 7 · Experiment / Evidence Plan”的位置改为 Research Design；详细实验规划作为本步骤的后续产物。

与 [Huabu 领域映射提案](../canvas/huabu-domain-binding.md) 一致：Agent 可以创建和修改草稿卡，用户可以 Review、Keep 或 Revert 画布修改，研究版本的确认仍由领域服务通过 contentHash 和 Gate 提交。Research Wiki 持有论文、证据和文献关系；Idea Space 持有用户确认的研究决定。
