# CoResearch Step 4：Problem Formation / Problem Framing

- 日期：2026-09-17
- 状态：设计提案；本次不实现页面、Skill、服务或真实文献检索。
- 上游：[Step 3 · Direction Exploration](./03-direction-focus.md)。
- 关联：[Step 2 · Research Landscape](./02-research-landscape.md)、[Idea 结构设计](../idea-structure.md)。
- 下游：[Step 5 · Hypothesis / Explanation Formation](./05-hypothesis-formation.md)。
- 产品流程真值：[Research Flow](../research-flow.md)。Problem 来自用户保留的 Research Question Threads，不等于领域里存在的问题线索；Targeted Search 之后只能写 “No direct match identified in current search”，不能写 “No one has done this”。

## 1. Step 4 解决什么

**把用户确认的 Focus 转化为一个有依据、有边界、明确标注未确定性的 Research Problem，并逐项核查它依赖的文献判断。**

Step 3 保存“我想继续研究哪里”；Step 4 回答“这片范围内，究竟有什么具体困难值得研究，以及我们凭什么这样表述”。

```text
ConfirmedFocus
      ↓
查看当前 Problem Threads
      ↓
用户选择或描述真正关心的线程
      ↓
Problem Candidate
      ↓
拆分可核查的 Problem Claims
      ↓
复用已有证据 + 专项文献核查
      ↓
根据结果收窄、改写、回退或放弃候选
      ↓
确认研究意义与范围
      ↓
Confirmed Research Problem
```

Step 4 不选择解决方法，不设计实验，不承诺 contribution，也不对完整 Idea 作 novelty verdict。它只验证 Problem 的已知前提、现有能力边界和“当前仍解释不足”的范围。

## 2. 输入与输出

### 2.1 输入

沿用 Step 3 的完整交接：

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

服务验证 Focus 已确认、hash 匹配、固定的 Landscape revision 可读取。Step 4 同时读取用户原话、Focus 边界、来源路线、相关 Work/Question/Fragment、局部 Probe 的 coverage 和未完成核查。

输入 Focus 可以是 `mapped`、`partially_mapped` 或 `needs_verification`。后两种状态不会阻塞创建 Problem Candidate，但相关不确定性必须继承到候选及其 claim，不能在改写时消失。

### 2.2 输出

```ts
interface ConfirmedResearchProblem {
  schemaVersion: 1
  id: string
  projectId: string
  focusRef: { id: string; revision: number; contentHash: string }
  landscapeRef: LandscapeRef
  revision: number
  title: string
  statement: string
  knownContext: string
  insufficiency: string
  whyItMatters: string
  scope: ProblemScope
  claimRefs: ProblemClaimRef[]
  assessmentSummary: 'supported_for_formation' | 'contested' | 'inconclusive'
  remainingUncertainty: string[]
  provenance: ProblemProvenance[]
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

`supported_for_formation` 表示当前材料足以形成一个可继续研究的问题；它不表示 gap 已被穷尽证明，也不表示未来方法有创新性。

## 3. 首屏：Current Problem Threads

系统先展示与 Focus 直接相关的问题线程。线程来源包括 Step 2 已核查的 CurrentQuestion、Step 3 Probe 结果，以及从轨迹中推导但尚未验证的候选。

```text
STEP 4 · PROBLEM
Focus：连续 Harness 修改中的历史依赖
Landscape 截止日期 · Focus 定位状态 · 未完成核查

A · 更广泛的组件归因
已有：组件可观测性与消融
当前状态：部分处理
[来源] [继续调查]

B · 多 Edit 交互
多个修改同时存在时，如何理解单项与组合效应？
当前状态：需要专项核查
[为什么出现这个线程] [继续调查]

C · 历史依赖归因
同一 Edit 的作用是否依赖此前 Harness State？
当前状态：需要专项核查
[为什么出现这个线程] [继续调查]

[直接描述我想研究的问题]
```

Problem Thread 不是 Problem 本身。它保存来源、范围和当前核查状态：

```ts
interface ProblemThread {
  id: string
  focusId: string
  title: string
  description: string
  origin: 'landscape_question' | 'focus_probe' | 'trajectory_inference'
    | 'user_statement'
  sourceRefs: string[]
  status: 'supported_thread' | 'partially_addressed'
    | 'needs_verification' | 'contested'
  scope: string
}
```

从轨迹推导出的 B/C 必须标为 `trajectory_inference`。路线相邻、方法看起来缺一块或作者写了 future work，都不足以自动成为“当前问题”。

用户可以选择多个相互关联的线程。若线程属于两个独立问题，系统建立两个 Problem Candidate，不强行拼接。用户也可以退回 Step 3 修改 Focus。

## 4. 从线程形成 Problem Candidate

假设用户说明：

> 我关心的不是单个组件谁重要，而是一个 Edit 的作用会不会依赖之前发生的 Edit。

系统生成可编辑候选：

```text
PROBLEM CANDIDATE · 尚未验证

在持续演化的 Agent Harness 中，Skills、Tools 和 Memory
可能随着执行经验被连续修改。

已有工作提供了单次修改验证或组件级分析，
但当多个 Edits 发生交互，且后续 Edit 的效果依赖已有 Harness State 时，
整体性能变化或孤立消融是否足以解释改进来源，仍需核查。
```

候选必须使用校准语言。文献尚未确认 statefulness 时写“用户关注连续修改”；专项核查前写“是否足以”“仍需核查”，不能先写“现有方法无法”。

```ts
interface ProblemCandidate {
  id: string
  sessionId: string
  focusRef: FocusRef
  baseRevision: number
  statement: string
  threadIds: string[]
  claimIds: string[]
  whyItMattersDraft: string | null
  scopeDraft: ProblemScope
  status: 'draft' | 'verifying' | 'revising' | 'ready_for_confirmation'
    | 'substantially_addressed' | 'parked'
}
```

候选是用户研究状态；模型可以提出，不能自行标为 confirmed。

## 5. 将 Problem 拆成可核查 Claim

Problem Candidate 必须拆成最少、必要的 claim。claim 类型决定核查方式：

| 类型 | 例子 | 需要什么证据 |
|---|---|---|
| context | Harness 会连续更新，并保留状态 | 直接描述该过程的来源 |
| existing_capability | 已有组件级可观测性或消融 | 具体版本、机制与实验条件 |
| insufficiency | 某类现有评价在指定条件下不足 | 直接失败证据、明确边界或谨慎比较 |
| unresolvedness | 当前检索未发现直接处理该范围的工作 | 专项搜索、最近邻比较和 coverage |
| significance | 无法归因会导致什么研究或实践后果 | 文献证据与用户认可分别记录 |

```ts
interface ProblemClaim {
  id: string
  candidateId: string
  type: 'context' | 'existing_capability' | 'insufficiency'
    | 'unresolvedness' | 'significance'
  text: string
  scope: string
  origin: 'user' | 'agent' | 'literature'
  derivation: 'verbatim' | 'paraphrase' | 'inference'
  evidenceRefs: string[]
  assessmentId: string | null
}
```

“现有方法已做组件级归因”和“现有方法无法处理历史交互”是两个 claim，不能因前者成立就推导后者成立。“没有直接命中”和“已有方法不足”也不同：前者是检索结果，后者是方法比较判断。

significance 同样分两部分：文献是否报告实际后果，以及用户为什么愿意研究它。用户认可研究意义，不会把因果后果自动变成已证实事实。

## 6. 复用证据与专项核查

Step 4 先查固定 Landscape 和 FocusProbe，避免重复搜索。已存在的 Statement、Fragment、QuestionAssessment 和 Work 直接引用，不复制成新的文献事实。

只有关键 claim 缺证据、证据过期或范围不匹配时，创建 ProblemProbe：

```ts
interface ProblemProbe {
  id: string
  candidateId: string
  claimIds: string[]
  landscapeRef: LandscapeRef
  asOf: string
  queryPlan: Array<{ query: string; rationale: string }>
  budget: ProbeBudget
  status: 'queued' | 'running' | 'completed' | 'partial'
    | 'failed' | 'cancelled'
  coverageId: string | null
  resultId: string | null
}
```

Probe 针对 claim 生成多个查询表达，使用 Step 2 的 canonical resolution、版本绑定、原文阅读和后续核查能力。它至少检查：

1. 直接术语及其别名。
2. 不使用本项目术语、但机制等价的工作。
3. 最近邻方法的最新版本和后续研究。
4. 在 `asOf` 截止前的近期窗口。
5. 必要时检查邻近领域，但明确标为 analog，不冒充同一问题的 prior work。

搜索窗口按实际 `asOf` 和项目设置生成，不把“最近 3/6/12 个月”硬编码为充分条件。时间敏感结论记录 checkedAt、query、来源状态、语言/数据库范围、访问级别、停止原因和未解决标识。

## 7. Claim Assessment

每个 claim 独立评估：

```ts
interface ProblemClaimAssessment {
  id: string
  claimId: string
  asOf: string
  checkedAt: string
  status: 'supported' | 'partially_supported' | 'contested'
    | 'no_direct_match_in_search' | 'substantially_addressed'
    | 'needs_verification' | 'inconclusive'
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

状态解释：

- `supported`：有直接证据支持此 claim 的限定表述。
- `partially_supported`：部分范围有证据，Problem 必须保持对应限制。
- `contested`：存在实质冲突，不能只选有利证据。
- `no_direct_match_in_search`：本次检索未识别直接匹配；不能改写为“无人研究”。
- `substantially_addressed`：命名的已有工作直接覆盖了候选的中心范围。
- `needs_verification`：关键检索未完成或来源不可访问。
- `inconclusive`：完成了一定核查，但证据仍不足以作方向性判断。

Problem 的总体状态由 claim 组合得出，但页面必须保留逐项状态。一个关键 unresolvedness claim 为 `needs_verification` 时，不能用其他两个 supported claim 把总状态包装成“已验证”。

## 8. 检索结果如何改变 Candidate

### 8.1 找到直接覆盖

若命名的 Work 已直接处理中心问题：

```text
当前候选的中心范围已被直接覆盖
最接近工作：Paper X，Version Y
覆盖：连续 Edits / 历史依赖 / 组件交互

[查看原文与比较]
[从该工作的剩余边界继续收窄]
[返回其他 Problem Threads]
[暂存这个候选]
```

系统不会通过替换术语保住原候选。若 Paper X 的限制或适用条件形成新问题，只能建立新的 Problem Candidate，记录 `derivedFromCandidateId` 和来源证据。

### 8.2 只找到相邻工作

显示逐项对比：它覆盖什么、没有比较到什么、差异是否来自任务/机制/评价/时间尺度。候选可以收窄后继续；差异只是 Problem 边界，不自动成为 Method novelty。

### 8.3 没有直接命中

使用固定表述：

> 在本次记录的检索范围内，没有识别到直接覆盖这一问题范围的工作。已检查的最近邻工作覆盖了 X 和 Y；Z 仍需进一步核查。这不是不存在相关研究的证明。

状态为 `no_direct_match_in_search` 或 `needs_verification`，取决于 coverage。禁止显示 Gap Confirmed。

### 8.4 证据冲突或核查失败

保留 contested / inconclusive / partial。用户可以继续形成一个明确标注争议的 Problem，或补充搜索、收窄范围、返回 Step 3。失败不丢失 Candidate 和用户选择。

## 9. Why It Matters

文献核查后，系统请用户选择、编辑或自行说明研究意义。候选可以包括：降低盲目搜索成本、避免保留只在特殊历史状态下有效的 Edit、改善迁移判断或提升解释可靠性。

系统必须标出每项意义的来源：

- `literature_supported`：已有工作直接报告后果。
- `user_motivation`：用户认为值得研究。
- `agent_inference`：系统推导，待用户审阅。

```ts
interface ProblemSignificance {
  statement: string
  origin: 'user' | 'agent' | 'literature'
  evidenceRefs: string[]
  adoption: 'draft' | 'confirmed'
}
```

用户确认 whyItMatters 代表认同研究动机，不代表其影响规模已被实验验证。

## 10. Scope 与边界

ProblemScope 使用明确的 included / deferred / unresolved，避免把未选择项误写为排除：

```ts
interface ProblemScope {
  included: ScopeItem[]
  deferred: ScopeItem[]
  excluded: ScopeItem[]
  unresolved: ScopeItem[]
  unitOfAnalysis: string | null
  temporalSetting: string | null
  targetContext: string | null
}
```

- included：本 Problem 正式覆盖。
- deferred：相关但本轮暂不研究，未来可以重开。
- excluded：用户明确认为不属于该 Problem。
- unresolved：尚未决定，不能悄悄放入 included。

例如 Skills、Tools、Memory 和 sequential edits 可以 included；forgetting、tampering、benefit mismatch 可 deferred。Control Logic 若用户没确认则 unresolved，不自动加入。

Scope 还需尽可能明确分析单位：单个 Edit、组件、Edit bundle、状态转移或完整 Harness 版本。如果尚不清楚，保留 unresolved，并在 Step 5 继续澄清；不能编造精确边界只为通过 Gate。

## 11. 最终 Problem Statement

当主要 claim 已核查、意义和范围由用户审阅后，系统生成最终草稿。建议结构：

```text
Known context
在什么范围内，已有研究能够做到什么。

Observed insufficiency
在什么具体条件下，仍缺少何种解释、比较或能力。

Consequence
为什么这个不足会阻碍理解或实践。

Boundary
本 Problem 包含和暂缓哪些对象。
```

示例：

> 现有工作能够验证单次 Harness 修改，并在部分设置中比较组件贡献。对于持续演化、连续修改 Skills、Tools 与 Memory 的 Harness，一个 Edit 的作用可能随已有状态及其他 Edits 而变化。在当前检索范围内，尚未识别到直接解释这类历史依赖交互的工作，因此整体性能或孤立消融是否足以归因仍待研究。若无法区分这些效应，Harness 演化可能退化为难以解释的反复试错。本 Problem 暂不覆盖模型训练、tampering 和长期遗忘。

示例中的文献判断必须由真实 Probe 结果填充；设计文档中的文本不能直接导入产品为 confirmed Problem。

最终卡片分开显示：

```text
WHAT WE KNOW                 已有证据支持的上下文
WHAT REMAINS UNCERTAIN       不足 claim 及检索状态
WHY IT MATTERS               用户确认的研究意义
SCOPE                        Included / Deferred / Unresolved
EVIDENCE & COVERAGE          来源、截止日期、失败项

[追问文献] [编辑 Problem] [确认 Problem →]
```

## 12. 用户追问与迭代

用户可以追问“为什么孤立消融不够”“邻近领域如何做顺序归因”“是否有直接反例”。系统先回答现有快照；需要新证据时，经用户发起 ProblemProbe。

Probe 返回后：

1. 追加新的 Assessment，不覆盖旧评估。
2. 标记受影响的 Candidate revision。
3. 展示 Problem statement 的建议改动。
4. 用户决定接受、编辑、忽略或暂存。

新文献不会自动撤销用户已确认的 Problem，而会让其 assessment 变为 stale / challenged。重新确认时创建新 revision，旧版本保持可追溯。

## 13. 用户确认规则

| 操作 | 含义 |
|---|---|
| 选择 Problem Thread | 表达关注，不确认 Problem |
| 生成 Candidate | Agent 提案，状态为 draft |
| 运行 Probe | 核查 claim，不确认用户立场 |
| 选择研究意义 | 写入 draft，系统整理仍需审阅 |
| 编辑范围 | 更新 Candidate revision |
| 点击 Confirm Problem / 明确认可全文 | 确认当前 contentHash |

用户确认只表示“这是我准备继续研究的 Problem 表述”。它不表示文献穷尽、novelty 已证明或所提机制成立。

确认后编辑创建新 draft revision。系统增加新的 claim、扩大 included 范围或改变 whyItMatters 时，旧确认不能沿用。

## 14. 完成 Gate

Step 4 完成需要：

1. Problem statement 明确，并能区分已知上下文与待研究不足。
2. 关键 context / existing capability claim 有可定位证据。
3. 中心 insufficiency / unresolvedness claim 已进行有记录的专项核查。
4. 最近邻工作逐项说明重叠与差异。
5. coverage、asOf、失败来源和剩余不确定性可见。
6. whyItMatters 由用户认可。
7. included、deferred 与 unresolved 范围清楚。
8. 用户确认当前内容 hash。

允许 `no_direct_match_in_search`、`contested` 或 `inconclusive` 的 Problem 进入 Step 5，但总体状态和未确定性必须随交接保留。若中心问题已 `substantially_addressed`，原 Candidate 不能直接确认；用户需收窄、重构、选择其他线程或显式保存为“复现/扩展已有问题”的 Problem。

不要求已形成 Hypothesis、Method、Contribution、Experiment，也不要求完整 Idea novelty 已通过。

## 15. Step 4 → Step 5 交接

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

Step 5 接收 Problem 原文、claim 拆解、已有证据、最近邻比较、范围与剩余不确定性，不能只收到一段去掉出处的 summary。

Step 5 负责提出和比较“为什么出现这个问题”的解释或可证伪假设。它不能把 Step 4 的 `no_direct_match_in_search` 改写为 confirmed novelty，也不能跳过 unresolved scope 直接设计复杂方法。

交接验证 Problem confirmed、hash 匹配、引用可读取。相同 requestId 幂等，返回 hypothesisFormationSessionId。

## 16. 状态、版本与存储

```ts
interface ProblemFormationSession {
  id: string
  projectId: string
  focusRef: FocusRef
  landscapeRef: LandscapeRef
  status: 'reviewing_threads' | 'drafting' | 'verifying'
    | 'revising' | 'problem_ready' | 'problem_confirmed' | 'parked'
  candidateIds: string[]
  activeCandidateId: string | null
  confirmedProblemId: string | null
  probeIds: string[]
  createdAt: string
  updatedAt: string
}
```

目标目录：

```text
research/problems/<problem-id>/
├── manifest.json
├── drafts/<revision>.json
├── confirmed/<revision>.json
├── claims/<claim-id>.json
├── assessments/<assessment-id>.json
├── decisions/<decision-id>.json
└── views/<revision>/problem.md

research/problem-formation/<session-id>/
├── state.json
├── threads/<thread-id>.json
└── probes/<probe-id>.json
```

Work、Version、Fragment 与文献 Question 继续由 Research Wiki 保存。Problem 引用这些对象，不复制第二份可编辑事实。Problem、Scope、用户动机和确认属于用户研究状态；运行 trace 属于 `.coresearch/`；页面是可重建投影。

正式确认使用不可变快照、contentHash 和 requestId。重复点击只产生一个提交。Probe 完成、领域记录写入和投影生成需要可恢复的提交协议；投影失败不能丢失 Problem 或 Assessment。

## 17. Skill 与服务边界

未来的 problem-framing Skill 可协调：

- list_problem_threads：读取 Focus 相关问题线程。
- draft_problem：整理一个或多个 Candidate。
- decompose_claims：拆出最少必要 claim。
- inspect_evidence：读取固定快照中的现有证据。
- probe_problem_claim：发起专项核查。
- revise_problem：根据评估生成可审阅修改。
- confirm_problem：由领域服务校验用户动作后提交。

Searcher、Resolver、Reader 与 temporal verification 复用 Step 2 服务。Agent 负责建议和解释；服务负责版本、校验、幂等和提交；用户负责确认 Problem。

## 18. Golden Path 示例

以下是合成示例，不表示当前用户已确认该 Problem，也不表示示例论文覆盖已被本次验证。

```text
Confirmed Focus
连续 Harness 修改中的历史依赖

→ 展示问题线程
B 多 Edit 交互
C 历史依赖归因

→ 用户选择 B+C，并解释真正关注点

→ Problem Candidate
连续多组件修改时，单项作用是否依赖历史状态？

→ Claim 拆解
A Harness 更新具有顺序状态
B 已有单 Edit / 组件级分析
C 历史依赖交互是否仍未充分处理

→ 复用 A/B 的已有证据，对 C 做 ProblemProbe

→ 根据真实结果：
直接覆盖则回退或收窄；
相邻覆盖则限定差异；
未直接命中则保留校准措辞和 coverage。

→ 用户确认 whyItMatters 与 Scope

→ Confirmed Research Problem

→ Step 5 提出解释和假设
```

## 19. 验收场景

| 场景 | 应满足的不变量 |
|---|---|
| trajectory inference 产生线程 | 标 needs_verification，不标 open gap |
| 用户选择两个线程 | 只有逻辑相连时合并，否则建立两个 Candidate |
| 已有事实有旧证据 | 复用固定来源，不重复生成文本事实 |
| 同一 Work 有多个版本 | 核查最新适用版本，历史引用不丢失 |
| 找到直接覆盖的论文 | 命名并展示覆盖范围，原 Candidate 不直接确认 |
| 搜索未命中 | no_direct_match_in_search，不写“无人研究” |
| 关键来源限流 | needs_verification / partial，显示失败来源 |
| 最近邻只覆盖部分条件 | 收窄 Problem 或标 partially_supported |
| 用户认可 whyItMatters | 只确认研究动机，不证明后果规模 |
| 未提到 Control Logic | 保持 unresolved，不加入 included |
| Probe 后新证据改变判断 | 追加 Assessment，建议新 Candidate revision |
| 重复确认 | 只产生一个 confirmed 快照 |
| Step 5 接收 | 同时得到 claims、证据、coverage 与未决项 |

完成标准：用户能解释“哪些是已知事实、哪里具体不足、这一判断查过什么、为什么值得研究，以及本问题覆盖到哪里”。

## 20. 与现有设计的衔接

本设计实现 [Step 3](./03-direction-focus.md) 定义的 `ProblemFormationRequest`，并将 Focus 的兴趣定位转化为可核查的 Problem Candidate。Step 3 的局部 Probe 仍可复用；Step 4 新增的 ProblemProbe 针对 Problem claim，而不是重新构建整张 Landscape。

它也细化 [Idea 结构设计](../idea-structure.md) 中 problem 与 why_unsolved 的关系：Step 4 先保存问题陈述、已知能力边界和不足评估；更深入的机制解释与 Hypothesis 留给 Step 5。后续 Idea 可以引用 ConfirmedResearchProblem，不再复制一份独立可编辑的 problem 字段真值。

## 21. 参考与使用边界

主要依据是用户此次提供的 Step 4 流程。本文保留“Problem Threads → Candidate → Claims → Targeted Search → Why It Matters → Scope → Confirm”的主线，并补充 claim 类型、核查状态、失败路径、版本和交接契约。

本地 [ARIS novelty-check](../../../references/Auto-claude-code-research-in-sleep/skills/novelty-check/SKILL.md) 将方法描述拆成核心 claims，并逐项检索 closest prior work。本文只借鉴 claim 分解与最近邻比较；Step 4 评估 Problem 是否在限定范围内成立，不执行该 Skill 的方法 novelty verdict、分数或自动推进指令。

本文没有验证 LitPivot 的研究结论，也没有执行 harness 领域检索。AHE、GSME、HCL 等案例名称与机制只能在真实 Step 2/4 取得版本化原文证据后进入产品状态。
