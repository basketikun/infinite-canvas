# CoResearch Step 2：Research Landscape Engine 设计

- 日期：2026-09-17
- 状态：设计提案，尚未实现或执行真实 Landscape 调研。
- 上游：[Step 1 · Seed Framing](./01-seed.md)。
- 关联：[空间设计](../space.md)、[Idea 结构设计](../idea-structure.md)。
- 下游：在旧导航中是 Step 3 · Direction Exploration。产品流程真值见 [Research Flow](../research-flow.md)：广探候选方向在前，本文对应的脉络重建改为对用户选中 Direction 的 Deep Dive，产物是 Direction Dossier 而非先建全领域地图。若与 Flow 冲突，以 Flow 为准。

## 1. 目标与边界

**从已确认的 Seed 出发，建立有来源、有时间范围、可追问的研究地图：主要路线如何形成、方法如何变化、已经做到什么，以及哪些问题仍需调查。**

Step 2 的完成产物是 ResearchLandscape，不是用户的研究方向决定，也不是创新性证明。它可以归纳文献中的路线，但不能替用户选择路线、确认 gap 或生成正式 Idea。

它回答六个问题：

| 问题 | 产物 |
|---|---|
| 有哪些主要研究路线？ | ResearchDirection |
| 路线从什么问题出发？ | Problem trajectory |
| 方法如何演进和分叉？ | Method trajectory、分支与跨路线关系 |
| 历史困难后来发生了什么？ | Question resolution history |
| 在哪些条件下已有能力证据？ | Scoped capabilities |
| 当前值得继续调查什么？ | Current questions、emerging vectors、覆盖缺口 |

“截至当前”必须落实为明确的 `asOf` 日期及检索范围，不等于知道该日期前的所有研究。路线历史证据不足时，允许输出路线候选，不补造起源或演化链。

## 2. 输入、输出与运行身份

沿用 Step 1 的完整交接，不简化成仅传 seedId：

```ts
interface LandscapeBuildRequest {
  projectId: string
  seedRef: { id: string; revision: number; contentHash: string }
  briefRef: { id: string; contentHash: string }
  requestId: string
  asOf: string
  budget: {
    maxQueries: number
    maxFetchedWorks: number
    maxDeepReads: number
    maxForwardChecks: number
    maxElapsedSeconds: number
  }
}
```

服务校验 Seed 已确认、hash 匹配、Brief 对应同一版本、项目一致。预算取项目设置或产品默认值，并在启动前可见；扩大已确认的资源预算需要遵循用户设置。

受理返回 runId；相同 requestId 重试返回同一任务。不同 Seed revision 不可复用旧结果冒充新范围。

```ts
interface ResearchLandscape {
  id: string
  revision: number
  seedRef: { id: string; revision: number; contentHash: string }
  runId: string
  asOf: string
  generatedAt: string
  status: 'partial' | 'ready' | 'insufficient_evidence'
  directionIds: string[]
  candidateDirectionIds: string[]
  crossDirectionRelationIds: string[]
  frontierSummary: string
  frontierEvidenceRefs: string[]
  coverageId: string
  provenance: {
    wikiSnapshotId: string
    synthesisVersion: string
    sourceRecordIds: string[]
  }
}
```

运行状态另存 queued / running / completed / failed / cancelled。`completed` 只表示任务停止并保存结果，结果可能是 partial；不能混为“研究充分”。

## 3. 总体处理流程

```text
Confirmed Seed + SearchBrief
 → 检索计划 → 广泛检索 → 研究身份与版本解析 → 文献阅读
 → 方法族归纳 → 路线发现 → 问题/方法轨迹重建
 → 历史问题的后续核查 → 当前状态综合 → Landscape 投影
```

该顺序是逻辑依赖，允许有限回查：轨迹缺来源时补检索，问题核查发现新版本时回到阅读。所有回查消耗同一预算，不能无限递归。

| 阶段 | 主要输出 | 进入下一阶段的条件 |
|---|---|---|
| Search Planning | 查询、来源、窗口、覆盖面、预算计划 | 保留 Seed 范围和排除项 |
| Broad Retrieval | 原始命中及查询来源 | 每条可追溯到一次检索 |
| Canonical Resolution | Work、Version、疑似重复项 | 纳入综合的研究身份已解析 |
| Extraction | 原文片段与结构化阅读记录 | 结论能定位到读过的内容 |
| Approach Grouping | 方法族与成员理由 | 机制相近有内容依据 |
| Direction Discovery | 核心问题、范围、代表工作 | 方法族与持续问题建立关系 |
| Trajectory | 阶段、分支、语义边 | 每条边说明证据与判断类型 |
| Temporal Revalidation | 问题状态及后续检索记录 | 未查项明确为待核实 |
| Synthesis | 能力、瓶颈、趋势线索 | 每项含范围、时间、出处 |
| Projection | 页面、时间线、查询上下文 | 投影绑定不可变研究快照 |

## 4. 检索计划与预算

SearchBrief 提供核心概念、同义表达及范围扩展。Step 2 将其组织为对象、机制、组件、评价、时间变化等 facets；这些 facets 是检索维度，不是预先规定的研究路线。

以 harness Seed 为例，用户只确认 skills/tools/memory 时，prompts、routing 等可以作为“邻近范围扩展”检索，但不能悄悄变为用户已选对象。主题特定的 integrity、forgetting 等检索面也只是候选，不能在读文献前声称是当前瓶颈。

来源可包括 arXiv、会议/期刊网站、Semantic Scholar、OpenAlex、Crossref、DBLP 及用户授权的本地资料。适配器必须报告 available / unavailable / rate_limited / failed，不能悄悄跳过后仍显示“全部来源已覆盖”。本设计不规定未经验证的第三方 API 参数。

建议起步目标为 40–80 条原始命中、25–50 项去重研究、15–30 项纳入阅读、8–20 项深读；这是预算配置的参考，不是数量门槛或预期结果。窄领域可以更少，宽领域可能无法在一轮内形成充分地图。

需要同时安排：核心词检索、别名与相邻方法、基础工作回溯、近期工作检查、已读工作的后续追查。只限定最近两年时，早期起源可能遗漏；如需补读窗口外基础工作，明确记录用途和范围例外。

停止条件：达到预算、关键查询已完成且连续扩展无有用新增、用户停止、或来源不可用。记录具体原因；停止不自动使问题变成已解决或仍开放。

## 5. Work、Version 与去重

### 5.1 对象定义

| 对象 | 定义 | 关键字段 |
|---|---|---|
| RawHit | 某来源某次查询返回的记录 | queryId、provider、providerRecordId、retrievedAt |
| PaperWork | 一项研究的稳定身份 | id、标题别名、作者、标识符映射、identityStatus |
| PaperVersion | 该研究的一份可引用版本 | id、workId、版本号、venue、公开时间、sourceURI、contentHash |
| SourceSnapshot | 实际读到的网页/PDF/摘要内容 | versionId、抓取时间、内容、访问级别 |
| ResolutionDecision | 身份合并/拆分的依据 | 原记录、目标 workId、匹配规则、证据、决策者 |

公开时间允许年、月、日不同精度，也允许未知，不能用抓取时间伪装发表日期。`firstPublicAt` 从已知版本推得；`observedAt` 是系统看到它的时间，二者独立。

### 5.2 解析规则

1. 标识符标准化后匹配完全一致的 DOI 或 arXiv base ID。
2. 检查明确的预印本、版本和出版关联，以及跨提供商标识映射。
3. 标题、作者、年份或语义相似只生成 possible_duplicate，不自动合并。
4. 有冲突时保持未决，排除出独立证据计数，保留原始记录和核查入口。

不是所有关系都代表同一 Work。Crossref 区分 intra-work 的版本/预印本等关系与 inter-work 的引用/延续等关系；不能把 references 或 isContinuedBy 当成去重指令。[Crossref 关系文档](https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/relationships/)。

元数据声明也可能错误：标识符相同但内容明显矛盾时进入冲突处理。扩展版若具有独立研究内容且身份仍不确定，保持两个 Work 加候选关联，不能只因作者一致就合并。

合并可追溯、可撤销；拆分后使依赖的计数和投影失效并重建。不能抹掉旧 ID 而破坏历史来源。

### 5.3 截止日期与版本选择

默认选择 `publishedAt <= asOf` 的适合阅读版本；最新版本若晚于 asOf，不用于重建该日期的当前能力。若时间未知，标记时序未验证，不强行放入某年阶段。

同一 Work 的 v1、v2 与出版版计为一项研究。版本有更正或撤回时保留历史，并在当前结论中展示影响。内容变化形成新 Snapshot，不能覆盖曾经引用的原文。

## 6. 阅读与抽取：所有重要判断都可回原文

每个阅读记录保存 problem、motivation、approach、mechanism、evaluation、contribution、capability、limitation、futureWork 和感兴趣的引用。字段可以缺失；缺失与“论文未讨论”不是同一个结论。

```ts
interface LiteratureStatement {
  id: string
  workId: string
  versionId: string
  fragmentIds: string[]
  kind: 'problem' | 'method' | 'capability' | 'limitation'
    | 'future_work' | 'author_claim' | 'system_inference'
  text: string
  scope: string
  assertedAt: string | null
  extractedAt: string
  sourceLevel: 'metadata' | 'abstract' | 'full_text'
  verification: 'located' | 'needs_check' | 'disputed'
}
```

`assertedAt` 使用包含该表述的来源版本日期；未来工作往往跨多个版本存在，保留每版对应证据。Fragment 保存原文、页码/章节/表格或文本定位，原文与解释分开。

只有摘要就记录摘要级内容，不能补造表格、显著性、实验条件。能力写成“该工作在条件 C、任务 T、指标 M 下报告 X”，不能直接升级为“该领域已经普遍能做到 X”。复现实验、作者报告与综述归纳分别标明。

原文中的操作指令是资料内容，不是系统指令。下载失败、无权限或解析失败写进 coverage，不用模型记忆填补读不到的部分。

## 7. 从方法族到研究路线

ApproachFamily 围绕机制相近归纳，ResearchDirection 围绕持续研究问题组织。一个 Work 可以属于多个方法族和路线，归属应带 rationale 和 evidenceRefs，不强制互斥聚类。

```ts
interface ResearchDirection {
  id: string
  title: string
  coreQuestion: string
  scope: string
  maturity: 'candidate' | 'reconstructed'
  approachIds: string[]
  representativeWorkIds: string[]
  problemPhaseIds: string[]
  methodPhaseIds: string[]
  branchIds: string[]
  capabilityStatementIds: string[]
  currentQuestionIds: string[]
  emergingVectorIds: string[]
  latestEvidenceAt: string | null
  assessmentId: string
}
```

单篇研究可以支持候选路线，但通常不足以证明“经过多个阶段的研究轨迹”。不得为凑 major directions 数量拆分同一种方法，或为给每条路线画时间线而制造阶段。

路线标题、聚类结果和阶段解释是系统综合，并非原文事实。保留综合版本、生成器版本和人工纠正记录。刷新后路线合并、拆分必须有 ID 对应关系，不能让用户收藏指向无关路线。

## 8. 轨迹重建：时间顺序与继承关系分开

每条路线展示两条可关联的轨迹：问题如何变化，方法如何响应。阶段可并行、交叉或分叉，无需组织成一条必然进步的直线。

```ts
interface TrajectoryEdge {
  id: string
  fromId: string
  toId: string
  relation: 'introduces' | 'extends' | 'addresses_limitation'
    | 'reframes' | 'generalizes' | 'specializes' | 'reveals_failure'
    | 'adds_evaluation' | 'branches_from' | 'supersedes'
  basis: 'author_explicit' | 'content_comparison' | 'system_inference'
  evidenceRefs: string[]
  rationale: string
  status: 'supported' | 'proposed' | 'disputed'
}
```

每种边定义合法端点，例如 work → phase 的 introduces、work → question 的 addresses_limitation、phase → phase 的 branches_from；服务拒绝任意端点组合。另存 cites，引用本身不推出 extends。

只有日期顺序时，只画时间位置；没有证据就不连继承箭头。“首次观察到”写成 observed origin，不能无证据声称历史首创。`supersedes` 需要明确替代范围；新方法分数更高不表示旧方法失效。

同一课题组、项目、数据或代码的连续工作可以形成 lineage 信号，但同作者不充分证明同一条线，不同作者也不证明独立验证。Work 数、已识别 lineage 数和独立复现证据分开统计；独立性未知就显示未知。

## 9. Temporal Revalidation：旧问题如何成为当前判断

所有 limitation、future work 首先进入 HistoricalQuestion 候选。系统依次检查：同 Work 后续版本、后续引用/项目工作、围绕具体问题的主题检索、近期综述或反证。只查引用链会漏掉未引用原文的解决方案，因此不能作为唯一检查。

每次核查记录原问题、适用范围、查询、来源、读取版本、截止时间、失败项和剩余争议。多条不同范围的 limitation 不因关键词相似就合并为同一个问题。

| 状态 | 判定要求 |
|---|---|
| historical | 仅确认它曾在某版本被提出 |
| needs_verification | 未做完后续核查或关键来源不可访问 |
| still_active | 有较新直接证据重新提出同范围问题，且已记录后续核查 |
| partially_addressed | 后续工作处理了部分条件/对象，列出已处理和剩余部分 |
| substantially_addressed | 有对应范围内的充分处理证据，仍保留条件与争议 |
| superseded | 问题表述或前提被新表述替代，附替代理由 |
| inconclusive | 证据冲突，或已检索但不足以支持当前状态判断 |

这些是带时间的评估状态，不是不可逆进度条。更正、反例或新结果都可以重开问题。

**没有检索到处理它的工作只能说明本次未找到，不能自动得到 still_active。** 明确被近期作者称为开放问题也不自动证明整个领域未解决，需要核对其范围与后续信息。

同篇 v3 增加了 v1 缺少的验证，应记录“同一 Work 新版本处理了原限制”；是否 substantially_addressed 取决于覆盖条件，不能一律标 superseded。外部工作研究过某问题，也不等于解决了它。

```ts
interface QuestionAssessment {
  id: string
  questionId: string
  asOf: string
  checkedAt: string
  status: 'historical' | 'needs_verification' | 'still_active'
    | 'partially_addressed' | 'substantially_addressed'
    | 'superseded' | 'inconclusive'
  scope: string
  resolutionEventIds: string[]
  evidenceRefs: string[]
  searchRunIds: string[]
  remainingUncertainty: string
}
```

同一问题的评估追加保存，旧评估不覆盖。ResolutionEvent 记录版本/工作、有效日期及精度、关系、具体处理内容和证据，不仅保存 addressedBy 列表。

## 10. 当前状态综合

每条路线固定展示：

- **已有能力**：论文报告或独立验证的结果，附任务、条件、指标和限制。
- **当前问题**：经过后续核查的 still_active / partially_addressed 项；待核查和冲突项单独显示。
- **正在出现的路线线索**：来源、时间、适用范围，以及它是多项工作共同出现、综述归纳、作者展望还是系统推断。

单篇 future work 只构成待验证线索。多版本不能充当多项研究，同一 lineage 不能自动算作多份独立确认。Current Frontier 是以上材料的限定范围综合，不由“最新论文”或引用数排名直接生成。

每条当前状态卡必须具有 source、scope、asOf、checkedAt 和 verification status。不能只有统一页面日期而让用户误以为所有问题都在那天完成核查。

## 11. Coverage 与完成 Gate

计数口径先固定：

| 字段 | 定义 |
|---|---|
| rawHits | 提供商返回记录数，包含跨查询重复 |
| resolvedWorks | 已解析且去重的 Work 数 |
| unresolvedRecords | 未解决的身份记录数，另列不充当独立证据 |
| screenedWorks | 已作相关性判断的 Work 数 |
| includedWorks | 被纳入本地图的 Work 数 |
| deepInspectedWorks | 已读取声明章节并完成结构化证据抽取的 Work 数 |
| forwardCheckCoverage | 完成核查的问题数 / 本轮计划核查数 |

深读不等于下载过 PDF，筛选不等于相关。覆盖还保存查询明细、来源状态、日期窗、语言范围、版本策略、排除理由、访问层级、未读内容、最新来源日期和停止原因。路线的局部覆盖不能只用全局计数替代。

`ready` 的条件是：在声明范围内查询计划已执行；用于关键结论的 Work 身份明确；每条作为正式路线展示的记录都有核心问题、方法和代表证据；轨迹边能追溯；所有被提升为当前问题的项已完成后续核查；未解决候选和失败来源明确显示；投影可回到证据。

这不是领域穷尽保证。不要求所有 raw hits 都解析完，但未决身份若影响关键结论则只能 partial。路线历史无法充分重建、关键来源失败或计划核查未完成时，保存 partial；几乎没有足够相关证据时返回 insufficient_evidence，不生成空心的 ready 地图。

页脚固定说明：这是指定范围内的工作地图，不是穷尽覆盖的证明。

## 12. 交互页面

```text
STEP 2 · RESEARCH LANDSCAPE
Seed 主题 · Seed r2 · 截止日期 · 结果 partial/ready
已解析研究 / 访问级别 / 核查覆盖 / 来源异常

路线卡
核心问题与范围
问题轨迹    已知阶段 ── 有依据的变化 ── 当前判断
方法轨迹    方法族及其分支
已有能力 / 当前问题 / 待核实线索
[完整轨迹] [查看来源] [比较路线] [追问这条路线]

覆盖与未完成项
[刷新地图]                         [进入 Step 3 · 探索方向]
```

主视图展示路线，论文是可展开的证据层。完整轨迹页同时显示问题演化、方法演化、分支与问题处理历史；点击箭头查看为什么这样连接，而不只是打开论文标题。

`Ask` 默认回答当前快照能支持的内容；需要新搜索时明确显示补充核查并计入预算。刷新生成新 revision 和变化摘要，不覆盖原地图。

有图也要有线性列表；颜色、线型和文字一起区分支持/推断/争议。来源不可访问、日期未知、关系未决均有明确状态。

页面不提供 Confirm Gap 或自动 Generate Idea。用户可进入 Step 3 决定关注路线；Step 2 的系统路线分类不是用户选择。

## 13. Step 2 → Step 3 契约

交接包括 landscapeId、revision、seedRef、coverageId、可浏览的 directionIds 和 outstandingIssueIds。用户点击进入后，下游返回 explorationSessionId。

ready 可正常进入；partial 也可由用户选择“基于部分地图探索”，必须携带缺失项，不能改成 ready。insufficient_evidence 优先提供调整 Seed 或继续检索；若用户仍选择探索，只能保留为未定位兴趣，不能伪装为已有证据路线。

Step 3 固定所依据的 Landscape revision。刷新若合并/拆分路线，向用户展示对应变化，原选择继续可追溯，不自动替换为新方向。

## 14. 服务、工具与 Wiki 边界

Searcher、Resolver、Reader、Trajectory Builder、Synthesizer 是逻辑职责，可由一个 Agent 和同一服务串行完成。本设计不要求新增五个 Agent 或独立进程。

未来工具入口可为 research_landscape：build、refresh、inspect_direction、verify_question、trace、ask。build/refresh/verify_question 可启动有预算的任务；inspect/trace 是读取；ask 需要补检索时显式返回或触发研究动作。工具委托领域服务，不能由模型直接改 JSON 和发布状态。

领域职责保持在同一 CoResearch 产品边界。可以按 papers / extraction / approaches / directions / questions / synthesis 分模块；是否独立为包取决于实现时依赖，不为目录形式先增加部署单元。

建议持久结构：

```text
research/wiki/
├── works/                         # canonical identity 与版本记录
├── fragments/                     # 实际阅读来源
├── statements/                    # 抽取/解释，带 provenance
├── approaches/
├── directions/
├── questions/                     # 问题与不可变评估历史
├── lineages/
├── graph/                         # 唯一关系存储，按 ID 引用
└── landscapes/<landscape-id>/
    ├── revisions/<revision>/      # 固定 manifest、coverage、来源引用
    └── views/                     # 页面、时间线、query-pack 等可重建投影
```

这是目标结构，不执行目录迁移。实体保存一次，关系保存一次；Connections、成员列表和页面是投影。范围相关的路线分组与评估带 seedRef/asOf，不能把一个 Seed 的分类当成整个 Wiki 的唯一分类。

查询、覆盖和作出结论所需的来源记录属于研究数据，不能只放可清理的 trace。中断恢复按阶段 checkpoint 继续，缓存键含内容 hash、版本、抽取器和综合规则版本。Wiki 写入失败不发布 ready；投影失败保留领域快照并允许重建。

## 15. 最小实施顺序与验收

先实现“一个 Seed → 来源/版本解析 → 阅读证据 → 一条可解释路线 → 一个历史问题的后续核查 → 带 coverage 的地图”。再扩展多路线、分支、跨路线比较、lineage 和增量刷新。首阶段不省略版本绑定和 partial 状态。

以下为合成 fixture，应在实现阶段编写测试，不是本次真实调研结论：

| 场景 | 预期 |
|---|---|
| 同研究 arXiv v1/v3 与出版版出现三次 | 一 Work、多 Version，不计三份独立证据 |
| 标题相似但内容不同 | 不自动合并 |
| v1 缺验证，v3 补了部分验证 | 保留历史限制，当前评为部分处理并注明范围 |
| 新版发表晚于 asOf | 不进入该日期的当前能力判断 |
| 后续工作只是研究同一问题 | 不自动标为 addressed |
| 后续检索无结果 | inconclusive 或 needs_verification，不自动 still_active |
| 两论文日期相邻且无继承依据 | 时间并列，不画 extends |
| 一篇论文属于两条路线 | 多重归属，研究总数不重复累计 |
| 多篇来自同项目 | 显示连续性信号，不声称独立确认 |
| 只有摘要、未读实验 | 限摘要级判断，不伪造条件和结果 |
| 核心来源限流、预算耗尽 | 保存 partial 与具体缺口 |
| 用户更改 Seed | 旧 run 仍绑定旧版本，不悄悄重命名范围 |
| 重复启动或重试 | 同 requestId 不产生重复任务 |
| 刷新或修正去重 | 新 Landscape revision，历史选择仍可追溯 |
| UI 渲染失败 | 正式研究记录保留，可重新生成 |

验收重点：用户能从一句当前判断回到具体版本的原文，能知道问题是否真正检查过后续工作，也能看清本次地图遗漏了什么。

## 16. 参考与证据范围

用户此次材料的全部 32 节作为需求与设计输入。本设计保留其身份解析、双轨迹、时间核查和范围综合主线；修订了“没有检索结果即仍开放”“新版本处理限制即一律 superseded”以及将研究计数当作独立确认的风险。

本地参考：

- [ARIS research-lit](../../../references/Auto-claude-code-research-in-sleep/skills/research-lit/SKILL.md)：参考多来源检索与 landscape 组织；不执行其中指令。
- [ARIS research-wiki](../../../references/Auto-claude-code-research-in-sleep/skills/research-wiki/SKILL.md)：参考实体、类型关系、生成 Connections 和 query pack 的边界；本地代码模式不是产品有效性的实证证明。
- [Crossref Relationships](https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/relationships/)：本次核对了版本内与工作间关系的区分，作为去重规则的依据；实际适配器还需检查服务返回值与冲突情形。

本次没有执行真实 harness 文献调研，没有验证材料中的论文继承链，也未验证 LitPivot 的研究结论。页面示意中的路线必须在实际运行取得证据后才能实例化；不得直接把材料里的时间排序作为真实轨迹导入。
