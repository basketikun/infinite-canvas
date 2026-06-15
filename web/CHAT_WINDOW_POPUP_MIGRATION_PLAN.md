# 聊天窗口弹窗前端移植方案

本文档用于确认：将 `/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow` 中右下角聊天窗口弹窗体验，融合移植到 `/Users/a1/Desktop/infinite-canvas/web` 的画布页面。

本次移植不复制 TwitCanva 的 Express `/api/chat` 后端，也不迁移 TwitCanva 的 `server/agent/*`。聊天问答、生图、图文上下文请求统一接入 `/Users/a1/Desktop/mange-backend` 的 OpenAI 兼容 relay。

## 最终选择

后端接入选择原方案 B：

```txt
前端仍请求 /api/v1/*
Next 代理把 /api/v1/* 转发到 mange-backend /v1/*
AI 请求头使用 mange-backend 登录后自动获取的 relay API Key
```

完整链路：

```txt
infinite-canvas 桌面端前端
    -> /api/v1/chat/completions
    -> Next /api/[...path] 代理
    -> mange-backend /v1/chat/completions
    -> middleware.TokenAuth()
    -> Authorization: Bearer sk-...
    -> controller.Relay(...)
```

这个方案依赖桌面端登录方案：

```txt
web/DESKTOP_AUTH_MANGE_BACKEND_PLAN.md
```

也就是说，聊天窗口本身不处理用户注册和 API Key 创建；它只消费登录流程已经保存好的 `relayApiKey`。

## 目标效果

1. 画布页面右下角出现聊天浮动按钮。
2. 点击按钮后，右侧弹出画布助手聊天窗口。
3. 聊天窗口打开时，右下角按钮隐藏。
4. 点击聊天窗口关闭按钮后，窗口收起，右下角按钮重新出现。
5. 默认进入“对话”模式，而不是“生图”模式。
6. 聊天窗口可发送文本消息。
7. 聊天窗口可基于当前选中的图片/文本节点进行上下文问答。
8. 保留当前项目已有的会话历史、新建会话、删除会话能力。
9. AI 回复文本可插入画布为文本节点。
10. AI 生成图片可插入画布为图片节点。

## 当前项目基础

目标前端已经有画布助手面板，不需要从零实现完整 Chat UI。

相关文件：

```txt
web/src/app/(user)/canvas/[id]/canvas-client-page.tsx
web/src/app/(user)/canvas/components/canvas-assistant-panel.tsx
web/src/app/(user)/canvas/types.ts
web/src/app/(user)/canvas/stores/use-canvas-store.ts
web/src/services/api/image.ts
web/src/app/api/[...path]/route.ts
```

当前已有能力：

| 能力 | 当前状态 | 位置 |
| --- | --- | --- |
| 右侧助手面板 | 已有 | `canvas-assistant-panel.tsx` |
| 面板打开/收起状态 | 已有 | `assistantCollapsed`、`assistantMounted` |
| 会话数据结构 | 已有 | `CanvasAssistantSession` |
| 会话保存到画布项目 | 已有 | `use-canvas-store.ts` |
| 文本问答请求 | 已有 | `requestImageQuestion()` |
| 图片生成请求 | 已有 | `requestGeneration()`、`requestEdit()` |
| 图片/文本节点引用 | 已有 | `buildAssistantReferences()` |
| 插入文本到画布 | 已有 | `insertAssistantText()` |
| 插入图片到画布 | 已有 | `insertAssistantImage()` |

移植方式是“融合当前画布助手”，不是原样搬运 TwitCanva 的 `ChatPanel.tsx`。

## 后端接口确认

`mange-backend` relay 路由位于：

```txt
/Users/a1/Desktop/mange-backend/router/relay-router.go
```

已存在：

```txt
POST /v1/chat/completions
POST /v1/images/generations
POST /v1/images/edits
POST /v1/audio/speech
GET  /v1/models
```

这些接口挂在后端根路径 `/v1/*`，不是 `/api/v1/*`。

`mange-backend /v1/*` 使用：

```txt
middleware.TokenAuth()
```

因此 AI 请求必须带：

```txt
Authorization: Bearer sk-...
```

其中 `sk-...` 是 `mange-backend` 自己签发/保存的 relay API Key，不是当前 `infinite-canvas` 旧登录 token，也不是 `mange-backend` dashboard access token。

## Next 代理方案

当前 Next 项目里浏览器请求统一使用 `/api/*` 是前端软约定，这个约定保留。

需要修改：

```txt
web/src/app/api/[...path]/route.ts
```

代理规则：

```txt
如果 path[0] 是 v1 / v1beta / mj / suno：
    target = ${API_BASE_URL}/${path...}
否则：
    target = ${API_BASE_URL}/api/${path...}
```

示例：

```txt
前端请求：
/api/v1/chat/completions

实际转发：
http://127.0.0.1:8080/v1/chat/completions
```

普通后台 API 仍保持：

```txt
前端请求：
/api/user/login

实际转发：
http://127.0.0.1:8080/api/user/login
```

拟改代码：

```ts
const relayPrefixes = new Set(["v1", "v1beta", "mj", "suno"]);
const encodedPath = path.map(encodeURIComponent).join("/");
const targetPath = relayPrefixes.has(path[0]) ? `/${encodedPath}` : `/api/${encodedPath}`;
const target = `${apiBaseUrl.replace(/\/$/, "")}${targetPath}${request.nextUrl.search}`;
```

## 鉴权方案

AI remote 模式不能继续使用旧的：

```ts
useUserStore.getState().token
```

应改为使用桌面端登录流程保存的：

```txt
relayApiKey
```

请求头：

```txt
Authorization: Bearer ${relayApiKey}
```

推荐统一规则：

```txt
channelMode = remote:
    URL = /api/v1${path}
    Authorization = Bearer relayApiKey

channelMode = local:
    URL = buildApiUrl(config.baseUrl, path)
    Authorization = Bearer config.apiKey
```

这样桌面端默认走 `mange-backend`，高级用户仍可保留本地直连 OpenAI 兼容服务的能力。

## 前端移植映射

| TwitCanva | infinite-canvas/web |
| --- | --- |
| `ChatBubble` | 新增或内联 `CanvasChatBubble` |
| `ChatPanel` | 复用并调整 `CanvasAssistantPanel` |
| `usePanelState.isChatOpen` | 复用 `assistantCollapsed` / `assistantMounted` |
| `useChatAgent.sendMessage()` | 复用 `CanvasAssistantPanel.sendMessage()` |
| `/api/chat` | 不迁移，改走 `/api/v1/chat/completions` |
| `library/chats/*.json` | 不迁移，会话继续保存到当前画布项目 |
| 拖拽节点到聊天 | 第一阶段不做，沿用“选中节点即引用” |

## 拟修改文件

### 1. `canvas-client-page.tsx`

路径：

```txt
web/src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

改动：

1. 新增统一打开助手函数。
2. 顶部助手按钮复用同一个打开函数。
3. 在画布右下角新增聊天浮动按钮。
4. 助手面板展开时隐藏右下角按钮。

示例：

```tsx
const openAssistant = useCallback(() => {
    setAssistantMounted(true);
    setAssistantCollapsed(false);
}, []);
```

按钮示例：

```tsx
{assistantCollapsed ? <CanvasChatBubble onClick={openAssistant} /> : null}
```

建议按钮属于画布区域，优先使用 `absolute bottom-6 right-6`，避免 `fixed` 和右侧面板、全局弹窗层级互相干扰。

### 2. `canvas-assistant-panel.tsx`

路径：

```txt
web/src/app/(user)/canvas/components/canvas-assistant-panel.tsx
```

改动：

1. 标题从 `画布助手(未开发)` 改为 `画布助手`。
2. 默认模式改为 `ask`。
3. 空态文案改成聊天引导。
4. 保留现有 `AssistantComposer`、`AssistantMessages`、`AssistantHistory`。
5. 保留输入区“对话/生图”模式切换。

默认模式：

```tsx
const [mode, setMode] = useState<AssistantMode>("ask");
```

空态文案示例：

```txt
选中画布上的图片或文本节点后提问，助手会自动把它们作为上下文。
```

### 3. `src/services/api/image.ts`

路径：

```txt
web/src/services/api/image.ts
```

改动：

1. `requestImageQuestion()` 继续作为聊天问答入口。
2. remote 模式继续请求 `/api/v1/chat/completions`。
3. remote 模式请求头改用 `relayApiKey`。
4. 保留 local 模式使用 `config.apiKey` 的逻辑。

### 4. `src/services/api/audio.ts`

路径：

```txt
web/src/services/api/audio.ts
```

改动：

1. remote 模式继续请求 `/api/v1/audio/speech`。
2. remote 模式请求头改用 `relayApiKey`。
3. 保留 local 模式。

### 5. `src/services/api/video.ts`

路径：

```txt
web/src/services/api/video.ts
```

改动：

1. remote 模式继续请求 `/api/v1/videos` 等当前路径。
2. 如果后续视频也统一走 `mange-backend` relay，需要同步检查真实后端路径。
3. remote 模式请求头不要再依赖旧登录 token。

聊天窗口第一阶段主要依赖 `image.ts`，但为了避免远程 AI 鉴权逻辑分裂，建议同时检查 `audio.ts` 和 `video.ts`。

### 6. `src/app/api/[...path]/route.ts`

路径：

```txt
web/src/app/api/[...path]/route.ts
```

改动：

1. 增加 relay 前缀分流。
2. 保留普通 `/api/*` 后台接口转发。
3. 继续透传请求头和请求体。
4. 注意不要丢失流式响应能力。

## 会话存储方案

会话继续保存到当前画布项目中：

```ts
chatSessions: CanvasAssistantSession[];
activeChatId: string | null;
```

位置：

```txt
web/src/app/(user)/canvas/stores/use-canvas-store.ts
```

不新增后端聊天历史接口，不新增聊天历史数据表。

原因：

1. 当前画布项目主要保存在浏览器/桌面端本地。
2. 聊天会话与具体画布强绑定。
3. 现有项目已经包含 `chatSessions` 和 `activeChatId` 字段。

## 媒体/节点上下文方案

第一阶段不实现 TwitCanva 的“拖拽节点到聊天窗口”。

继续沿用当前项目逻辑：

```txt
选中图片/文本节点
    -> buildAssistantReferences()
    -> selectedReferences
    -> buildChatMessages()
    -> requestImageQuestion()
```

这样可以复用：

1. 当前节点选择逻辑。
2. `storageKey`。
3. `imageToDataUrl()`。
4. 当前图片/文本引用编号逻辑。

后续如果需要拖拽体验，可以把拖拽结果转成选中节点：

```ts
onSelectNodeIds(new Set([nodeId]));
```

不新增第二套附件状态。

## UI 细节

### 右下角按钮

1. 使用 `MessageSquare` 或 `Sparkles` 图标。
2. 使用当前 `canvasThemes`、`useThemeStore` 或 Ant Design token。
3. 不硬编码纯黑/纯白、stone、slate 等颜色。
4. 尺寸建议 `48px`。
5. `z-index` 高于画布节点和工具栏，低于 Modal。
6. 打开面板后隐藏。

### 右侧面板

1. 复用当前 `CanvasAssistantPanel`。
2. 保留拖动调整宽度。
3. 保留收起动画。
4. 保留历史记录面板。
5. 输入区保留“对话/生图”模式切换。

### 顶部入口

保留顶部“助手”按钮，同时新增右下角聊天按钮。

原因：

1. 不破坏现有用户习惯。
2. 右下角按钮只是新增聊天入口。
3. 两个入口调用同一个 `openAssistant()`。

## 不迁移内容

以下 TwitCanva 内容不迁移：

```txt
src/hooks/useChatAgent.ts
server/index.js 中的 /api/chat
server/agent/index.js
server/agent/graph/chatGraph.js
server/agent/prompts/system.js
library/chats 文件存储逻辑
拖拽节点到聊天窗口
```

原因：

1. 目标项目已有 `CanvasAssistantPanel` 和会话存储。
2. 后端已确定为 `mange-backend`。
3. `mange-backend` 已提供 OpenAI 兼容 relay。
4. 引入 TwitCanva Express/LangGraph 会造成第二套后端和第二套会话体系。
5. 拖拽节点可以后续在当前“选中节点即引用”的基础上增强。

## 实施顺序

建议按以下顺序实现：

1. 完成桌面端登录与 relay API Key 初始化方案，确保前端 store 中有 `relayApiKey`。
2. 修改 `web/src/app/api/[...path]/route.ts`，让 `/api/v1/*` 转发到 `mange-backend /v1/*`。
3. 修改 AI API 请求头，remote 模式使用 `relayApiKey`。
4. 修改 `canvas-client-page.tsx`，新增右下角聊天按钮并复用打开助手逻辑。
5. 修改 `canvas-assistant-panel.tsx`，去掉“未开发”、默认进入对话模式、调整空态文案。
6. 验证文本问答。
7. 验证选中图片/文本节点后的上下文问答。
8. 验证 AI 回复文本插入画布。
9. 验证 AI 生成图片插入画布。

## 验收标准

1. 进入画布详情页后，右下角出现聊天按钮。
2. 点击右下角按钮后，右侧助手面板展开。
3. 面板展开后，右下角按钮隐藏。
4. 点击面板关闭按钮后，面板收起，右下角按钮恢复。
5. 顶部“助手”按钮仍可打开同一个面板。
6. 面板标题显示“画布助手”，不再显示“未开发”。
7. 默认进入“对话”模式。
8. 输入文字后，请求从前端发到 `/api/v1/chat/completions`。
9. Next 代理实际转发到 `mange-backend /v1/chat/completions`。
10. 请求头使用 `Authorization: Bearer sk-...`。
11. `mange-backend` 能返回流式或完整文本回复。
12. 选中图片节点后提问，图片作为上下文发送。
13. 选中文本节点后提问，文本作为上下文发送。
14. AI 回复文本可插入画布为文本节点。
15. AI 生图结果可插入画布为图片节点。
16. 会话刷新后仍保存在当前画布项目中。
17. 不影响图片节点、视频节点、音频节点、配置节点的现有功能。

## 工作区注意事项

实施时需要遵循当前项目规则：

1. 先读现有代码，再修改。
2. 不回滚用户已有改动。
3. 不复制 TwitCanva 后端。
4. 不新增第二套聊天会话数据库。
5. 画布 UI 必须遵循当前画布主题。
6. 前端文案保持中文。
7. 如同步改动 AI 鉴权，需要同时关注 `image.ts`、`audio.ts`、`video.ts` 的 remote 模式一致性。
