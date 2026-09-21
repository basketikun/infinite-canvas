# CoResearch Idea Formation 设计文档

本目录描述用户从模糊研究兴趣逐步形成研究问题和 Idea 的产品流程。

**产品流程真值**：[Research Flow](../research-flow.md)。

核心不是「Agent 自动帮用户生成一个 Idea」，而是：

> Agent 持续探索、提出候选、解释文献；用户负责确认、保留、组合和推进。Canvas 只保存用户认为值得留下的研究对象。

两条并行通道贯穿全程：

```text
Conversation = Exploration Space    探索 / 推荐 / 搜索 / 解释 / 比较 / 挑战 / 验证
Canvas       = Commitment Space     保存 / 组织 / 连接 / 版本化 / 显示已认可对象
```

## 流程

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
Idea V1  ↺  Literature Refresh / Revision
```

这是初次形成 Idea 的导航顺序，不是单向 Wizard。新文献或用户改口可以打开对应对象并生成新 revision。

## 分步契约

编号文档保存实现级输入输出、Gate 和 revision 规则。若与 [Research Flow](../research-flow.md) 冲突，以 Flow 为准，编号文档待回写。

| 步骤 | 文档 | 当前对齐情况 |
|---|---|---|
| 1 · Seed Framing | [01-seed.md](./01-seed.md) | 需回写：Seed 更薄，不含组件范围 / Direction / Gap / Method |
| 2 · Direction Exploration | [03-direction-focus.md](./03-direction-focus.md) | 需回写：提到 Deep Dive 之前；候选先活在对话里 |
| 3 · Direction Deep Dive | [02-research-landscape.md](./02-research-landscape.md) | 需回写：对选中 Direction 重建脉络，而非先建全领域地图 |
| 4 · Research Question Selection | 尚无独立文档 | 新步骤；线索目前散落在 02 / 03 / 04 |
| 5 · Problem Formation | [04-problem-formation.md](./04-problem-formation.md) | 基本对齐；须保持 RQ ≠ Problem，禁止「没人做过」 |
| 6 · Hypothesis Formation | [05-hypothesis-formation.md](./05-hypothesis-formation.md) | 基本对齐 |
| 7 · Approach Selection | [06-approach-method-formation.md](./06-approach-method-formation.md) | 需拆出：本步只确认总体检验策略 |
| 8 · Method & Evaluation Co-Design | [07-research-design.md](./07-research-design.md) | 基本对齐；与 Approach 的边界以 Flow 为准 |
| 9–11 · Synthesis / Review / Versioning | [08-idea-synthesis-review.md](./08-idea-synthesis-review.md) | 需拆开综合、审查与版本循环；Review 不打分 |

## Canvas 三层

- **Exploration**：Seed、Directions、Papers、Questions — 我在哪个研究空间里？
- **Reasoning**：Problem、Hypothesis、Approach、Method、Evaluation — 我的研究逻辑是什么？
- **Synthesis**：Idea Summary、Review、Versions — 我现在形成了什么研究 Idea？

画布绑定与节点规则：

- [Huabu 领域映射与交互升级提案](../canvas/huabu-domain-binding.md)
- [节点展示与关系连接设计](../canvas/huabu-node-presentation-and-links.md)
- [研究画布](../canvas/research-canvas.md)

## 关联文档

- [Research Flow](../research-flow.md)
- [Idea 结构设计](../idea-structure.md)
- [Research Wiki 与 Idea Meta Space](../space.md)
- [Workspace 设计](../workspace.md)
