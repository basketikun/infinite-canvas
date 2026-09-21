# CoResearch Research Flow

- 日期：2026-09-18
- 状态：产品流程真值。本文记录已拍板的 Research Flow、人机边界和 Canvas 承诺规则。
- 范围：从模糊研究兴趣到可版本化的 Idea V1，以及此后的文献刷新循环。本次不实现页面、Skill 或检索。
- 下游分步契约见 [idea-formation/](./idea-formation/README.md)；若与本文冲突，以本文为准，分步文档待回写。
- 关联：[Idea 结构设计](./idea-structure.md)、[空间设计](./space.md)、[研究画布](./canvas/research-canvas.md)、[Huabu 领域映射](./canvas/huabu-domain-binding.md)。

下文的 Agent Harness 例子只用于说明流程，不表示当前用户已确认该研究方向。

## 1. 产品原则

CoResearch 不是「Agent 自动帮用户生成一个 Idea」。

> **Agent 持续探索、提出候选、解释文献；用户负责确认、保留、组合和推进。Canvas 只保存用户认为值得留下的研究对象。**

压成一句：

> **Agent 负责扩大可能性空间、寻找证据和提出候选；用户通过对话、选择和拖拽不断缩小空间；Canvas 记录用户已经认可的研究状态；文献持续反过来推动这些状态更新。**

这是 CoResearch 与普通 Deep Research、Paper Search、AI Idea Generator 的分界。系统不替用户决定研究什么，也不把未确认的推荐写成研究事实。

## 2. 两条并行通道

流程中的每一步都同时走两条通道，而不是先聊完再画一张图。

```text
Agent Conversation
负责：探索 / 推荐 / 搜索 / 解释 / 比较 / 挑战 / 验证

Canvas
负责：保存 / 组织 / 连接 / 版本化 / 显示用户已经认可的研究对象
```

| 通道 | 产品角色 | 里面可以出现什么 | 不构成什么 |
|---|---|---|---|
| Conversation | Exploration Space | 候选方向、临时解释、检索结果、比较、挑战、未确认综述 | 已认可的研究对象 |
| Canvas | Commitment Space | 用户拖入、保存或确认过的对象及其关系、版本 | Agent 刚提出的全部候选 |

```text
Conversation = Exploration Space
Canvas       = Commitment Space
```

对话里的卡片可以很多、可以丢弃、可以再找一批。只有进入 Canvas 的对象才成为正式 Research Object。画布不是聊天记录的镜像，也不是 Agent 工作区。

## 3. Candidate 与 Canvas Node

同一类对象在两条通道里身份不同：

```text
Agent Candidate     = Agent 提议，status = proposed
Canvas Research Object = 用户认为值得保留，status = saved 或更高
```

用户把 Conversation 中的候选拖入 Canvas（或等价的保存动作）后，才创建对应的领域对象，并投影为画布节点。忽略、关闭、换一批，都不会留下正式对象。

| 动作 | 结果 |
|---|---|
| 感兴趣，拖入 Canvas | 创建 saved 对象 |
| 想了解更多 | 留在 Conversation 中追问 |
| 不感兴趣 | 忽略，不写 Canvas |
| 都不满意 | 让 Agent 再找别的 |
| 想更偏理论 / evaluation | Agent 调整搜索，仍先出 Candidate |

「选中深入」是比「保存」更强的用户决定。用户可以同时保存多条 Direction，但一次 Deep Dive 只针对用户指定要深入的那一条。

## 4. 完整流程

```text
Research Interest
      ↓
1. Seed Framing
      ↓
2. Direction Exploration
      ↓
3. Direction Deep Dive
      ↓
4. Research Question Selection
      ↓
5. Problem Formation
      ↓
6. Hypothesis Formation
      ↓
7. Approach Selection
      ↓
8. Method & Evaluation Co-Design
      ↓
9. Idea Synthesis
      ↓
10. Idea Review
      ↓
Idea V1
      ↺
11. Literature Refresh / Revision
```

这是初次形成 Idea 的导航顺序，不是单向 Wizard。任何一步被新文献或用户改口挑战后，都可以回到对应对象修改，并生成新的 revision。完成条件是该步的 Exit Gate，不是 Agent 穷尽搜索。

产品总图：

```text
USER
“我想研究 Agent Harness 自进化”
                 │
                 ▼

          🌱 SEED FRAMING
        用户确认研究兴趣
                 │
                 ▼

       DIRECTION EXPLORATION
                 │
       Agent 推荐 Direction
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼

 Candidate   Candidate   Candidate
 Direction   Direction   Direction

      │
      │ 用户感兴趣
      │ Drag to Canvas
      ▼

        SAVED DIRECTIONS

      │ 用户确认深入
      ▼

       DIRECTION DEEP DIVE
      ────────────────────
      Research Questions
      Methods
      Evaluation
      Papers
      Findings
      Limitations
      Phases
      Frontier
      ────────────────────
                 │
                 ▼

      RESEARCH QUESTION THREADS

        RQ1    RQ2    RQ3

                 │
         用户选择 / 组合
                 ▼

              PROBLEM
                 │
                 ▼
            HYPOTHESIS
                 │
                 ▼
             APPROACH
                 │
                 ▼

       METHOD ↔ EVALUATION
                 │
                 ▼

             ✦ IDEA V1
                 │
                 ▼

              REVIEW
                 │
          ┌──────┴──────┐
          │             │
       保持当前       修改部分
          │             │
          └──────┬──────┘
                 ▼

             IDEA V2
                 │
                 ↺
        LITERATURE REFRESH
```

## 5. Canvas 的三层

画布最终同时承担三种阅读层次。它们可以同时存在于同一张 Space，不必做成三个产品。

### 5.1 Exploration：我在哪个研究空间里？

```text
Seed
Directions
Papers
Questions
```

### 5.2 Reasoning：我的研究逻辑是什么？

```text
Problem
Hypothesis
Approach
Method
Evaluation
```

### 5.3 Synthesis：我现在形成了什么研究 Idea？

```text
Idea Summary
Review
Versions
```

Frame 只组织视图。把 Paper 拖进 Method Frame，不会把 Paper 改成 Method，也不会自动写成「借用了该方法」。

## 6. 各步

### 0. Research Interest

用户可以非常模糊：

> 我想研究 agent harness 自进化。

系统只需要理解「用户现在大概对什么感兴趣」。不要在这一刻要求填写：

```text
Research Gap
Method
Hypothesis
Contribution
Evaluation
```

原始输入原样保存。尚未形成 Seed，也没有 Idea。

### 1. Seed Framing

**目标**：把模糊兴趣变成一个足以启动文献探索、又没有过早限制方向的研究 Seed。

Agent 只做轻量语义澄清，例如：

```text
“Agent Harness 自进化”可能有几种理解：

A. 自动优化 Harness
B. 根据任务经验持续修改 Harness
C. 长期 Continual Evolution
D. Self-improving Agent Infrastructure

你更接近哪一种？
```

这些选项是对原话的理解候选，不是文献发现的 Research Direction。用户可以多选、组合或直接自由输入。输入已经足够清楚时，跳过选择题，直接给出可确认的 Seed。

用户确认后形成：

```text
🌱 SEED · confirmed

Agent Harness 自进化

探索 Agent 如何根据自身运行过程、
反馈和经验持续修改其运行 Harness。
```

Seed **不包含** Direction，也不包含：

```text
Skills / Tools / Memory
Gap
Method
Novelty
Evaluation
```

组件范围、方法路线和创新点都还太早。用户后来若主动补了组件，那是后续对象的内容，不是把 Seed 升级成研究问题。

Seed Detail 只保留：

```text
原始输入
当前主题理解
相关概念
版本历史
确认状态
```

例如：

```text
原始输入
“我想研究 agent harness 自进化”

当前主题理解
探索 Agent 如何根据自身运行过程、
反馈和经验持续修改其运行 Harness。

相关概念
agent harness
self-evolving agent
self-improving agent
harness optimization

状态
✓ 用户已确认
```

检索用的 SearchBrief 可以从已确认 Seed 派生，但它是检索工件，不是 Seed 正文，也不进入已确认概念。

**Exit Gate**：用户确认 `Seed = confirmed`。未确认不进入 Direction Exploration，也不把整理文案标成已确认。

### 2. Direction Exploration

Seed 之后的第一轮文献探索。核心问题：

> 围绕这个 Seed，目前有哪些值得继续看的研究方向？

Agent 流水线：

```text
Seed
↓
search planning
↓
paper retrieval
↓
canonicalize / dedup
↓
rough clustering
↓
Direction candidates
```

这一步做的是粗聚类和差异化推荐，不是把整个领域的研究脉络重建出来。完整脉络属于下一步 Deep Dive。

Direction Candidate **首先只存在于 Conversation**：

```text
我先找到几条比较不同的研究路线：

┌─────────────────────────────┐
│ DIRECTION                   │
│ Automatic Harness Evolution │
│                             │
│ 如何让 Agent 自动发现       │
│ Harness 弱点并提出修改？    │
│                             │
│ 4 related works             │
│                       ⠿ Drag│
└─────────────────────────────┘

┌─────────────────────────────┐
│ DIRECTION                   │
│ Credit & Attribution        │
│                             │
│ Harness 发生变化后，        │
│ 如何知道哪个 Edit 真正有效？│
│                             │
│ 5 related works             │
│                       ⠿ Drag│
└─────────────────────────────┘
```

用户在这一阶段不是「选一个然后结束」，而是持续探索：感兴趣则拖入 Canvas，想了解则追问，不满意则再找，想偏理论或 evaluation 则让 Agent 改搜索。

Canvas 此时可以是：

```text
             🌱 Seed
          Agent Harness
               │
       ┌───────┼────────┐
       ▼       ▼        ▼

 Direction  Direction  Direction
 Credit     Continual  Integrity
```

用户可以同时保存多个 Direction。保存不等于选中深入。

**Exit Gate**：用户发现至少一个自己真正想深入理解的 Direction，并明确指定深入。例如：

> 我对 Credit & Attribution 最感兴趣。

此时该 Direction 进入 `selected_for_deep_dive`。结束条件不是 Agent 找完所有方向。

### 3. Direction Deep Dive

CoResearch 最重要的中间阶段之一。它不是「再推荐几篇论文」，而是：

> 把这一条 Direction 的完整研究脉络重建出来。

对 `Credit & Attribution` 这类方向，系统要回答：

```text
这个方向为什么出现？
最早在解决什么问题？
经历了哪些阶段？
每个阶段有哪些主流 Methods？
这些 Methods 怎么评估？
哪些论文是 Milestone？
每一阶段解决了什么？
又留下了什么问题？
现在发展到什么 Frontier？
```

研究脉络不是论文链表：

```text
Paper A → Paper B → Paper C
```

而是证据支撑下的问题—方法—评价循环：

```text
Research Question
        ↓
Method Families
        ↓
Evaluation Paradigm
        ↓
Results / Findings
        ↓
Limitations
        ↓
Next Research Question
```

论文是这些变化的证据，不是脉络本身。

每一个 Phase 应包含 Research Question、Methods、Evaluation、Representative Papers、Capabilities、Limitations。例如：

```text
PHASE 2
Component-level Attribution

Research Question
如何判断哪个 Harness Component 真正产生贡献？

Methods
• Ablation
• Observability
• Component-wise comparison

Evaluation
• Ablation Delta
• Contribution Score
• Attribution Fidelity

Representative Papers
AHE
Paper B
Paper C

Capabilities
✓ 可以分析 Component-level effect

Limitations
× Multi-component interaction 不清楚
× Context dependence 没有充分处理
```

最终应能并排看到多轨脉络，而不是一条必然进步的直线：

```text
TIME ─────────────────────────────────────→

Research Questions
整体是否提升 → 哪个 Component 有贡献 → 哪个 Edit 有贡献
→ 连续 Edit 如何归因 → History / Interaction Effects

Methods
Aggregate Evaluation → Component Ablation → Edit Verification
→ Continual State Tracking → Interaction-aware Attribution

Evaluation
Task Score → Ablation Delta → Credit Reliability
→ Retention / Forgetting → Attribution Fidelity

Papers
Paper A → AHE → HarnessBank → HCL → Recent Frontier
```

Canvas 建议：

```text
Direction = Frame
Phase     = Frame
Paper     = PaperSummary Node
Research Question = ResearchQuestion Node
```

```text
┌──────────── Credit & Attribution ─────────────┐

 Phase 1
 ┌─────────────┐
 │ Paper A     │
 │ Paper B     │
 └─────────────┘
      ↓
 Research Question
 “如何知道某个 component 是否真的有贡献？”

      ↓

 Phase 2
 ┌─────────────┐
 │ AHE         │
 │ Paper C     │
 └─────────────┘
      ↓
 Research Question
 “多个 edit 是否会产生 interaction？”

      ↓

 Current Frontier
 Paper D
 Paper E

 Research Question
 “Edit effect 是否依赖 prior harness state？”

└───────────────────────────────────────────────┘
```

**最终产物**不是一份综述文本，而是 Direction Dossier：

```text
Direction Overview
Origin
Research Phases
Research Questions
Method Families
Evaluation Paradigms
Milestone Papers
Capabilities
Limitations
Branches
Current Frontier
Latest Verification
```

路线标题、阶段划分和综合解释是系统综合，必须带来源与覆盖状态；证据不足时标为待核查，不补造起源或演化链。

**Exit Gate**：该 Direction 已形成可阅读的 Dossier，且用户开始面对其中的问题线索。用户也可以先保存 Dossier、稍后再选问题。

### 4. Research Question Selection

Deep Dive 完成后，用户真正开始面对：

> 这里面什么问题最吸引我？

系统可能已经识别出多条问题线索，例如：

```text
RQ1  如何可靠估计单个 Edit 的贡献？
RQ2  多个 Edit 是否存在 Interaction？
RQ3  Edit Effect 是否依赖 Prior State？
RQ4  Good Harness Update 是否真的被 Agent 利用？
RQ5  Continual Evolution 中如何避免 Forgetting？
```

这些问题首先是领域里存在的线索，不是用户已经决定要研究的 Problem。用户继续通过 Agent 探索区别、已有工作、最近文献，或把线索合起来理解。

感兴趣的 Research Question 保存到 Canvas：

```text
Direction
   │
   ├── RQ2 Multi-edit Interaction
   └── RQ3 History Dependence
```

Research Question 自己带状态，描述文献相对于该问题的当前位置：

```text
needs_verification
active
partially_addressed
addressed
superseded
inconclusive
```

不要随便显示 `Open Gap ✓`。没有经过针对该问题的核查，就不能把线索升级成空白。

**Exit Gate**：用户已有 1–3 个明确感兴趣的 Research Question Threads，并且这些线程的文献状态已经得到一定验证。然后进入 Problem Formation。

### 5. Problem Formation

Research Question 回答「这个领域存在什么问题」。Problem 回答「我决定研究什么问题」。两者不是同一对象。

Agent 从用户保留的 Question Threads 中帮助形成 Problem。例如用户保留了 RQ2 与 RQ3 后：

```text
PROBLEM

现有 Harness Attribution 机制
可能不足以解释 Sequential Harness Edits 中
由 Component Interaction 和 Prior State
共同产生的性能变化。
```

Problem 必须包含：

```text
Problem Statement
Why It Matters
Derived From
Scope
Evidence Status
Latest Verification
```

从「我觉得这里有问题」到「这个问题值得研究」，Agent 必须再做一次 Targeted Search，检查：

```text
有没有直接相关工作？
有没有最近刚解决的工作？
这个问题是完全没做，还是只做了一部分？
```

最后只能说：

```text
No direct match identified in current search
```

不能说：

```text
No one has done this
```

未找到直接匹配，只说明当前检索范围内没有直接对应工作。它不是全局首创证明，也不能自动写成 Novelty。

**Exit Gate**：用户确认 Problem；其 Derived From、Scope 和 Evidence Status 一并可见。未确认前不进入 Hypothesis。

### 6. Hypothesis Formation

确认 Problem 后，下一步不是马上设计方法，而是：

> 为什么这个 Problem 会发生？

例如：

```text
HYPOTHESIS

Harness Edit 的效果不是固定的，
它依赖：

1. 当前活跃的其他 Components
2. Prior Harness State
3. Edit Sequence
```

Hypothesis 要有 Mechanism、Predictions、Falsifiers：

```text
Prediction 1
同一个 Edit + 不同 Prior State → 不同效果

Prediction 2
A → B  ≠  B → A
```

没有可证伪预测，就还不能选 Approach。Hypothesis 不能只是把 Problem 换一种说法，也不能用方法名称充当机制。

**Exit Gate**：用户确认至少一套带预测和证伪条件的 Hypothesis。

### 7. Approach Selection

Hypothesis 确认后：

> 要用什么总体研究机制去检验它？

Agent 提出多个候选 Approach，用户选择、改写或组合。和 Direction Exploration 一样：Agent 提候选，用户选。

```text
A  Full Factorial Replay
B  Edit Lineage + Targeted Replay
C  Learned Interaction Estimator
D  Bundle-level Attribution
```

最终例如：

```text
APPROACH

Explicit Edit Lineage
+
Targeted Counterfactual Replay
```

Approach 是总体检验策略，还不是可实现的 Method 细节，也不是实验计划。

**Exit Gate**：用户确认主 Approach。被拒绝的候选可留在 Conversation 或作为未采纳提案，不写进已确认 Approach。

### 8. Method & Evaluation Co-Design

这一步同时设计「方法怎么实现」和「怎么证明它」。不是先做完 Method，最后再想 Evaluation。

```text
Claim
↕
Method
↕
Evaluation
```

Method 例如：

```text
METHOD

Typed Edit Event
↓
Harness State Lineage
↓
Interaction Screening
↓
Targeted Counterfactual Replay
↓
Effect Estimation
```

Agent 同时做 Literature Method Search：

```text
哪些机制已经有人用过？
哪些可以直接借鉴？
哪些地方才是当前 proposed difference？
```

```text
AHE            → Edit Observability
HarnessBank    → Verification
HCL            → Sequential State
Current proposal → History-aware interaction attribution
```

目的是防止把已有机制包装成 novelty。

Evaluation 同时形成 Primary / Secondary，以及 Claim ↔ Evaluation：

```text
Primary     Attribution Fidelity, Replay Efficiency
Secondary   Robustness, Downstream Harness Utility

C1 捕获 Path Dependence  → Attribution Fidelity
C2 识别 Interaction      → Interaction Accuracy
C3 减少 Replay           → Replay Efficiency
```

这一步仍然不是完整实验计划。不要在这里决定具体数据集、样本数、随机种子、threshold、run order、GPU 数量。那些属于之后的 Experiment Planning。

**Exit Gate**：用户确认 Method 组成、Claims 和 Evaluation 对齐关系。具体实验协议仍保持未定。

### 9. Idea Synthesis

到这里系统已经有：

```text
Problem
Hypothesis
Approach
Method
Evaluation
Literature Position
```

这时才生成 Idea Summary。它不是 Agent「创造一个新 Idea」，而是：

> 把用户之前确认过的研究对象综合成当前 Idea。

```text
IDEA V1

面向持续演化 Agent Harness 的
历史依赖交互归因
```

Canvas 上的 Idea Node 引用已确认对象，不另存一份可脱离原对象编辑的第二份事实：

```text
✦ IDEA · V1

History-aware Interaction Attribution
for Continually Evolving Agent Harnesses

Problem
History-dependent attribution

Hypothesis
Context + path dependence

Method
Edit Lineage + Targeted Replay

Evaluation
Fidelity + Efficiency
```

Agent 不能在 synthesis 阶段凭空增加新的核心 Problem、Hypothesis 或 Method。发现缺口时只能提出 Review Comment、Open Question，或请用户回到上游步骤。

**Exit Gate**：已有一份可审阅的 Idea draft / snapshot，进入 Review。用户尚未确认 Idea。

### 10. Idea Review

Idea 形成以后必须 Review。Agent 再做一次最新 Literature Sweep，然后检查：

```text
Problem → Hypothesis     是否成立？
Hypothesis → Method      是否真的能检验？
Method → Evaluation      评价是否覆盖 Claim？
Closest Work             有没有真正比较？
Contribution             是否把已有工作包装成自己的？
Scope                    是不是越来越大？
```

Review 不是打分。不要：

```text
Novelty 9.1/10
Feasibility 8.7/10
```

而应该：

```text
Logic Chain            ✓
Literature Position    ◐ Needs more verification
Evaluation Alignment   ✓
Scope                  ✓
Open Risks             2
```

Review Comment 必须可由用户处置：

```text
“causal attribution” 这个表述可能过强。

建议：改成 interaction effect estimation。

[接受] [编辑] [拒绝]
```

只有用户确认后，才更新 Idea。Keep 画布变更 ≠ 确认研究表述。

**Exit Gate**：用户确认当前 Idea Snapshot（可带仍须核查的标记）。`confirmed` 表示用户认可这一版表达、范围和当前定位，不表示 Novel Idea 已证明，也不冻结后续文献更新。

### 11. Idea Versioning

Research Idea 不应该只有一个最终版本。

```text
Idea V1
↓
读到新论文
↓
Problem 被挑战
↓
Method 调整
↓
Idea V2
↓
进一步验证
↓
Idea V3
```

整个系统实际是循环：

```text
Literature
↕
Direction
↕
Research Question
↕
Problem
↕
Hypothesis
↕
Method
↕
Idea
```

新文献或用户改口挑战某个对象时，打开对应步骤，创建新 draft / revision；旧确认快照保持可追溯。不把旧结果静默改写成新范围的结论。

## 7. 对象生命周期

跨步骤共用同一套身份升级，不按步骤各发明一套状态机。

```text
proposed   Agent 或系统提出，只在 Conversation
saved      用户拖入或保存到 Canvas，成为 Research Object
selected   用户指定为当前深入 / 组合对象
confirmed  用户确认某一具体 revision
superseded 被更新版本或新决定替代
```

不是每类对象都走完全部状态。Direction 常经过 proposed → saved → selected_for_deep_dive；Problem / Hypothesis / Approach / Method / Idea 需要 confirmed 才能作为下游输入。

三类判断始终分开：

| 判断 | 含义 | 谁能决定 |
|---|---|---|
| 用户是否认可表述 | 这确实是我想保留 / 研究的 | 用户 |
| 文献当前怎么评价它 | 支持、部分覆盖、争议、证据不足 | 有出处的审阅记录 |
| 实验或验证结果如何 | 在指定协议下得到什么观测 | 绑定协议的结果记录 |

确认不等于证实。未找到直接匹配不等于无人做过。负结果不等于对象应自动删除。

## 8. 人机边界

| 角色 | 做 | 不做 |
|---|---|---|
| Agent | 搜索、聚类、解释、比较、提出候选、指出风险、做针对性核查 | 替用户选择方向、确认 Idea、把候选写成已认可对象、宣布全局首创 |
| 用户 | 追问、忽略、保存、组合、确认、接受/编辑/拒绝 Review | 被要求在 Seed 阶段填完整 Idea 问卷 |
| Canvas | 记录已认可对象、组织关系、版本化、显示三层阅读 | 自动镜像 Conversation 里的全部候选 |
| 文献刷新 | 挑战已确认对象、触发新 draft | 静默改写旧确认快照 |

拖入 Canvas 是承诺手势：它表示「值得留下」，还不是「这就是最终 Idea」。最终 Idea 只综合用户确认过的 Reasoning 层对象。

## 9. 与现有分步文档的关系

本文是产品流程真值。[idea-formation/](./idea-formation/README.md) 编号文档仍保存实现级契约（输入输出、Gate、revision、检索约束）。两者冲突时先按本文，再回写分步文档。

| 本文步骤 | 现有文档 | 需要回写的要点 |
|---|---|---|
| 0 Research Interest | 含在 [01-seed.md](./idea-formation/01-seed.md) 输入段 | 保持「先保存原话，不创建 Idea」 |
| 1 Seed Framing | [01-seed.md](./idea-formation/01-seed.md) | Seed 更薄：确认内容不含 Skills/Tools/Memory、Direction、Gap、Method；SearchBrief 降为派生检索工件 |
| 2 Direction Exploration | [03-direction-focus.md](./idea-formation/03-direction-focus.md) | 提到 Deep Dive **之前**；候选先活在 Conversation，保存进 Canvas 才成为对象；结束条件是「至少一个想深入的 Direction」，不是确认最终 Focus |
| 3 Direction Deep Dive | [02-research-landscape.md](./idea-formation/02-research-landscape.md) | 从「先建全领域 Landscape」改为「对用户选中的 Direction 重建脉络」；产物是 Direction Dossier |
| 4 Research Question Selection | 散落在 02 / 03 / 04 | 独立成步；RQ 有自身状态，禁止随手标记 Open Gap |
| 5 Problem Formation | [04-problem-formation.md](./idea-formation/04-problem-formation.md) | 强调 RQ ≠ Problem；必须 Targeted Search；禁止「没人做过」 |
| 6 Hypothesis Formation | [05-hypothesis-formation.md](./idea-formation/05-hypothesis-formation.md) | 机制、预测、证伪条件已经对齐，保持 |
| 7 Approach Selection | [06-approach-method-formation.md](./idea-formation/06-approach-method-formation.md) 前半 | 与 Method 细节拆开：本步只确认总体检验策略 |
| 8 Method & Evaluation Co-Design | [07-research-design.md](./idea-formation/07-research-design.md)，以及 06 后半 | Claim ↔ Method ↔ Evaluation 同时设计；不做实验协议 |
| 9 Idea Synthesis | [08-idea-synthesis-review.md](./idea-formation/08-idea-synthesis-review.md) 前半 | 只综合已确认对象，不创造新 Idea |
| 10 Idea Review | 08 后半 | 不打分；Comment 必须用户接受/编辑/拒绝 |
| 11 Versioning | 08 与 [Idea 结构设计](./idea-structure.md) | 循环是默认形态，不是 Step 8 之后的附录 |

最大结构变化是第 2 / 3 步对调：先广探候选方向，再深挖用户选中的那一条。旧顺序（先全图 Landscape，再选 Focus）不再作为产品导航。

## 10. 明确不是什么

| 其他形态 | CoResearch 不做的事 |
|---|---|
| Deep Research 报告 | 用一篇综述代替用户决定研究方向 |
| Paper Search | 停在论文列表，不形成可确认的研究逻辑 |
| AI Idea Generator | 从兴趣直接生成带贡献声明的 Idea |
| 分步 Wizard | 强制填完十维问卷才能继续 |
| 实验管理系统 | 在 Idea 形成阶段锁定数据集、样本量和算力 |

Idea V1 之后才进入研究执行、实验规划或论文生产。那些工作流读取已确认 Idea，不回写一套平行真值。
