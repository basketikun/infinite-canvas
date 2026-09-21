# CoResearch Step 8：Idea Synthesis & Review

- 日期：2026-09-18
- 状态：设计提案；本次不实现 Review Agent、Canvas 命令、文献检索或 Idea 导出。
- 上游：[Step 7 · Research Design](./07-research-design.md)。
- 画布：[Huabu 领域映射与交互升级提案](../canvas/huabu-domain-binding.md)。
- 产物：可继续演化的 `Idea Snapshot` milestone。
- 产品流程真值：[Research Flow](../research-flow.md)。Flow 将本文件拆成 Idea Synthesis、Idea Review 与 Versioning 三步；Review 不打分，Comment 必须由用户接受 / 编辑 / 拒绝。若与 Flow 冲突，以 Flow 为准。

## 1. Step 8 的目标

**把前 7 步已经确认的研究对象收束成一个完整 Research Idea，并检查 Problem、Hypothesis、Method、Evaluation 和 Literature Position 是否彼此对齐。**

Step 8 不是一次新的 brainstorming，也不是把所有内容重新交给模型改写成一篇 proposal。它只做四件事：

```text
收束       从 Canvas 收集已确认对象，形成一个 Idea 视图
对齐       检查 Problem → Hypothesis → Method → Evaluation 链
批判       查最新文献、证据强度、最近邻攻击、贡献与范围
确认       由用户确认 Idea Snapshot，建立可回溯 milestone
```

完整流程到此收束：

```text
1 Seed
   ↓
2 Landscape
   ↓
3 Direction Trajectory
   ↓
4 Problem
   ↓
5 Hypothesis
   ↓
6 Approach
   ↓
7 Method & Evaluation Co-Design
   ↓
8 Idea Synthesis & Review
```

最终问题是：

> 现在把这些对象放在一起，它是否是一个逻辑完整、文献定位清楚、范围可控、值得继续推进的 Research Idea？

## 2. 输入与输出

### 2.1 输入

```ts
interface IdeaSynthesisRequest {
  projectId: string
  seedRef: VersionedRef
  landscapeRef: VersionedRef
  focusRef: VersionedRef
  problemRef: VersionedRef
  hypothesisSetRef: VersionedRef
  methodRef: VersionedRef
  researchDesignRef: VersionedRef
  requestId: string
}
```

服务只读取已确认版本和其引用。草稿、被拒候选、未通过 Gate 的关系可以作为 Review 风险来源，但不能被悄悄升级到 Snapshot 的正文。

### 2.2 输出

```ts
interface IdeaSnapshot {
  schemaVersion: 1
  id: string
  projectId: string
  revision: number
  title: string
  seedRef: VersionedRef
  focusRef: VersionedRef
  problemRef: VersionedRef
  hypothesisSetRef: VersionedRef
  methodRef: VersionedRef
  researchDesignRef: VersionedRef
  literaturePositionRef: string
  logicAuditRef: string
  evidenceAuditRef: string
  closestWorkReviewRef: string
  scopeRef: string
  riskRefs: string[]
  openQuestionRefs: string[]
  lastLiteratureVerification: string
  status: 'draft' | 'reviewed' | 'confirmed' | 'superseded'
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

`confirmed` 表示用户确认了这一版 Idea 的表达、范围和当前定位。它不表示“Novel Idea 已证明”，也不冻结后续文献更新或 Idea revision。

## 3. Synthesize：引用对象，不复制事实

Step 8 从 Canvas 收集这些确认对象：

```text
Seed
Selected Direction / Focus
Problem
Hypothesis + Predictions
Approach / Method
Research Design
Closest Literature
Research Threads
Open Questions
```

中央 Canvas Frame 显示：

```text
IDEA · v1

Working Title
Problem
Hypothesis
Method
Evaluation Logic
Literature Position
Risks / Open Questions
```

这些卡片是原对象的 synthesis / reference。Idea Snapshot 保存 `entityRef`、revision 和 contentHash，不再生成一份可以脱离原对象编辑的第二份事实。用户修改 Problem 时，旧 Idea Snapshot 保留；需要时创建新的 Idea draft。

```ts
interface IdeaSynthesisCard {
  id: string
  sourceRef: VersionedRef
  role: 'title' | 'problem' | 'hypothesis' | 'method'
    | 'evaluation' | 'literature_position' | 'risk' | 'open_question'
  summary: string
  sourceContentHash: string
  status: 'current' | 'stale' | 'needs_review'
}
```

Agent 不能在 synthesis 阶段凭空增加一个新的核心 Problem、Hypothesis 或 Method。发现缺口时只能创建 Review Comment、Open Question 或返回上游步骤。

## 4. Idea Frame 与 Literature Position

Huabu 的 Frame 组织节点和关系，Node 承载材料或想法，Edge 表达明确关系；这适合将 Idea 作为原 Canvas 上的 milestone，而不是另一个脱离空间的 HTML 页面。

```text
                    IDEA · v1
┌─────────────────────────────────────────────┐
│                                             │
│  Working Title                              │
│  Interaction-Aware Attribution for          │
│  Continually Evolving Agent Harnesses       │
│                                             │
│  PROBLEM                                    │
│  Sequential harness edits may have          │
│  interaction and history dependence.        │
│                                             │
│  HYPOTHESIS                                 │
│  Edit effects depend on context and         │
│  prior edit history.                        │
│                                             │
│  METHOD                                     │
│  Typed Edit Lineage + Targeted Replay       │
│                                             │
│  EVALUATION                                 │
│  Attribution Fidelity · Replay Efficiency   │
└─────────────────────────────────────────────┘
```

Idea Frame 左侧保留 Literature Position：

```text
AHE ───── closest work ─────┐
                            ▼
                          IDEA v1
                            ▲
GSME ─── closest work ──────┤
                            ▲
HCL ───── closest work ─────┘
```

Positioning 卡片必须使用校准语言：

```text
EXISTING WORK COVERS
✓ component observability
✓ deterministic patch credit
✓ continual harness state

CURRENT DIFFERENTIATION UNDER REVIEW
? history-dependent interaction attribution
  across sequential multi-component edits
```

`CURRENT DIFFERENTIATION` 不是 `NOVELTY CONFIRMED`。Idea Snapshot 必须保留最近邻来源和当前检索覆盖。

## 5. Freshness Check

Step 8 开始前必须做一次最新文献核查。Step 3 或 Step 4 的 Landscape 可能已经过时，不能直接作为最终定位。

```text
读取上次 literature verification
        ↓
确定本次 frontier sweep 范围
        ↓
查近期工作与 concurrent work
        ↓
canonicalize / deduplicate
        ↓
复核 Problem、Method、Closest Work
        ↓
更新 Literature Position
```

Freshness Check 至少检查：

```text
• 是否有新论文直接解决 Problem
• 是否有新论文提出相同或更接近的 Method
• 是否有新论文让某个 Limitation 过期
• 是否有新论文改变 Evaluation 或 baseline 逻辑
• 是否有 concurrent work 使当前 differentiation 需要收窄
```

```ts
interface FreshnessCheck {
  id: string
  startedAt: string
  cutoffAt: string
  queryRefs: string[]
  checkedWorkRefs: string[]
  directChallenges: string[]
  staleClaims: string[]
  coverage: 'sufficient' | 'partial' | 'blocked'
  completedAt: string | null
}
```

如果发现直接挑战：

```text
Idea Review
      ↓
BLOCKED BY NEW EVIDENCE
      ↓
返回 Problem / Hypothesis / Method
      ↓
新 revision
      ↓
重新进入 Step 8
```

不能在未处理新证据的情况下继续确认旧 Snapshot。

## 6. Logic Audit

Review Agent 机械检查这条链：

```text
Problem
  ↓ motivates
Hypothesis
  ↓ tested_by
Method
  ↓ evaluated_by
Evaluation
```

本例的闭合链：

```text
Problem
History-dependent attribution is insufficient
        ↓
Hypothesis
Edit effects depend on prior state
        ↓
Method
Replay the same edit in alternative prior states
        ↓
Evaluation
Recover known history-dependent effects
```

如果出现：

```text
Hypothesis
Edit effects depend on history
        ↓
Method
Build a memory retrieval agent
```

系统必须指出 Method 与 Hypothesis 没有直接关系，而不是用“可能有帮助”放过它。

```ts
interface LogicAudit {
  id: string
  links: Array<{
    fromRef: string
    toRef: string
    expectedRelation: 'motivates' | 'explains' | 'tests' | 'evaluates'
    status: 'aligned' | 'weak' | 'missing' | 'contradicted'
    reason: string
  }>
  unresolvedLinks: string[]
  status: 'closed' | 'needs_revision' | 'blocked'
}
```

逻辑关系应在 Canvas 中使用 typed Edge 表达，而不是仅靠卡片上下位置推断。

## 7. Evidence Audit

Idea 中每个重要陈述都要区分来源和证据状态：

```text
Claim 1
Harness is sequential / stateful.
✓ GROUNDED
有明确 Literature 支持。

Claim 2
Existing work supports component-level attribution.
✓ GROUNDED
可追到具体 Work / Fragment。

Claim 3
History-dependent interaction attribution remains insufficiently addressed.
◐ PARTIAL
当前检索支持有限，closest work 仍需持续核查。

Claim 4
Typed Lineage + Targeted Replay will solve the issue.
? UNVERIFIED
这是 Method Hypothesis，必须通过后续证据检验。
```

统一使用四种状态：

| 状态 | 含义 |
|---|---|
| `grounded` | 有明确用户输入或可定位文献支持 |
| `partial` | 有相邻证据，但当前表述强于证据 |
| `unverified` | 当前是推断、提案或待验证假设 |
| `challenged` | 存在直接反例、冲突文献或更近工作 |

```ts
interface EvidenceAuditItem {
  id: string
  claimRef: string
  statement: string
  status: 'grounded' | 'partial' | 'unverified' | 'challenged'
  evidenceRefs: string[]
  latestCheckedAt: string | null
  limitation: string | null
  requiredAction: 'none' | 'soften' | 'verify' | 'return_upstream'
}
```

`grounded` 也不表示完整证明；它只表示当前有可追溯依据。`unverified` 不应被改写成“novel”。

## 8. Closest-Work Stress Test

Review Agent 此时扮演 Reviewer，不再扮演 Ideator。它提出最可能的攻击：

```text
AHE
Reviewer might say:
“Component attribution is already covered.”

Current distinction:
AHE  → component-level observability / ablation
Ours → history-dependent interaction attribution
```

```text
GSME
Reviewer might say:
“Patch credit already exists.”

Current distinction:
GSME → deterministic patch-level credit
Ours → conditional multi-edit interaction
```

```text
HCL
Reviewer might say:
“Sequential harness evolution already exists.”

Current distinction:
HCL → retention / forgetting / guarded evolution
Ours → attribution during sequential evolution
```

每个攻击必须绑定最近邻 Work、重叠 claim 和当前差异。差异说不清时，Review 状态为 `needs_revision`。

```ts
interface ClosestWorkStressTest {
  id: string
  workRef: string
  reviewerAttack: string
  overlappingClaims: string[]
  currentDifference: string
  evidenceRefs: string[]
  verdict: 'difference_clear' | 'difference_partial' | 'overlap_too_strong'
  requiredAction: 'none' | 'narrow' | 'reuse' | 'return_upstream'
}
```

## 9. Contribution Discipline

Review 必须询问：

> 如果这项工作成功，真正的主 contribution 是什么？

默认只保留一个 dominant contribution，最多一个直接支持它的 supporting contribution：

```text
PRIMARY CONTRIBUTION
A method for estimating history-dependent interaction effects
among sequential harness edits without exhaustive replay.
```

以下通常是 implementation pieces，不自动成为独立 contributions：

```text
× 新 framework 名称
× 新 graph
× 新 agent
× 新 memory
× 新 benchmark
× 新 metric
```

```ts
interface ContributionReview {
  primaryClaimRef: string
  supportingClaimRefs: string[]
  overclaimedContributionRefs: string[]
  deletedOrMergedParts: string[]
  status: 'focused' | 'too_broad' | 'needs_user_decision'
}
```

Review Agent 可以提出合并和降级，但用户决定是否接受。它不能通过删除 Canvas 节点自动改变已确认 Method。

## 10. Evaluation Alignment

Step 8 重新检查 Step 7 的 Evaluation 是否真的支持主 claim：

```text
Primary Claim
Targeted replay recovers history-dependent interaction.
        ↓ must_be_supported_by
Primary Evaluation
Attribution Fidelity
```

若只有：

```text
Final benchmark accuracy
```

系统应指出：最终任务性能提高不等于 attribution 正确。Evaluation 与 Claim 不匹配时，Idea 不能直接确认；用户需要改 Claim、补 Evaluation 或降低主张强度。

```ts
interface EvaluationAlignment {
  id: string
  claimRef: string
  evaluationRef: string
  baselineRefs: string[]
  supports: 'direct' | 'partial' | 'none' | 'contradicts'
  mismatch: string | null
  status: 'aligned' | 'needs_revision' | 'blocked'
}
```

## 11. Scope、Risks 与 Open Questions

Review 还要明确这篇研究不做什么：

```text
IN SCOPE
✓ Skills / Tools / Memory edits
✓ Sequential evolution
✓ Interaction attribution

OUT OF SCOPE
× Foundation model training
× Multi-agent topology
× Full harness tampering solution
× Complete continual-learning solution
× Beneficiary-model alignment
```

```ts
interface IdeaBoundaryReview {
  inScope: string[]
  outOfScope: string[]
  risks: Array<{
    statement: string
    sourceRefs: string[]
    severity: 'low' | 'medium' | 'high' | 'unknown'
    handling: string
  }>
  openQuestions: Array<{
    statement: string
    blocking: boolean
    returnToStep: number | null
  }>
  status: 'bounded' | 'expanding' | 'blocked'
}
```

典型风险包括 causal interpretation、stochastic attribution、state replay 可行性和最新 closest work。它们对用户可见，但不能自动变成新的核心研究方向。

## 12. Review Board

Idea Frame 旁边生成 `IDEA REVIEW` Frame：

```text
┌─────────────────────────────────────┐
│ IDEA REVIEW                         │
│                                     │
│ Logic Chain                         │
│ ✓ Problem → Hypothesis aligned      │
│ ✓ Hypothesis → Method aligned       │
│ ✓ Claim → Evaluation aligned        │
│                                     │
│ Literature                          │
│ ✓ Closest works identified          │
│ ◐ Differentiation partially open    │
│ ✓ Latest sweep completed            │
│                                     │
│ Scope                               │
│ ✓ bounded                           │
│                                     │
│ Risks                               │
│ ? causal interpretation             │
│ ? stochastic attribution            │
│                                     │
│ Open Decisions                      │
│ • define interaction ground truth   │
│ • decide replay screening rule      │
└─────────────────────────────────────┘
```

不显示 `Score: 8.7/10` 之类的伪精确总分。Review 使用状态、证据、阻塞项和可执行的修改意见。

## 13. Review Comment 与 Edit Propagation

Review Agent 只能提出修改：

```text
REVIEW COMMENT

Current:
“accurately attributes interaction”

Suggested:
“estimates interaction effects”

Reason:
No causal identification argument yet.

[Accept] [Edit myself] [Reject]
```

用户修改核心 Idea 后，系统运行 Edit Propagation：

```text
Edited claim / method wording
        ↓
重新检查 Hypothesis links
        ↓
重新检查 Evaluation alignment
        ↓
重新检查 Literature Position
        ↓
标记受影响对象 stale / needs_review
```

例如用户把 `causal attribution` 改成 `interaction estimation`，系统必须同步检查 claims、evaluation、closest-work difference 和 scope，不能只改中央标题。

## 14. Freshness 或 Review 阻塞规则

```ts
interface IdeaReviewStatus {
  freshness: 'current' | 'partial' | 'blocked_by_new_evidence'
  logic: 'closed' | 'needs_revision' | 'blocked'
  evidence: 'audited' | 'partial' | 'blocked'
  closestWork: 'stress_tested' | 'partial' | 'overlap_too_strong'
  contribution: 'focused' | 'too_broad' | 'needs_user_decision'
  evaluation: 'aligned' | 'needs_revision' | 'blocked'
  scope: 'bounded' | 'expanding' | 'blocked'
  overall: 'ready_for_confirmation' | 'needs_revision' | 'blocked'
}
```

不能确认的情况：

| 条件 | 动作 |
|---|---|
| Freshness 发现直接新工作 | `blocked_by_new_evidence`，返回相关上游步骤 |
| Problem → Hypothesis → Method 链断裂 | 创建 Review Comment，阻止确认 |
| literature claim 无来源 | 降级为 unverified 或补充检索 |
| Historical limitation 已过期 | 更新 Position，重新检查 Problem |
| Closest work 重叠过强 | 收窄、复用、改为扩展或返回 Method |
| Contribution 过多 | 合并 implementation pieces，保留用户决定 |
| Claim 与 Evaluation 不对齐 | 修改 Claim、Evaluation 或降低主张 |
| Scope 正在膨胀 | 回写 out-of-scope，阻止新增核心对象 |

## 15. 用户确认与 Snapshot

Review 通过后，页面 / Canvas 提供一次明确确认：

```text
IDEA v1
Confirmed 2026-09-18

Working Title
Problem
Why It Matters
Hypothesis
Testable Predictions
Approach
Method Thesis
Evaluation Logic
Closest Prior Work
Current Differentiation
Known Risks
Open Questions
Scope
Last Literature Verification

[Confirm Idea Snapshot]
```

确认动作必须提交：

```ts
interface ConfirmIdeaSnapshot {
  snapshotId: string
  revision: number
  sourceRefs: VersionedRef[]
  reviewStatusRef: string
  contentHash: string
  actorId: string
  actionRef: string
  confirmedAt: string
}
```

它生成的是 Canvas 上一个锁定或标记的 milestone。锁定只保护这一个 Snapshot 的引用和内容；新的文献、用户修改或上游 revision 可以创建 Idea v2。

## 16. Idea 的持续演化

Idea v1 不是永久冻结：

```text
Idea v1
   │
   │ new literature / user revision
   ▼
Review reopened
   ↓
Problem unchanged, Method revised
   ↓
Idea v2
```

新论文可以通过 Research Wiki 触发 literature-initiated pivot：它挑战 Method、使 Limitation 过期，或改变接下来需要查的 Literature。旧 Snapshot 继续可读，新的 Idea revision 记录触发原因和受影响对象。

## 17. 完成条件

Step 8 只保留七条 Gate：

```text
✓ Problem、Hypothesis、Method、Evaluation 之间逻辑闭合
✓ 每个 literature-backed claim 都能追到来源
✓ 最新 closest-work sweep 已完成
✓ Historical limitation 没有被误当作 current gap
✓ 当前 differentiation 清楚，但没有夸成已证明 novelty
✓ Scope、risks、unverified assumptions 对用户可见
✓ 用户明确确认 Idea Snapshot
```

最终状态使用：

```text
SYNTHESIZED
+
USER REVIEWED
+
CURRENTLY POSITIONED
```

不使用：

```text
Novel Idea ✓
```

## 18. 状态、版本与存储

```ts
interface IdeaSynthesisSession {
  id: string
  projectId: string
  status: 'collecting' | 'freshness_check' | 'logic_audit'
    | 'evidence_audit' | 'closest_work_review' | 'scope_review'
    | 'ready_for_confirmation' | 'confirmed' | 'blocked' | 'reopened'
  sourceRefs: VersionedRef[]
  freshnessCheckId: string | null
  logicAuditId: string | null
  evidenceAuditId: string | null
  closestWorkReviewId: string | null
  snapshotId: string | null
  createdAt: string
  updatedAt: string
}
```

建议存储：

```text
research/ideas/<idea-id>/
├── manifest.json
├── drafts/<revision>.json
├── confirmed/<revision>.json
├── cards/<card-id>.json
├── freshness/<check-id>.json
├── audits/<audit-id>.json
├── stress-tests/<review-id>.json
├── risks/<risk-id>.json
├── decisions/<decision-id>.json
└── views/<revision>/idea-snapshot.md

research/idea-synthesis/<session-id>/
├── state.json
└── probes/<probe-id>.json
```

Research Wiki 持有论文、Fragment、引用、证据与 Literature Position；Idea Snapshot 持有用户确认的研究决定和引用。Huabu 保存 Space topology、节点内容、布局和 Review history；Canvas 绑定层连接二者。

## 19. Golden Path

```text
Step 7 完成
   ↓
读取已确认的 Seed / Focus / Problem / Hypothesis / Method / Design
   ↓
创建 IDEA · v1 Frame
   ↓
Freshness Check
   ↓
Logic Audit
   Problem → Hypothesis → Method → Evaluation
   ↓
Evidence Audit
   grounded / partial / unverified / challenged
   ↓
Closest-Work Stress Test
   AHE / GSME / HCL
   ↓
Contribution Discipline
   保留一个 dominant contribution
   ↓
Evaluation Alignment
   Claim → Evaluation → Baseline
   ↓
Scope / Risk / Open Question Review
   ↓
用户修改与确认
   ↓
Idea Snapshot · v1
   SYNTHESIZED + USER REVIEWED + CURRENTLY POSITIONED
```

## 20. 与已有设计的衔接

本文实现 [Step 7](./07-research-design.md) 定义的 `IdeaSynthesisRequest`，并把已确认的研究对象收束成 `IdeaSnapshot`。它不会改变 Step 1–7 的 Gate，也不会把画布上的位置或自由连线当作领域事实。

与 [Huabu 领域映射提案](../canvas/huabu-domain-binding.md) 一致：Agent 的新增和修改先进入 Canvas Review；用户的 Confirm 才提交 Idea Snapshot。与 Research Wiki 的边界保持一致：文学事实和证据由 Research Wiki 持有，Idea 只引用它们并保存用户研究决定。

## 21. 参考与使用边界

主要依据是用户此次提供的 Step 8 流程，保留“只汇总已确认对象 → freshness check → 逻辑链 → evidence audit → closest-work stress test → contribution discipline → evaluation alignment → scope review → 用户确认 Snapshot”的主线，并补充输入输出契约、Canvas Frame、审阅状态、版本、阻塞路径与存储建议。

本步骤不执行 LitPivot、ARIS 或 Harness 领域的真实检索，不把附件中的论文名称、方法名称或时间判断自动写成已验证事实。所有 Literature Position、Evidence Audit 与 Freshness Check 结果必须在实际运行时带来源、coverage、检查时间和未确定性。
