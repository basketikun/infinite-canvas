# CoResearch 设计（本仓库副本）

> 本目录从 CoResearch 仓库的 `docs/design/` 复制而来，供本仓库对照实现。架构术语真值与 ADR 仍在 CoResearch（`CONTEXT.md`、`docs/adr/`）；下文指向那些路径的链接在本仓库可能打不开。

| 文档 | 回答什么 | 地位 |
|---|---|---|
| [research-flow.md](./research-flow.md) | 用户怎么从兴趣走到 Idea？Agent / 用户 / Canvas 各做什么？ | 产品流程真值 |
| [idea-formation/](./idea-formation/README.md) | 每一步的输入、输出、Gate、revision | 实现契约；与 Flow 冲突时以 Flow 为准 |
| [canvas/research-canvas.md](./canvas/research-canvas.md) | 画布怎么存、怎么命令、怎么和领域服务分工 | 画布架构；**存储/传输/Agent 工具部分已被 SaaS 架构地图取代**，文中 Superseded 标注 |
| [canvas/huabu-domain-binding.md](./canvas/huabu-domain-binding.md) | 研究对象怎么绑到 Node / Frame / Edge | 画布领域映射；术语已对齐 `canvasId`/内置 Agent |
| [canvas/huabu-node-presentation-and-links.md](./canvas/huabu-node-presentation-and-links.md) | 节点怎么展示、怎么连 | 画布呈现 |
| [canvas/huabu-reverse-engineering.md](./canvas/huabu-reverse-engineering.md) | 从 Huabu 源码借什么、砍什么 | 实现依据；命令集结论已更新为 9 条（原 ADR 0010，见 CoResearch） |
| [workspace.md](./workspace.md) | `research/` 里存什么，和能力源码怎么隔离 | 落盘；**目录结构已被 Postgres 架构取代**，实体/关系建模思路仍成立，文中 Superseded 标注 |
| [hosted-codex-runtime.md](./hosted-codex-runtime.md) | 托管版 Agent：Codex Runtime 粒度、隔离、Conversation 与 Thread 映射 | 本仓库实现规格（非 CoResearch 副本） |
| [space.md](./space.md) | Wiki 与 Idea 定位空间 | 知识与想法空间（与画布运行时边界"Canvas"是两个不同概念） |
| [idea-structure.md](./idea-structure.md) | Idea 身份、十维、Proposal、确认 | 对象模型；`Proposal` 定义被 CoResearch ADR 0004 直接复用 |
| [assets/](./assets/) | 文献空间概念图 | 视觉参考 |

阅读顺序：`research-flow.md` → `idea-formation/` → `canvas/research-canvas.md` → `canvas/huabu-domain-binding.md` → `canvas/huabu-node-presentation-and-links.md` → `canvas/huabu-reverse-engineering.md`。

本仓库落地边界与交互压缩版见 [研究交互思路](../content/docs/progress/research-interaction.zh-CN.mdx)。
