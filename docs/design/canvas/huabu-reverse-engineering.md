# Huabu 画布实现逆向 + CoResearch 原生重构

- 日期：2026-09-18
- 状态：逆向记录与重构映射；本次不安装依赖、不写代码。
- 逆向对象：`/Users/zmj/Desktop/Huabu`（microsoft/Huabu，MIT）。下文路径相对该仓库。
- 产出用途：[研究画布架构设计](./research-canvas.md) 的实现级依据。

本文分两部分：**第一部分**记录 Huabu 实际怎么实现的（读源码，不是读它的架构文档）；**第二部分**给出 CoResearch 原生重构该保留什么、砍什么、改什么。

---

# 第一部分 · 逆向

## 1. 引擎是一个纯函数

`packages/shared/src/canvas-engine/executor.ts`，359 行，整个画布写入的唯一入口：

```ts
executeCanvasCommands(
  execution: CanvasExecution,
  state: CanvasReadState,          // { nodes, edges, canvasId }
  options?: ExecutorOptions,
): ExecutorOutput                  // { writeResult, commandResults, pendingEffects }
```

它**明确不做**四件事（文件头注释逐条列出）：不调用 store 的 `set()`、不拍撤销快照（只在 `writeResult.snapshotNeeded` 置位）、不跑提交后副作用、不碰网络。这是"同一引擎能在服务端跑"的全部秘密——不是靠抽象层，是靠把宿主能力全部挪出去。

执行循环本身很朴素：

```ts
for (const cmd of execution.commands) {
  const handler = HANDLERS[cmd.type];
  const result = handler(cmd, { nodes: currentNodes, edges: currentEdges, canvasId, source });
  commandResults.push({ command: cmd, applied: result.applied, reason: result.reason });
  if (result.applied) {
    anyApplied = true;
    currentNodes = result.nodes;   // 下一条命令看到这条的结果
    currentEdges = result.edges;
    // 收集 pendingEffects / affectedFrameIds
  }
}
```

`HANDLERS` 是对 `CanvasCommandType` 穷尽的映射表（`commands/index.ts`），所以未知命令类型是**编译期错误**，运行时不需要防御分支。

### 1.1 批次末尾的三个统一 pass

这是设计上最值得学的一点：**命令不自己维护全局不变量，只声明自己影响了谁**，由执行器在批次末尾统一收口。

| pass | 做什么 | 为什么在批次末尾 |
|---|---|---|
| frame fit | 对 `affectedFrameIds` 做一次自适应尺寸 | 每条命令各自 fit 会重复计算且结果依赖顺序 |
| `normalizeTreeOrder` | 父节点必须排在子节点之前、子节点带父 zIndex | 否则 React Flow 直接抛 "Parent node not found" |
| note provenance | 仅 `source === 'agent'` 时按内容 diff 生成块级归属 | 用户输入时编辑器自己在维护，不能重复算 |

`normalizeTreeOrder` 幂等，且顺序已正确时**返回同一个数组引用**——常见批次只付 O(n) 检查，不排序不分配。这种"幂等 + 引用相等快路径"的写法让统一 pass 几乎零成本。

### 1.2 PendingEffects 是纯数据，永远不是回调

`interfaces.ts:73` 的注释说得很直接：引擎从不调用宿主 API，它只**描述发生了什么**。

```ts
interface PendingEffects {
  mutatedNodes: CanvasNode[];        // 带完整节点，不只是 id（下游要读 data.fileType 等）
  deletedNodeIds: string[];
  contentEditedNodeIds: string[];    // content 被重写的节点
  deferredFitFrameIds: string[];     // 明确标注 web-only 语义，服务端忽略
}
```

宿主各自 drain：web 跑 `runWebPostEffects`（触发预处理、延迟 refit、历史快照），服务端跑自己的。字段不适用就忽略——`deferredFitFrameIds` 在服务端是 no-op，因为没有 DOM 的异步测量问题。

这条让引擎彻底不知道宿主有什么能力。对比一下：如果 `PendingEffects` 里放的是回调，服务端就得造一批假回调。

### 1.3 `@xyflow/react` 只作类型导入

`interfaces.ts:31`：

```ts
export type CanvasNode = Node;   // 来自 @xyflow/react，但 import type
export type CanvasEdge = Edge;
```

ESLint 规则强制引擎不得引入 `@xyflow/react` 的运行时代码。连边路由器都只依赖框架无关的 `@xyflow/system`。所以引擎在 Node.js 里跑不需要 DOM。

别名存在的另一个理由写在注释里：将来换渲染器时只改别名，不动每个 handler。

## 2. 命令契约

### 2.1 三层的边界在哪

| 层 | 位置 | 能看到什么 |
|---|---|---|
| `CanvasUiIntent` | `apps/web/src/handler/canvasCommand/uiIntent.ts`（796 行，22 种 intent） | 选区、剪贴板、拖拽会话、视口、矩形命中——**全是易失前端状态** |
| `CanvasCommand` | `packages/shared/src/types/canvas/command.ts`（371 行，17 种） | 只有显式操作数：node id、frame id、edge id、scope |
| `CanvasExecution` | `types/canvas/execution.ts`（60 行） | 批次边界：一起校验、一个撤销步、一条 trace、一组后效 |

22 种 intent 里 8 种是复合手势（需要解析选区/剪贴板/拖拽/视口），14 种是薄包装直接映射到命令。判断标准很清楚：**这个手势的含义是否依赖前端易失状态**。`GROUP_SELECTION_INTO_FRAME` 依赖当前选区，所以没有对应的共享命令；它解析成 `CREATE_NODES + SET_NODE_PARENT + SET_NODE_SELECTION` 三条。

`CanvasExecution` 存在的理由写在架构文档里：UiIntent 太早（web-only，agent 用不了），CanvasCommand 太小（一个逻辑动作常跨多条命令）。撤销和 trace 只能挂在中间这一层。

### 2.2 命令的五条硬规则

`CanvasCommand` 每条必须：JSON 可序列化；可以读持久画布状态；**不得依赖 UI 状态**；操作数显式；无法应用时返回 `applied: false` 且无任何副作用。

命令是"最小共享可执行领域指令"，**不是最小状态差分**——所以一条命令可以拥有确定性的领域行为：`DELETE_NODES` 自动删除关联边，`SET_NODE_PARENT` 拒绝环和非容器父节点，`CONNECT_NODES` 在端点不存在时整条拒绝而**不静默丢边**。

失败原因是封闭枚举，8 个值：

```ts
type CanvasCommandFailureReason =
  | 'no-op' | 'not-found' | 'invalid-parent' | 'invalid-target'
  | 'invalid-scope' | 'cycle' | 'duplicate-id' | 'conflict';
```

### 2.3 坐标：parent-local 是唯一契约

`CREATE_NODES.position` 和 `SET_NODE_GEOMETRY.position` 一律是**相对直接父 frame** 的坐标，无父时等于世界坐标。web 的 resolver 在发命令前就转换好，agent 的工具 schema 同样如此——**工具边界和执行器之间没有 absolute→relative 适配层**。

但契约是"把输入解释为 parent-local"，不是"原样持久化"：后续的 frame-fit 或结构化布局可能重写这个局部值（hug frame 移动原点后会改写所有子节点的 local 以保持世界位置不变）。读侧另外暴露只读的 `absolutePosition`。

### 2.4 id：两端规则不同

- **UI 端**自己 mint `node-<uuid>`，所以同一批次里后面的命令能引用前面 `CREATE_NODES` 的 id。
- **Agent 端禁止自带 id**。canonical schema 直接拒绝，服务端 `preAssignIds()`（`canvas-executor.ts:338`）统一分配。要连刚建的节点，agent 得读回传的 id 再发一次调用，**不能在同一批次里自引用自己编的 id**。

这条是防幻觉的硬约束：LLM 编的 id 不会进入系统。

### 2.5 内容写入的 CAS

`CanvasNodeDataMergePatch.expectRev` 是内容修订令牌，**是 `patch` 的兄弟字段，绝不会被合进节点数据**。服务端比对后拒绝：

```ts
interface ExecuteConflict {
  nodeId: string;
  reason: 'not-read' | 'stale';    // 从没读过 vs 读的是旧版本
  expectedRev?: string;
  currentRev: string;
  currentContent?: string;         // 回显，免得再读一次
}
```

`'not-read'` 这个值很关键：agent 在本轮对话里**从没读过这个节点**就想改它的内容，会被拒，且原样重试同一条命令还是被拒——必须先 read。这不是并发控制，是"不许闭眼写"。

agent 的 `expectRev` 由服务端从本轮 read-set 自动注入；ui / system 的写是无条件的。

## 3. 服务端

### 3.1 互斥锁只有 13 行

`write-coordinator.ts`：

```ts
const canvasMutexChains = new Map<string, Promise<unknown>>();

export async function withCanvasMutex<T>(canvasId, task): Promise<T> {
  const prev = canvasMutexChains.get(canvasId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  canvasMutexChains.set(canvasId, next);
  try { return await next; }
  finally { if (canvasMutexChains.get(canvasId) === next) canvasMutexChains.delete(canvasId); }
}
```

Promise 链就是队列。`prev.catch(() => undefined)` 保证前一个任务失败不会毒化整条链。多锁场景 `withCanvasMutexes` 先 `sort()` 再递归获取——排序防死锁。

文档里反复强调这是**单进程应用策略，不是后端事务或分布式锁**。

### 3.2 executeOnServer 的顺序

```text
assertCurrentCanvasCommands(commands)   // own-property 查 COMMAND_META，批次 I/O 之前
  → preAssignIds(commands)              // agent 的 id 在这里生成
  → withCanvasMutex(canvasId)
      → 读当前状态
      → executeCanvasCommands(...)      // 共享引擎
      → diff prestate → poststate       // 得到粗粒度 Delta[]
      → 持久化：node sidecars → space.json → delta-log.jsonl
      → version += 1
  → 广播 SSE
```

**no-op 批次不 bump 版本、不写日志**——全部命令被拒时 `toVersion === fromVersion`，幂等调用不会给并发客户端制造假变更和 409。

返回结构里 `results[].nodes` 回显每个新建节点的 server-assigned id + label + width/height（图片还带 src），`results[].edges` 同理。这两条——**逐条 applied/reason + 新建 id 回传**——是 agent 循环能自纠错的全部机制。

### 3.3 持久化形状

```text
<space>/
  space.json                  # { canvasId, title, version, state:{nodes,edges} }
  nodes/<safe(label)>.md      # frontmatter: id/type/label/src + markdown 正文
  .artifacts/<artifactId><ext>
  .history/
    events.jsonl              # action log：{ ts, payload: RecentAction } 每行一条
    delta-log.jsonl           # executor 的私有 journal，按提交版本键入
```

拓扑在 `space.json`，**正文在 sidecar `.md`**——所以用户能在 Finder 里直接读写笔记，也是 external-note watcher 存在的理由。节点文件名用 `safe(label)`，稳定 id 在 frontmatter 的 `id:` 字段（文件名可变，id 不可变）。

存储抽象成 `StructuredStore`（记录）/ `BlobStore`（字节）两个 port，Disk 和 SQLite 两套适配器，**字节永远是文件**（"no structured backend is ever asked to hold bytes"）。

### 3.4 Delta 是粗粒度的，但可精确反演

```ts
type Delta =
  | { type: 'INSERT_NODE'; node } | { type: 'DELETE_NODE'; node }
  | { type: 'REPLACE_NODE'; prev; next }
  | { type: 'INSERT_EDGE'; edge } | { type: 'DELETE_EDGE'; edge }
  | { type: 'REPLACE_EDGE'; prev; next };
```

任何原地修改都变成 `REPLACE_*` 携带完整的 prev 和 next——刻意不做属性级差分（注释里说属性级是 future-M5，格式已经能容纳）。换来的是 `invertDelta` 的精确可逆：**一条 delta 加它的逆就是撤销/重放原语，不需要重跑命令引擎**。

`applyDeltas` 对 `REPLACE_*` / `DELETE_*` 的未知 id 宽容跳过——为乱序广播准备的，服务端仍是唯一真值。

web 端收到服务端 delta 后是**纯 apply**，不本地重放命令；版本门控 `localVersion >= toVersion` 直接跳过。UI 手势则本地先跑一遍引擎拿乐观反馈再 POST。

## 4. 托管字段：本次逆向最有价值的一段

`canvas-engine/agentNodeOwnership.ts`，101 行，解决"某些节点字段不归画布命令管"。

```ts
export const AGENT_NODE_OWNED_DATA_KEYS = [
  'bindingState', 'status', 'errorMessage', 'invocationToken',
  'viewed', 'threadId', 'conversationTitleSource',
] as const;

projectAgentNodeEditableData(data)              // 剔除受保护键 → 浏览器保存用这个
preserveAgentNodeOwnedData(incoming, current)   // 用 current 的值强制覆盖 incoming
replayAgentNodeEditableData(current, before, after)  // 撤销重放：只放差异字段，跳过受保护键
```

关键不在这三个函数，而在**它们被放在写入路径上**：不是要求调用方自觉不写这些字段，而是写入时无条件投影掉。服务端校验再补一刀——**显式写入一律拒绝，包括标了 `originator.source: 'system'` 的请求**。

`replayAgentNodeEditableData` 的实现值得单独看：撤销时它不套用整份旧快照，而是比较 before/after 逐键决定：

```ts
for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
  if (protectedKeys.has(key) || JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
  if (hasOwnProperty(after, key)) result[key] = after[key]; else delete result[key];
}
```

因为旧快照里的 `threadId`、`status` 是**当时的观测值**，套回去等于把业务状态倒带。撤销只该撤销用户的编辑。

## 5. 投影器模式

`world-previews.ts` —— 这是 CoResearch 要照抄的骨架。World 画布上每个 Space 有一个 `spacePreview` 节点，由系统协调保持一致：

```text
planWorldPreviewReconciliation()
  读 World 当前节点 → 按 targetCanvasId 建索引
  重复 target / 无效 target → 直接抛 WorldPreviewIntegrityError（不是静默修复）
  读 Space 成员列表 → 排序（list() 不保证顺序，确定性布局靠这里排）
  算出：deleteNodeIds（目标已消失的）+ inputs（缺失的，分配确定性空槽位）

reconcileWorldPreviewsOnce()
  无事可做 → 直接返回
  组装普通命令：DELETE_NODES + CREATE_NODES
  executeOnServer({ originator: { source: 'system' } })
  若有命令被拒 → 重新 plan，只有验证为空才算成功，否则抛错
```

四个决定值得记：

1. **不发明新命令**。协调只用 `DELETE_NODES` / `CREATE_NODES`，于是撤销、delta、同步、action log 全部自动复用。
2. **保留既有节点身份与用户几何**。已存在的 preview 不重建，用户拖到哪就在哪。
3. **被拒不静默吞掉**。重新 plan 验证是否已被别的 writer 满足，否则抛错——"Accept only a freshly verified complete state, never a blanket suppression of rejected work."
4. **串行化**。`reconciliationQueue` promise 链，同 mutex 思路。

配套的 `world-preview-policy.ts` 负责托管身份的强制：非系统命令不能创建/重指向托管 preview、不能改类型、不能删除目标仍存活的 preview（**包括通过删除祖先 Frame 绕过**）。用户仍可移动、缩放、放进普通 Frame。

## 6. 逆向小结：哪些是通用工程决策，哪些是 Huabu 特有

| 决策 | 性质 |
|---|---|
| 引擎纯函数 + PendingEffects 纯数据 | 通用，直接可用 |
| 三层 intent/command/execution | 通用 |
| 批次末尾统一 pass + 幂等快路径 | 通用 |
| 粗粒度可逆 delta | 通用 |
| promise-chain 互斥 | 通用 |
| agent 禁止自带 id + 逐条 applied/reason | 通用（凡是让 LLM 写状态的系统都需要） |
| CAS 的 `'not-read'` 语义 | 通用且少见，值得抄 |
| 托管字段投影 | 通用，且正是 CoResearch 的核心需求 |
| 投影器用普通命令 | 通用 |
| 结构化 Frame 求解器（`autoLayout/gridLayout.ts`） | Huabu 特有，极复杂（架构文档里单这一节 15 段） |
| 自动边路由（组推断 / 障碍采样 / 滞后保持） | Huabu 特有，同样极复杂 |
| sidecar `.md` + external watcher | Huabu 特有的产品选择 |
| Space Move / World / 多 Workspace | Huabu 特有 |

---

# 第二部分 · CoResearch 原生重构

## 7. 一个根本反转

Huabu：`space.json` 是 source of truth，画布即真值。
CoResearch：`research/` 是 source of truth，**画布是投影**。

这个反转决定了所有取舍。它不是削弱，而是让 §4 的托管字段机制从"少数字段的例外"升级成**主干**：在 CoResearch 里，研究内容字段全部是托管的，用户可写的只有布局和批注。

```text
Huabu                          CoResearch
──────────────────────────     ──────────────────────────
用户/Agent 写画布              投影器写研究字段（托管）
  → space.json（真值）           用户写布局与批注（自由）
  → sidecar .md                → space.json 降级为投影缓存
                               → research/（真值）
```

`space.json` 降级为缓存的直接后果：**它可以被删掉重建**。这是个很强的性质——投影器是纯函数，同一组 `research/` 实体 + 同一 `projectorVersion` 必须产出等价画布（布局层另存）。

## 8. 保留清单

原样保留（照 §1–§5 实现）：

| 来源 | 保留内容 |
|---|---|
| `executor.ts` | 纯函数签名、顺序执行、`anyApplied`、批次末尾统一 pass |
| `interfaces.ts` | `CanvasReadState` / `CanvasWriteResult` / `PendingEffects` 纯数据 |
| `commands/types.ts` | `CommandHandlerResult`、`CommandMeta`、`noop()` helper |
| `commands/index.ts` | `HANDLERS` / `COMMAND_META` 穷尽注册表 |
| `delta.ts` | 6 种粗粒度 delta + `invertDelta` + 宽容 `applyDeltas` |
| `execution.ts` | `source: 'ui'|'agent'|'system'`、8 值失败枚举、`ExecuteConflict` |
| `write-coordinator.ts` | promise-chain 互斥 + 排序多锁 |
| `canvas-executor.ts` | `preAssignIds`、no-op 不 bump 版本、`results[].nodes` 回传 |
| `agentNodeOwnership.ts` | 三个投影函数的形状，尤其 `replay` 的逐键差异重放 |
| `world-previews.ts` | plan → 普通命令 → 被拒重新 plan → 串行队列 |

`@xyflow/react` 只作类型导入这条 ESLint 规则从第一天就加，否则引擎迟早被污染成跑不了服务端。

## 9. 砍掉清单

V1 明确不做，且**不是"以后补"，是"证明需要再说"**：

| 砍掉 | 理由 |
|---|---|
| 结构化 Frame 求解器 | 泳道是固定分层布局，不需要 column/row/grid 三模式 + 边感知 gutter + 拖放预览 |
| 自动边路由 | 研究关系边数量可控，用 xyflow 默认 smoothstep 即可 |
| sketch / office / video / audio 节点 | 研究画布用不到 |
| Electron 桌面端 | V1 web |
| 多 Workspace / World / Space Move | CoResearch 一个项目一张画布 |
| 节点预处理管线 | 论文导入走 Step 2 的 Searcher/Reader，不走画布 |
| interactive views | 无需求 |
| SQLite 后端 | 先 Disk；port 分层保留，换后端时不改上层 |

对应地，命令集从 17 条裁到 **8 条**（原始 V1 判断；下方已更新为最终结论）：

```ts
type CanvasCommandType =
  | 'CREATE_NODES' | 'DELETE_NODES' | 'MERGE_NODE_DATA'
  | 'SET_NODE_GEOMETRY' | 'SET_NODE_PARENT'
  | 'CONNECT_NODES' | 'DISCONNECT_EDGES'
  | 'SET_NODE_SELECTION';
```

推迟：`ALIGN_NODES` / `DISTRIBUTE_NODES` / `REORDER_NODES` / `SET_NODE_LOCKED` / `CHANGE_NODE_TYPE` / `DISSOLVE_FRAME` / `SET_FRAME_LAYOUT` / `APPLY_MEASURED_HEIGHT`。注册表是穷尽映射，加一条就是加一个文件加两行注册，不需要预留。

> **更新（[ADR 0010](../../adr/0010-restore-structured-frame-layout.md)）**：`SET_FRAME_LAYOUT` 已从"推迟"列表移出、恢复，命令集实际是 **9 条**——Step 泳道的删除空隙压缩、节点内容变长后的下游让位，靠 Research Projector 手写等于重新发明半个布局引擎，这两个场景需要 Huabu 现成的结构化 Frame 求解器。其余 7 条仍然推迟。

## 10. 改动清单

### 10.1 托管键从例外变主干

```ts
// packages/shared/src/research/ownership.ts
export const RESEARCH_OWNED_DATA_KEYS = [
  'entityKind', 'refId', 'refRevision', 'refContentHash',
  'status', 'origin', 'confirmed', 'stale', 'summary', 'evidenceRefs',
] as const;

export const USER_OWNED_DATA_KEYS = ['userNote', 'pinned', 'collapsed'] as const;
```

三个函数照 `agentNodeOwnership.ts` 的形状：`projectResearchEditableData` / `preserveResearchOwnedData` / `replayResearchEditableData`。

服务端校验同样补一刀：**非 `system` 来源的批次触碰这些键一律拒绝，返回 `reason: 'invalid-scope'`**。Huabu 连标了 `source: 'system'` 的请求都拒（因为那是伪造的标签），CoResearch 的区别是投影器**确实**是 system——所以拒绝条件改为"不是由投影器内部入口发起的"，而不是看 originator 标签。这点必须在实现时落实为不同的函数入口，不是同一个入口加个参数。

### 10.2 `stale` 是投影器的输出，不是命令的输入

```ts
type StalenessReason =
  | 'upstream_revision_changed'
  | 'upstream_assessment_changed'
  | 'landscape_refreshed';
```

投影时逐节点比对 `refContentHash` 与 `research/` 当前值，不符则置位。**`stale` 不撤销任何确认**（`04-problem-formation.md:409`、`03-direction-focus.md:337`）。它是可见性，不是状态机。

### 10.3 节点类型：1 个而不是 15 个

```ts
const CANVAS_NODE_TYPES = ['crEntity', 'frame', 'note', 'question', 'pdf', 'web'] as const;

interface CrEntityNodeData {
  // 托管区（投影器写）
  entityKind: 'seed' | 'direction' | 'phase' | 'focus' | 'problem' | 'claim'
    | 'hypothesis' | 'prediction' | 'work' | 'question' | 'probe'
    | 'requirement' | 'approach' | 'operation' | 'component';
  refId: string;
  refRevision: number;
  refContentHash: string;
  status: string;          // 各步骤自己的状态枚举，原样携带不翻译
  origin: string;
  confirmed: boolean;
  stale: false | StalenessReason;
  summary: string;
  evidenceRefs: string[];

  // 用户区
  userNote?: string;
  pinned?: boolean;
  collapsed?: boolean;
}
```

15 种 kind 共享一套所有权策略、staleness 规则和视觉编码；拆成 15 个节点类型等于把同一条规则重复保证 15 次。`status` 字段**原样携带各步骤的枚举值不做归一**——Step 4 的 `supported` 和 Step 5 的 `directly_studied` 语义方向相反，归一成统一状态一定会把其中一个显示反。翻译成视觉编码是渲染层的事，且要分 kind 处理。

### 10.4 投影器

```ts
interface ProjectionPlan {
  createInputs: CanvasNodeCreateInput[];   // research/ 有、画布没有
  deleteNodeIds: CanvasNodeId[];           // 画布有、research/ 没有
  mergePatches: CanvasNodeDataMergePatch[]; // 两边都有但 contentHash 不符
  connectInputs: CanvasEdgeCreateInput[];
  disconnectRefs: CanvasEdgeRef[];
}
```

照 `planWorldPreviewReconciliation` 的四条：不发明新命令（只用那 5 条）；保留既有节点身份与用户几何（`mergePatches` 只含托管键）；被拒不静默吞掉（重新 plan 验证为空才算成功）；串行队列。

分配新节点位置时同样要**先排序再分配**——实体列表的读取顺序不保证稳定，确定性布局靠显式排序，不靠后端扫描顺序。

### 10.5 sidecar 保留，语义不同

Huabu 的 `nodes/<label>.md` 是节点正文的真值。CoResearch 里 `research/problems/<id>/` 已经是真值，画布的 sidecar 只该存**用户批注**：

```text
.coresearch/canvas/
  space.json            # 投影缓存，可删可重建
  annotations/<node-id>.md
  layout.json
  delta-log.jsonl
```

放进 `.coresearch/`（运行时数据）而不是 `research/`，因为它不是研究状态——这和 [Workspace 设计](../workspace.md) 的四层模型一致。批注要"提升"为研究输入时，走步骤页的 `user_message` 入口，不是直接改 `research/`。

## 11. 包结构

```text
packages/shared/src/
├── canvas-engine/
│   ├── executor.ts           # 照抄结构，砍掉 provenance；frame 求解已恢复（ADR 0010）
│   ├── interfaces.ts         # 原样
│   ├── delta.ts              # 原样
│   ├── diff.ts               # 原样
│   ├── commands/             # 9 个文件 + types.ts + index.ts（含 setFrameLayout.ts，ADR 0010）
│   └── postEffects.ts
├── types/canvas/
│   ├── command.ts            # 9 条命令的判别联合（ADR 0010 恢复 SET_FRAME_LAYOUT）
│   ├── execution.ts          # 原样
│   ├── node.ts               # crEntity + 5 个复用类型
│   └── edge.ts
└── research/
    ├── entities.ts           # Research Flow 各步的实体类型（从设计文档提取）
    └── ownership.ts          # RESEARCH_OWNED_DATA_KEYS + 三个投影函数

apps/web/src/
├── handler/canvasCommand/    # uiIntent + resolvers（仅前端）
├── store/canvasStore.ts
└── components/Nodes/CrEntity/

apps/server/src/modules/
├── canvas/
│   ├── canvas-executor.ts    # executeOnServer + preAssignIds
│   └── write-coordinator.ts  # 照抄 13 行
└── research/
    ├── projector.ts          # plan → 命令批次
    └── ownership-guard.ts    # 非投影器入口拒绝托管键
```

依赖方向照 Huabu 的规则：`pages → components/handler/hooks/store/api`，`utils` 不得向上引用。新命令加在共享引擎并注册进 `HANDLERS`/`COMMAND_META`，不加在 web 里。

## 12. 实施顺序

1. **引擎骨架**：`executeCanvasCommands` + `CREATE_NODES` / `DELETE_NODES` + delta + invert。测试先行，照 Huabu 的 `__tests__/` 覆盖点写：delta 往返、树序不变量、全拒即 no-op。
2. **所有权守卫**：`RESEARCH_OWNED_DATA_KEYS` 三个投影函数 + 服务端拒绝路径。**必须先于任何 UI**——反过来做的话 UI 会先把托管字段当普通字段编辑，之后收不回来。
3. 补齐其余 6 条命令 + `withCanvasMutex` + `executeOnServer` + delta log。
4. **投影器只读跑通**：Seed + 一条 Direction + Focus，三节点一条派生边，从真实 `research/` 读。
5. staleness 检测。
6. web 端：xyflow + `crEntity` 渲染 + `applyDeltas`。
7. uiIntent + resolvers（布局与批注）。
8. 补齐 Step 2–6 泳道；`question` 节点接 Agent。

第 1–3 步完全没有 UI，可以纯 Node 跑测试。这是照抄 Huabu 分层的直接好处。

## 13. 验收场景

| 场景 | 不变量 |
|---|---|
| 用户拖动研究节点 | 位置持久化到 layout，托管字段不变 |
| 用户编辑 Problem 节点正文 | 拒绝，`reason: 'invalid-scope'` |
| 伪造 `source: 'system'` 的批次改托管字段 | 拒绝——权限看的是函数入口，不是 originator 标签 |
| Agent 新建节点后要连线 | 用 `results[].nodes` 回传的 id；自带 id 的 `CREATE_NODES` 被拒 |
| Agent 没读过节点就改内容 | `ExecuteConflict.reason = 'not-read'`，原样重试仍被拒 |
| 整批命令被拒 | `toVersion === fromVersion`，不写 delta log，不广播 |
| 撤销一次用户编辑 | 逐键重放差异，`refContentHash` / `stale` 等观测值不倒带 |
| 删除 `space.json` 后重新投影 | 研究内容完整重建；用户布局从 `layout.json` 恢复 |
| 上游 Problem 出新 revision | 下游 Hypothesis 置 stale，`confirmed` 不变 |
| 投影器某条命令被拒 | 重新 plan；验证为空才算成功，否则抛错 |
| 父子节点顺序错乱 | `normalizeTreeOrder` 收口，React Flow 不抛 Parent not found |

## 14. 使用边界

本文的 Huabu 事实来自直接阅读源码：`canvas-engine/{executor,interfaces,delta,agentNodeOwnership}.ts`、`canvas-engine/commands/{types,index}.ts`、`types/canvas/{command,execution,node}.ts`、`modules/canvas/{canvas-executor,write-coordinator,world-previews,world-preview-policy}.ts`，以及其 `docs/architecture/` 下的命令、存储、web 三份架构文档。**未运行该应用**，性能、同步、存储表现均未实测；引用的是它的设计决策与代码结构，不是对其运行质量的实证判断。

Huabu 为 MIT 许可（Microsoft Corporation）。本文采用的是架构决策而非源码复制；如后续直接复制其源码片段，需保留版权与许可声明。

领域流程与 Gate 以 [Research Flow](../research-flow.md) 为准；分步契约见 [Idea Formation](../idea-formation/README.md)。
