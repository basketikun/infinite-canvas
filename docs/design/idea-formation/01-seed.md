# CoResearch Step 1：Seed Framing 设计

- 日期：2026-09-17
- 状态：设计提案；本次不实现 Skill、工具或 HTML。
- 输入：用户的初始研究兴趣。
- 输出：用户确认的 ResearchSeed，以及供 Step 2 使用的 SearchBrief。
- 关联：[Idea 结构设计](../idea-structure.md)、[空间设计](../space.md)。
- 产品流程真值：[Research Flow](../research-flow.md)。本文是 Seed 步骤的实现级契约；若与 Flow 冲突，以 Flow 为准。Flow 要求确认后的 Seed 不含 Direction、组件范围（如 Skills / Tools / Memory）、Gap、Method、Novelty 或 Evaluation。

## 1. Step 1 解决什么

**把“我想研究……”整理为足以启动文献探索、又没有被系统过度解释的研究种子。**

它回答“你想探索的这片区域是什么意思”。用户不需要先知道研究问题、方法或创新点。

完整导航顺序见 [Research Flow](../research-flow.md)。Seed 之后先做 Direction Exploration（对话中的候选方向），再对用户选中的方向做 Deep Dive；不是先建全领域 Landscape。这是初次形成想法的导航顺序，不是单向流水线。文献定位可在后续各阶段反复发生；Problem 形成也不代表其未解决性已经得到最终证明。

Step 1 不运行领域文献搜索、不找 gap、不评价 novelty、不自动产生方法，也不启动实验。它可以生成检索草案，但搜索执行属于 Step 2。

## 2. 用户体验：输入、澄清、确认

### 2.1 输入

用户输入：

> 我想研究 agent harness 自进化。

立即保存原话并展示。此时可确认的是“用户确实表达了这份兴趣”，不能据此将系统整理的范围自动标为 confirmed。

输入已足够明确时，直接生成可编辑 Seed 卡片供确认；不强制展示选择题。输入含义有实质歧义时，再提出少量解释候选。

### 2.2 澄清

候选应解释用户原话的不同含义，例如：

| 候选 | 展示文案 |
|---|---|
| 经验驱动的持续更新 | 从过去的执行经验中，持续修改 harness |
| 按任务适配 | 面对不同任务时调整 harness |
| 修改自身运行逻辑 | 让 Agent 修改负责运行自己的逻辑 |
| 聚焦某类组件 | 主要关注 skills、tools 或 memory 等组件的变化 |

这些选项是 **interpretation candidates**，不是经文献发现的 Research Directions。界面注明“下面是对你原话的几种理解，可以组合或自己描述”。

候选可能重叠，因此不强制互斥单选。允许选择一项或多项、自由输入，以及“还不确定，先按宽主题探索”。选择多项时保留并列范围，不擅自拼成一个复杂研究问题。

默认一轮澄清；只有剩余歧义会明显改变检索对象时再追问一次。仍不确定时保留宽范围或暂存，不无限访谈，也不要求填写十个维度。

### 2.3 整理与确认

假设用户补充：

> 主要是 Agent 根据自己的运行经验，自动修改 skills、tools、memory，然后长期越来越好。

整理为：

```text
当前 Seed · 待确认

主题       Agent Harness 自进化
探索重点   根据执行经验，长期持续修改 harness
研究对象   Agent Harness
关注组件   Skills / Tools / Memory
核心直觉   希望 harness 能从积累的执行经验中改善
尚未限定   任务类型、使用模型、具体更新机制

[继续编辑] [确认并探索文献 →]
                 也可：仅保存 Seed
```

“长期越来越好”保存为用户愿望，不转写为已成立的机制。用户没有提到 Control Logic、冻结模型权重或固定 benchmark，就不加入已确认范围。

按钮“确认并探索文献”同时表达两件事：认可当前卡片，以及请求启动 Step 2。用户仅在对话中说“这个 Seed 准确”时只确认；没有启动请求则停在可进入 Step 2 的状态，不额外要求重复确认，也不自动运行研究。

## 3. 页面设计

页面只有三块：原始输入、必要的澄清、当前 Seed。

```text
STEP 1 · SEED                         Seed → Direction Exploration → …
你想探索什么？

原始输入
“我想研究 agent harness 自进化。”

你更接近哪一种理解？
[经验驱动持续更新] [按任务适配] [修改运行逻辑] [组件演化]
可以组合，也可以直接描述：[                              ]
[还不确定，先宽泛探索]

当前 Seed · 待确认
主题 / 探索重点 / 研究对象 / 已明确范围 / 尚未限定项
[编辑]

[仅保存 Seed]                         [确认并探索文献 →]
```

生成期间显示正在整理，保留输入。失败时显示原稿并允许手工编辑；不因 AI 失败丢失用户内容。

页面不出现论文列表、gap、novelty 评分、十维 readiness 或复杂演化图。SearchBrief 默认折叠在“查看检索范围”中，用户可检查核心词与扩展词，但无需编辑技术字段。

移动端保持相同顺序，底部动作不遮挡文本。所有选项支持键盘操作；当前选择与待确认状态使用文字标记，不只依赖颜色。

## 4. 数据模型：独立 ResearchSeed

Seed 拥有 seedId，不提前创建 ideaId，也不建立十个空维度。后续 Idea 通过 seedRef 引用起点。

```ts
interface ResearchSeed {
  schemaVersion: 1
  id: string
  projectId: string
  revision: number
  rawInput: string                   // 初次原话，保持不变
  userInputRefs: string[]            // 原始消息与后续补充
  topic: string
  focus: string | null
  object: string | null
  concepts: string[]
  scopeNotes: string[]
  exclusions: string[]              // 仅用户明确排除的内容
  unresolvedTerms: Array<{
    term: string
    note: string
    blocksSearch: boolean
  }>
  provenance: Array<{
    fieldPath: string
    origin: 'user' | 'agent'
    derivation: 'verbatim' | 'paraphrase' | 'inference'
    sourceRefs: string[]
  }>
  status: 'draft' | 'confirmed'
  confirmation: null | {
    actorId: string
    actionRef: string                // 明确的按钮动作或用户消息
    contentHash: string
    confirmedAt: string
  }
  createdAt: string
  updatedAt: string
}
```

顶层不采用统一 `source: user`：兴趣属于用户，但英文翻译、概括和语义解释可能由 Agent 生成。用户确认后仍保留这些来源，确认只绑定内容，不改变作者。

`concepts` 是用户范围内的概念；同义词与更宽的检索词放入 SearchBrief。`object` 可以为 null，例如跨领域主题难以归为单个对象；不能为了通过门槛而伪造对象。

例子的内容部分如下；这只是设计示例，不保存为真实用户的 confirmed Seed：

```json
{
  "topic": "Agent Harness 自进化",
  "focus": "基于执行经验的长期持续更新",
  "object": "Agent Harness",
  "concepts": ["agent harness", "self-evolution", "skills", "tools", "memory"],
  "scopeNotes": ["从执行经验中学习", "关注跨任务积累后的持续修改"],
  "exclusions": [],
  "unresolvedTerms": [],
  "status": "draft",
  "confirmation": null
}
```

Seed 不包含 problem、gap、hypothesis、method、novelty、contribution。用户最初输入已包含方法猜想时，原话完整保留，并在 scopeNotes 注明“用户提出的待探索设想”；Step 1 不替它建立已验证的 Idea 字段。

## 5. SearchBrief：派生产物，不是第二份 Seed

```ts
interface SearchBrief {
  schemaVersion: 1
  seedRef: { id: string; revision: number; contentHash: string }
  generatorVersion: string
  primaryTopic: string
  focus: string | null
  coreConcepts: string[]
  scopeNotes: string[]
  exclusions: string[]
  queryCandidates: Array<{
    text: string
    kind: 'core' | 'synonym' | 'broaden'
    rationale: string
  }>
  unresolvedTerms: string[]
  researchQuestions: string[]        // 领域调查问题，不是用户的研究问题
  interpretationRules: string[]
  generatedAt: string
}
```

示例：

| 类别 | 内容 |
|---|---|
| 核心查询 | agent harness self evolution；agent harness execution experience skills tools memory |
| 同义扩展 | agent harness self improvement；experience driven harness adaptation |
| 范围扩展 | automatic harness engineering；self improving agents |
| 调查问题 | 有哪些定义、更新对象、反馈来源、时间尺度和评估方式？ |
| 解读约束 | 不预设该主题有新颖性；局限不自动等于未解决 gap；区分持续更新与任务内适配 |

扩展词注明为检索策略，不进入 Seed 的已确认概念。不得用扩展词突破明确 exclusions；无结果时建议扩大范围，而不是静默取消排除项。

用户若编辑的是研究意图，回写 Seed 草稿再确认；仅调整查询措辞则保存为 Step 2 的 query override，关联 Seed 版本。SearchBrief 自身只重建，不成为另一份可独立维护的真值。

## 6. 完成条件与阶段交接

需要区分“已确认”与“可启动”。仅检查 `status && topic && concepts.length` 不足以证明可搜索。

### 6.1 Seed Gate

完成以下检查即可，不设评分：

1. topic 非空，至少一个概念可作为检索锚点。
2. 用户明确认可当前整理结果，confirmation 的 hash 与内容一致。
3. 没有会使搜索对象完全不同、且尚未处理的歧义。
4. SearchBrief 至少含一个与范围一致的有效查询草案。

有效查询指非空、与已确认范围有关、可交给检索器；不保证一定有结果。判断检索表达是否合适可以由 Agent 提出理由，程序校验只负责结构和确认绑定，不能把字符串非空冒充语义验证。

“AI”“自进化”等极宽输入应询问一次范围；用户明确选择宽泛探索后允许通过，并在 Brief 标记 broad，不把模糊主题判为不可用。用户自造术语则保留其操作性描述和关键词，不必先证明学界已有该术语。

### 6.2 交接契约

| 项目 | 定义 |
|---|---|
| 触发条件 | Seed Gate 通过，且用户请求开始研究 |
| 交接载荷 | projectId、seedRef、briefRef、requestId，以及已有检索预算设置 |
| Step 2 前置验证 | 项目一致、引用存在、hash 匹配、Seed 已确认、Brief 非过期 |
| Step 2 返回 | researchRunId 或明确错误状态 |
| Step 1 完成标志 | Confirmed Seed 与有效 Brief 已保存 |
| Step 2 启动标志 | 下游确认接收并返回 runId |

不能把“生成了 Brief”显示成“正在研究”。下游未实现时展示“Seed 已就绪，Landscape 尚未接入”。交接失败不撤销确认；重试复用 requestId，避免重复启动研究。

确认与启动是两个状态：按钮先持久化确认，再准备 Brief，最后交接。Brief 生成失败时显示“Seed 已保存，检索简报生成失败”，保留重试入口。

## 7. 状态变化与回退

```text
输入 → Draft → 用户确认 → Confirmed
         ↑                    │
         └──── 修改内容 ──────┘  （建立新草稿 revision）

Confirmed → Brief Ready → Handoff Requested → Step 2 Accepted
                  └─ 失败时保留 Seed，重试派生或交接
```

确认后修改产生新的 draft revision；旧 confirmed revision 不变。新草稿不沿用旧确认，旧 Brief 对新草稿视为过期。

若 Step 2 已基于旧 Seed 开始，结果继续绑定原 seedRef；展示当前 Seed 已有新草稿，允许用户决定是否基于新确认版本重新研究。不自动取消旧 run，也不把旧结果标为新范围的 Landscape。

原始 rawInput 保留不变，纠正或补充通过 userInputRefs 与整理字段表达。草稿自动保存不会构成确认，沉默、默认选项、选择候选均不会触发确认。

## 8. Skill 和存储边界

建议未来新增 `seed-framing` 能力，但此次只写设计，不创建或执行 Skill。

| 能力 | 职责 |
|---|---|
| seed-framing | 理解输入、提出必要候选、整理 Seed、等待明确确认 |
| 领域服务 | 保存草稿、校验确认、维护 revision、幂等交接 |
| Brief 投影器 | 从已确认 Seed 生成检索表达与调查目标 |
| landscape-research | 接收 Brief 后检索、阅读、归纳来源 |

Skill 可提出内容；服务确认动作必须来自用户界面或可追溯用户消息，不能接受模型单独传入 `confirmed: true`。已有研究记录可以作为显式输入引用，但不得在 Step 1 偷跑一次 Landscape。

目标目录：

```text
research/seeds/<seed-id>/
├── manifest.json               # 当前 draft、最新 confirmed 的引用
├── drafts/<revision>.json
├── confirmed/<revision>.json   # 不可变确认快照
└── views/<revision>/
    ├── seed.md
    └── search-brief.json
```

rawInput、来源和确认依据属于研究状态，不只存在于系统 trace。未来 Idea 保存 `seedRef`，无需把 Seed 改名成 Idea 或复制其可编辑真值。

确认快照、manifest 指针和启动请求应有幂等、可恢复的提交协议；这是实现验收要求，不声称简单的多文件顺次写入已满足。个人笔记与自动生成视图分离。

## 9. 与之前设计的关系

本设计细化并替代 [Idea 结构设计](../idea-structure.md) 第 7.1 节中“初始输入即创建 ideaId 和 v0”的产品时机：

- 原始兴趣先进入独立 Seed；不创建十维 Idea，也不把 Seed 修订显示为 Idea Pivot。
- 原话可作为用户兴趣的直接证据；整理后的 Seed 仍需明确认可。
- 首次文献探查归 Step 2，由 Confirmed Seed 和 SearchBrief 驱动。
- Idea 的语义版本与 Pivot 保留在后续研究问题/想法演化中；早期变化通过 Seed revision 追溯。
- Seed 的确认只是范围确认；后续 Landscape、Problem、Idea 仍然可以挑战并修改这一范围。

本文明确这些设计差异，未改动既有实现和旧文档，也不隐含迁移现有 Idea 数据。

## 10. 第一条验收案例

以下为模拟流程，不表示当前用户已确认这个具体研究范围。

| 操作 | 预期结果 |
|---|---|
| 输入“我想研究 agent harness 自进化” | 保存原话，创建 Seed draft，不创建 Idea |
| 系统给出解释候选 | 标为语义澄清，不宣称文献发现或研究方向 |
| 用户补充 skills/tools/memory | 只加入这些组件，不自动加入 control logic |
| 用户尚未确认 | 不启动研究，不将整理结果标为 confirmed |
| 点击“确认并探索文献” | 固定当前 Seed、生成 Brief、请求 Step 2 |
| 重复点击按钮 | 同一确认/启动请求只处理一次 |
| Brief 生成失败 | Seed 保持已确认，提示重试 |
| Step 2 不可用 | 显示已就绪与具体失败，不虚报研究进行中 |
| 修改确认后的 Seed | 新 draft revision；旧快照与旧 run 保持可追溯 |
| 用户说“还没想清楚” | 允许确认宽主题并探索，不强迫形成问题 |
| 用户拒绝所有候选 | 保留原话，允许自述；不替用户选最接近的一项 |
| 用户已输入清晰范围 | 跳过不必要的候选，直接展示确认卡 |
| 自动提取模型失败 | 可手工编辑和保存，不丢输入 |

验收目标：用户用一句兴趣和必要的少量澄清，就能清楚地确认“接下来要查什么”；系统不在这一步替用户承诺研究问题或创新性。

## 11. 参考与使用边界

主要依据为用户此次提供的 Step 1 材料，完整覆盖其交互、ResearchSeed、SearchBrief、Gate 和阶段顺序。候选组合、来源记录、确认与启动分离，以及版本失效规则，是本文补充的实现约束。

本地 [ARIS idea-discovery 参考文件](../../../references/Auto-claude-code-research-in-sleep/skills/idea-discovery/SKILL.md) 的 Overview 与 Phase 1 显示从 broad research direction 进入 research-lit 的顺序。这里只借鉴输入先于文献探索的阶段关系，没有执行该文件中的自动推进、工具或选择策略，也未据此声称 ARIS 已实现本文的 Seed 页面和确认契约。

本次不需要验证具体学术创新性，因此未开展领域检索；也不以材料中提及的 LitPivot 结论为本设计的实证证明。
