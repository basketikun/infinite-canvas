# CoResearch × Huabu：研究空间与领域对象映射

> **注（2026-09-19）**：本文写于 SaaS 架构决策地图之前，整体交互思路和 §5/§6/§8 的写入路径原则和后续 ADR 高度一致（"Frame 组织视图不推断领域类型"这条和 [ADR 0010](../../adr/0010-restore-structured-frame-layout.md) 的 Hard Rule 字面一致），基本不需要改。三处需要更新：(1) `spaceId` 全部改读 `canvasId`（[ticket 08](../../../.scratch/coresearch-saas-architecture/issues/08-space-canvas-terminology-disambiguation.md) 的 Space/Canvas 消歧，本文写的"Space"在新术语里是 Canvas，不要和 `docs/design/space.md` 的 Idea Meta Space 混淆）；(2) §2 提到的"外部 ACP Agent"路径已明确不在 V1 范围（只保留内置 Agent）；(3) §2"Agent 创建/编辑/移动/连接/删除画布内容"这条能力已被 [ADR 0007](../../adr/0007-agent-tool-set-drops-canvas-commands.md) 收窄——V1 的 Agent 没有任何画布命令工具，不能直接操作画布内容。当前真值见 [CONTEXT.md](../../../CONTEXT.md) 和决策地图。

- 日期：2026-09-18。
- 状态：交互升级提案；尚未迁移实现。附件中的删除 HTML、替换页面等内容作为设计建议处理，不作为删除现有代码的指令。
- 上游：[研究画布架构](./research-canvas.md)、[源码逆向记录](./huabu-reverse-engineering.md)、[Research Flow](../research-flow.md)。
- 节点与关系细化：[节点展示与关系连接设计](./huabu-node-presentation-and-links.md)。
- 本次实际核查的本地 Huabu revision：`057da9b1870fb42da91cecf9b83d9924b4ed6f89`；线上手册可能与本地版本不同。

## 1. 变化是什么

现有方案将画布定义为流程总览。本提案将 Research Canvas 提升为持续的研究交互入口：用户在节点、Frame 与侧栏中阅读、追问、修改草稿和确认版本。Conversation 承担探索，Canvas 只保存用户认可的对象，见 [Research Flow](../research-flow.md)。

Step 仍是领域流程与完成条件，但不必对应独立网页。Seed、Direction、Paper、Research Question、Problem、Hypothesis、Approach、Method、Evaluation 和 Idea 可以同时出现在一个项目的默认 Canvas 中。V1 一个 Project 对应一个默认 Canvas（[ADR 0003](../../adr/0003-project-canvas-cardinality.md)：schema 支持 1:N，V1 只激活 1 个）；实体身份不绑定这个数量约束，以便同一论文或想法出现在多个视图中。

研究对象仍由 Research Domain 保存。画布独立保存布局、视口和个人批注；绑定层负责把研究修改送进领域服务，并把提交结果投影回画布。画布因此既是交互入口，也是领域状态的呈现。

## 2. 已核查能力与需要补充的能力

| 能力 | 依据 | CoResearch 的工作 |
|---|---|---|
| Agent 创建、编辑、移动、连接、删除画布内容 | 官方 Work with AI 手册 | 复用交互思路，限制研究字段的写入路径 |
| Agent Node 绑定持续对话并使用空间上下文 | 同上 | 增加显式研究实体与版本上下文 |
| Keep / Revert 与后来修改的冲突保护 | 同上 | 区分画布审阅与研究确认 |
| 外部 ACP Agent 在绑定 Space 范围内操作 | 官方 External Agents 手册 | 不推断任意 CoResearch Agent 已可直接连接，需验证适配 |
| JSON topology、Markdown sidecar、附件与历史 | 官方 Data & Files 手册 | 独立保留研究实体、证据、版本和决定 |
| 共享命令与顺序执行器 | 本地 command.ts、executor.ts | 复用可序列化命令思想；领域提交仍走 Research API |

本地源码确认存在 `CREATE_NODES`、`MERGE_NODE_DATA`、`SET_NODE_PARENT`、`CONNECT_NODES` 等命令。executor 顺序处理命令并返回结果与 pending effects；不能仅凭“一个 execution”就推断跨研究存储和画布存储具有数据库事务原子性。

Huabu README 将 standalone web 描述为 single-owner 应用。采用其画布机制不等于已经获得多用户 SaaS 所需的项目权限、租户隔离和协作协议。

## 3. 对象映射

节点卡片、详情面板、语义缩放和关系连接的具体规则见[节点展示与关系连接设计](./huabu-node-presentation-and-links.md)。本文只保留领域对象与画布对象之间的持久绑定和写入权约束。

| 领域对象 | 空间呈现 | 主要动作 |
|---|---|---|
| Seed | Seed Frame 中的可编辑研究卡 | 澄清、编辑草稿、确认 |
| Landscape / Direction | 地图 Frame / 路线 Frame | 展开代表工作、刷新、选择深入 |
| Work / Version / Fragment | 论文卡 / 版本信息 / 证据片段卡 | 查看原文定位与证据 |
| Question / Limitation Thread | 问题卡与状态时间线 | 查验、查看部分解决与反证 |
| Focus / Problem | 用户研究区域中的研究卡 | 对比候选、修改、确认版本 |
| Hypothesis / Prediction | 假设卡及相连预测卡 | 区分竞争解释、编辑可证伪条件 |
| Approach / Method / Requirement | Research Design Frame | 比较路线、覆盖检查、确认方法 |
| Evidence Plan | 同一区域的计划卡 | 关联 claim、baseline 与失败解释 |
| Conversation | Agent Node | 在选定材料旁持续追问 |

Frame 组织视图，不根据父 Frame 自动推断领域类型。把论文拖进 Method Frame 不会把论文改成 Method，也不会自动写入“借用了该论文方法”。同一实体可有多个绑定节点；编辑一个当前草稿后，其余当前视图刷新，固定历史版本的视图保持不变。

## 4. Node 与 Edge Binding

以下是 CoResearch 新增契约，不是 Huabu 原生 API：

```ts
interface ResearchCanvasBinding {
  id: string
  projectId: string
  canvasId: string   // 原写 spaceId，见 ticket 08 的 Space/Canvas 消歧
  canvasObjectId: string
  objectType: 'node' | 'edge' | 'frame'
  entityKind: string
  entityId: string
  revision: number
  contentHash: string
  revisionPolicy: 'follow_current' | 'pinned'
  projectionVersion: number
}
```

`entityId` 标识研究对象，`canvasObjectId` 标识某次视图呈现。服务端校验绑定属于当前项目；画布命令不得重写 entityId、revision、contentHash、确认者、证据状态等托管字段。

边分两类：

- 视觉连接：用户自由连线，仅用于整理材料，没有已验证的研究含义。
- 研究关系：绑定独立 relation entity，携带类型、两端实体/版本、证据引用、来源与评估状态。

给视觉边写上 `addresses` 只生成关系提案。要显示成有证据的 `addresses`，必须经过来源读取和领域评估；Agent 的判断不会自行升级为文献事实。Edge label 是展示字段，不能充当唯一关系类型。

## 5. 写入路径

| 用户或 Agent 操作 | 提交位置 | 结果 |
|---|---|---|
| 拖动、缩放、分组 | Canvas store | 只改变布局 |
| 添加自由 Note | Canvas store | 创建批注，不创建已确认研究对象 |
| 编辑绑定 Problem 正文 | Research service | 基于预期版本创建/更新 draft，再投影 |
| 修改已确认 Hypothesis | Research service | 创建新 draft；旧确认快照保持不可变 |
| 创建支持/挑战关系 | Research service | 创建带来源的 relation proposal |
| 确认研究对象 | Research service | 校验 Gate 和用户动作后提交确认快照 |
| 移除绑定卡 | Canvas store | 隐藏该视图，不删除研究实体 |
| 归档研究对象 | Research service | 单独领域动作并保留版本与引用 |

不让 `MERGE_NODE_DATA` 绕过领域服务修改研究正文。可编辑的富文本节点需要发送 `EditResearchDraft` 意图，而不是把 Markdown 原文当作另一份权威研究记录。

领域写入使用 expected revision 与 requestId，冲突时返回当前版本让用户比较。提交成功后记录待投影事件；画布刷新失败可以重试，不能丢失已经确认的研究修改。投影按事件 ID 幂等，保留用户布局，禁止“投影变化又触发领域编辑”的循环。

## 6. 在画布上完成确认

Huabu Keep 表示接受一次画布变更；CoResearch Confirm 表示用户确认一个具体研究版本。两者必须分开。

画布可以承载确认，但必须提供展开卡或侧栏，显示完整待确认内容、关键证据状态、剩余不确定性和上游版本。用户看到的版本 hash 与请求提交的 hash 必须一致；阅读期间对象被改动，则刷新后重新确认。

```text
Agent proposal → draft node → 用户审阅完整内容
                                ↓
                     Confirm(entity, revision, hash)
                                ↓
                   Domain Gate + immutable snapshot
                                ↓
                       画布显示确认状态
```

批量 Keep 不触发批量研究确认。Revert 若只涉及布局，可复用画布撤销；若涉及已提交领域正文，则生成新的反向修改草稿，不回写旧快照，更不能擦除确认记录。

## 7. Agent Node 的上下文

位置、Frame 和连线帮助发现相关材料，但不构成研究相关性或访问权限的证明。每次运行解析并保存明确上下文：用户选中的 entity refs、版本、证据片段、上游对象、补充检索范围与截断记录。

Agent Node 上显示“本次使用哪些材料”；节点后来移动不追溯改变旧运行上下文。新增的局部论文应明确作为下一次运行的材料。Searcher、Reader 等活动仍可由主 Agent 协调，不需要把每个阶段强制做成一个独立 Agent。

## 8. 新论文与 Pivot

新论文进入 Research Wiki 后，先形成带证据的 assessment，再更新轨迹与问题线程。画布在原有位置附近增量补充节点；用户锁定的位置不被全量自动布局覆盖。

若新证据挑战已确认 Problem，增加 challenge 关系与 `needs_review` / stale 提示。旧版本继续保留；用户接受改写才创建新的研究版本与 Pivot。视觉移动本身不代表 Idea 发生语义 Pivot。

## 9. 最小验证范围

先贯通一条可检验链路：

```text
创建 Seed 草稿 → 投影到 Frame
→ 画布内编辑 → 领域版本更新
→ 用户展开完整内容并确认
→ 加入一篇论文及证据片段
→ 提出一个 Problem 与 motivates 关系
→ 生成挑战并保留旧确认版本
→ 重启后恢复实体、关系、布局和确认记录
```

验收还需覆盖：双视图引用同一对象；旧 revision 写入被拒；Keep 不会 Confirm；断线后投影重试不重复创建；隐藏卡不删除证据；Agent 普通命令不能伪造确认状态。

此链路通过后，才有依据替换 Interactive HTML 的主交互。现有导出仍可服务离线审阅与交付；文件删除与迁移范围另行确定。

## 10. 与已有设计的关系

这是对“仅总览、步骤页确认”的升级提案，不默认为已采纳迁移。Research Flow 的输入输出、证据要求和确认 Gate 保留；改变的是承载交互的位置。后续采纳时统一更新各步的“页面”描述，并保留侧栏等完整审阅入口。

Research Wiki 和 Idea Space 可在同一个二维空间中呈现，仍分别拥有文献知识与用户研究决定。持久对象、视图和导出交付物应分别建模。

## 11. 核查来源

- [Huabu repository / README](https://github.com/microsoft/Huabu)：产品、部署范围与许可说明。
- [Work with AI](https://microsoft.github.io/Huabu/docs/work-with-ai/)：Agent Node、上下文、Keep/Revert。
- [External Agents](https://microsoft.github.io/Huabu/docs/ai/external-agents/)：ACP 与 Space 范围。
- [Data & Files](https://microsoft.github.io/Huabu/docs/space/data-and-backup/)：目录和 topology/sidecar。
- 本地源码：`packages/shared/src/canvas-engine/executor.ts`、`packages/shared/src/types/canvas/command.ts`，版本见文首。本文未运行 Huabu 或验证完整集成链路。
