# 多米 API 图片模型接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Infinite Canvas 接入多米 API 的异步 `gpt-image-2` 与 NANO-BANANA 图片模型，并限制 NANO-BANANA 图生图只能使用公网参考图。

**Architecture:** 每个模型渠道新增 `imageApiFormat`。标准渠道继续走当前 OpenAI/Gemini 逻辑；多米渠道从 `image.ts` 分发给独立 HTTP 服务。纯协议函数与 HTTP 轮询分离，纯函数使用现有 `node:test` 模式测试。

**Tech Stack:** React 19、TypeScript、Zustand、Axios、Vite、Node `node:test`。

---

## 文件结构

- `web/src/stores/use-config-store.ts`：渠道 `imageApiFormat` 字段、持久化迁移和请求配置传播。
- `web/src/services/api/duomi-image-provider-utils.mjs`：模型、路径、参数、响应和参考图校验纯逻辑。
- `web/src/services/api/duomi-image-provider-utils.d.ts`：纯逻辑 TypeScript 声明。
- `web/src/services/api/duomi-image.ts`：创建、轮询、取消和超时。
- `web/src/services/api/image.ts`：图片请求分派。
- `web/src/components/layout/app-config-modal.tsx`：渠道图片协议与模型建议。
- `web/server/duomi-image-provider-utils.test.mjs`：纯协议单元测试。
- `docs/content/docs/overview/features.mdx`、`docs/content/docs/canvas/canvas-node-manual.mdx`、`docs/content/docs/progress/pending-test.mdx`、`CHANGELOG.md`：使用说明与验证记录。

### Task 1: 多米纯协议工具

**Files:**
- Create: `web/src/services/api/duomi-image-provider-utils.mjs`
- Create: `web/src/services/api/duomi-image-provider-utils.d.ts`
- Create: `web/server/duomi-image-provider-utils.test.mjs`

- [ ] **Step 1: 编写失败测试，固定模型、路由、参数和响应契约**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
    DUOMI_IMAGE_MODELS,
    DUOMI_POLL_INTERVAL_MS,
    DUOMI_POLL_MAX_ATTEMPTS,
    duomiCreatePath,
    duomiImageRequestBody,
    duomiImageUrlsFromPayload,
    duomiReferenceUrls,
    duomiTaskIdFromPayload,
    duomiTaskPath,
    duomiTaskStatusFromPayload,
    isDuomiNanoBananaModel,
} from "../src/services/api/duomi-image-provider-utils.mjs";

test("uses documented Duomi image protocol shapes", () => {
    assert.equal(DUOMI_IMAGE_MODELS.includes("gemini-3.1-flash-lite-image"), false);
    assert.equal(isDuomiNanoBananaModel("gemini-2.5-flash-image"), true);
    assert.equal(duomiCreatePath("gpt-image-2", []), "/v1/images/generations");
    assert.equal(duomiCreatePath("gemini-3-pro-image-preview", ["https://assets.example.com/a.png"]), "/api/gemini/nano-banana-edit");
    assert.deepEqual(duomiImageRequestBody({ model: "gemini-3-pro-image-preview", prompt: "海边灯塔", size: "16:9", quality: "high", referenceUrls: [] }), { model: "gemini-3-pro-image-preview", prompt: "海边灯塔", aspect_ratio: "16:9", image_size: "4K" });
    assert.equal(duomiTaskIdFromPayload("gpt-image-2", { id: "openai-task" }), "openai-task");
    assert.equal(duomiTaskIdFromPayload("gemini-2.5-flash-image", { data: { task_id: "nano-task" } }), "nano-task");
    assert.equal(duomiTaskStatusFromPayload("gemini-2.5-flash-image", { data: { state: "succeeded" } }), "completed");
    assert.deepEqual(duomiImageUrlsFromPayload("gemini-2.5-flash-image", { data: { data: { images: [{ url: "https://cdn.example.com/image.png" }] } } }), ["https://cdn.example.com/image.png"]);
    assert.equal(duomiTaskPath("gemini-2.5-flash-image", "id/with space"), "/api/gemini/nano-banana/id%2Fwith%20space");
    assert.equal(DUOMI_POLL_INTERVAL_MS, 2000);
    assert.equal(DUOMI_POLL_MAX_ATTEMPTS, 150);
});

test("requires one through ten public HTTP reference URLs", () => {
    assert.deepEqual(duomiReferenceUrls(["https://assets.example.com/a.png"]), ["https://assets.example.com/a.png"]);
    assert.throws(() => duomiReferenceUrls(["data:image/png;base64,abc"]), /公网图片 URL/);
    assert.throws(() => duomiReferenceUrls(Array.from({ length: 11 }, (_, index) => `https://assets.example.com/${index}.png`)), /1 至 10/);
});
```

- [ ] **Step 2: 运行测试确认缺少模块**

Run: `node --test web/server/duomi-image-provider-utils.test.mjs`

Expected: FAIL，包含 `ERR_MODULE_NOT_FOUND` 且指向 `duomi-image-provider-utils.mjs`。

- [ ] **Step 3: 实现纯协议函数**

创建 `.mjs`，实现并导出下列完整接口：

```js
export const DUOMI_IMAGE_MODELS = ["gpt-image-2", "gemini-2.5-flash-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"];
export const DUOMI_POLL_INTERVAL_MS = 2000;
export const DUOMI_POLL_MAX_ATTEMPTS = 150;
export function isDuomiNanoBananaModel(model) { return DUOMI_IMAGE_MODELS.slice(1).includes(String(model || "").trim()); }
export function duomiCreatePath(model, referenceUrls) { return !isDuomiNanoBananaModel(model) ? "/v1/images/generations" : referenceUrls.length ? "/api/gemini/nano-banana-edit" : "/api/gemini/nano-banana"; }
export function duomiTaskPath(model, id) { return `${isDuomiNanoBananaModel(model) ? "/api/gemini/nano-banana" : "/v1/tasks"}/${encodeURIComponent(id)}`; }
```

`duomiImageRequestBody` 对 NANO-BANANA 输出 `model`、`prompt`、`aspect_ratio`、`image_size`，有参考图时输出 `image_urls`；单图且 `size === "auto"` 时省略 `aspect_ratio`。`low/medium/high/standard/hd` 映射为 `1K/2K/4K/2K/4K`。gpt-image-2 只发送 `model`、`prompt`、可选 `size` 和 `quality`，不发送 `n`、`response_format` 或 `output_format`。

`duomiTaskIdFromPayload` 读取 gpt 顶层 `id` 或 NANO 的 `data.task_id`；状态将 `succeeded/completed/success/done` 映射为 `completed`，`error/failed/cancelled/canceled/expired` 映射为 `failed`。图片 URL 分别读取 gpt 的 `data.images[]` 和 NANO 的 `data.data.images[]`。`duomiReferenceUrls` 必须要求 1 至 10 个 `http:` 或 `https:` URL，其他情况抛出包含“公网图片 URL”的中文错误。

创建 `.d.ts`，为所有导出的常量和函数声明 `string`、`string[]`、`"pending" | "completed" | "failed"` 类型，避免在 TypeScript 调用侧出现隐式 `any`。

- [ ] **Step 4: 运行纯工具测试**

Run: `node --test web/server/duomi-image-provider-utils.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交纯协议工具**

```powershell
git add web/src/services/api/duomi-image-provider-utils.mjs web/src/services/api/duomi-image-provider-utils.d.ts web/server/duomi-image-provider-utils.test.mjs
git commit -m "feat: add duomi image protocol utilities"
```

### Task 2: 渠道图片协议配置

**Files:**
- Modify: `web/src/stores/use-config-store.ts:6-17, 207-243, 260-270, 321-330`
- Modify: `web/src/components/layout/app-config-modal.tsx:36-39, 115-118, 281-309`
- Modify: `web/src/services/api/duomi-image-provider-utils.mjs`
- Test: `web/server/duomi-image-provider-utils.test.mjs`

- [ ] **Step 1: 写入模型建议失败测试**

在测试文件添加：

```js
import { DUOMI_IMAGE_MODEL_SUGGESTIONS } from "../src/services/api/duomi-image-provider-utils.mjs";

test("publishes only documented Duomi image model suggestions", () => {
    assert.deepEqual(DUOMI_IMAGE_MODEL_SUGGESTIONS, ["gpt-image-2", "gemini-2.5-flash-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"]);
});
```

- [ ] **Step 2: 确认测试失败**

Run: `node --test web/server/duomi-image-provider-utils.test.mjs`

Expected: FAIL，`DUOMI_IMAGE_MODEL_SUGGESTIONS` 未导出。

- [ ] **Step 3: 实现配置迁移和界面**

在 `.mjs` 导出 `DUOMI_IMAGE_MODEL_SUGGESTIONS = [...DUOMI_IMAGE_MODELS]`。在 store 新增：

```ts
export type ImageApiFormat = "standard" | "duomi";
// ModelChannel 内新增 imageApiFormat: ImageApiFormat
```

`createModelChannel` 使用 `channel?.imageApiFormat === "duomi" ? "duomi" : "standard"`。`resolveModelRequestConfig` 返回 `imageApiFormat: channel.imageApiFormat`。不要在顶层 `AiConfig` 增加此字段；旧持久化渠道将由 `createModelChannel` 自动回退为 `standard`。

在配置界面加入“图片协议” Select：`标准 OpenAI / Gemini` 值为 `standard`，`多米 API 异步图片` 值为 `duomi`。选择 `duomi` 时合并四个建议模型到当前渠道，保留已有模型。模型列表下显示：“多米图片模型需要手动添加；该渠道的 /v1/models 当前不提供模型列表。NANO-BANANA 图生图仅接受公网图片 URL。” 不禁用既有拉取模型按钮。

- [ ] **Step 4: 验证类型与测试**

Run:

```powershell
npm.cmd run typecheck
node --test web/server/duomi-image-provider-utils.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 提交渠道配置**

```powershell
git add web/src/stores/use-config-store.ts web/src/components/layout/app-config-modal.tsx web/src/services/api/duomi-image-provider-utils.mjs web/src/services/api/duomi-image-provider-utils.d.ts web/server/duomi-image-provider-utils.test.mjs
git commit -m "feat: configure duomi image channels"
```

### Task 3: 多米异步请求服务

**Files:**
- Create: `web/src/services/api/duomi-image.ts`
- Modify: `web/src/services/api/duomi-image-provider-utils.mjs`
- Modify: `web/src/services/api/duomi-image-provider-utils.d.ts`

- [ ] **Step 1: 在工具测试中加入错误消息读取测试**

```js
import { duomiTaskErrorMessage } from "../src/services/api/duomi-image-provider-utils.mjs";

test("prefers provider task error messages", () => {
    assert.equal(duomiTaskErrorMessage("gemini-2.5-flash-image", { data: { msg: "内容被拒绝" } }), "内容被拒绝");
    assert.equal(duomiTaskErrorMessage("gpt-image-2", { error: { message: "余额不足" } }), "余额不足");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test web/server/duomi-image-provider-utils.test.mjs`

Expected: FAIL，`duomiTaskErrorMessage` 未导出。

- [ ] **Step 3: 实现错误消息与 HTTP 服务**

`duomiTaskErrorMessage` 必须依次检查 NANO `payload.data.msg`、顶层 `payload.msg`、`payload.error.message`，并返回字符串或空字符串。

创建 `duomi-image.ts`，导出：

```ts
export async function requestDuomiImages(
    config: Pick<AiConfig, "baseUrl" | "apiKey" | "useProxy">,
    request: { model: string; prompt: string; size: string; quality: string; referenceUrls: string[] },
    options?: { signal?: AbortSignal },
): Promise<Array<{ id: string; dataUrl: string }>>;
```

创建请求使用 `duomiCreatePath` 和 `duomiImageRequestBody`。请求头固定为 `Authorization: config.apiKey`，而非 `Bearer`。轮询以 `duomiTaskPath` 读取状态，每两秒一次、最多 150 次。成功时将所有 URL 映射为 `{ id: nanoid(), dataUrl: url }`；成功但空结果抛出“已完成但没有返回图片 URL”；失败时抛出协议错误消息或“多米图片生成失败”；超时抛出“多米图片生成超时，请稍后重试”。

`delay(ms, signal)` 要在 abort 后清理 timer 并抛出 `DOMException("Aborted", "AbortError")`。`useProxy` 时通过现有 `buildApiUrl` 和 `buildAiProxyHeaders` 访问 `/api/ai-proxy`，否则使用 Base URL 直连。

- [ ] **Step 4: 验证服务可编译**

Run:

```powershell
npm.cmd run typecheck
node --test web/server/duomi-image-provider-utils.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 提交异步服务**

```powershell
git add web/src/services/api/duomi-image.ts web/src/services/api/duomi-image-provider-utils.mjs web/src/services/api/duomi-image-provider-utils.d.ts web/server/duomi-image-provider-utils.test.mjs
git commit -m "feat: add duomi async image requests"
```

### Task 4: 接入图片生成入口

**Files:**
- Modify: `web/src/services/api/image.ts:1-8, 652-724`
- Modify: `web/src/services/api/duomi-image-provider-utils.mjs`
- Test: `web/server/duomi-image-provider-utils.test.mjs`

- [ ] **Step 1: 写入多米模型白名单失败测试**

```js
import { isDuomiImageModel } from "../src/services/api/duomi-image-provider-utils.mjs";

test("does not send unrelated channel models to the Duomi image adapter", () => {
    assert.equal(isDuomiImageModel("gpt-image-2"), true);
    assert.equal(isDuomiImageModel("gemini-2.5-flash-image"), true);
    assert.equal(isDuomiImageModel("gpt-5.5"), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test web/server/duomi-image-provider-utils.test.mjs`

Expected: FAIL，`isDuomiImageModel` 未导出。

- [ ] **Step 3: 在 image.ts 中分派多米请求**

实现 `isDuomiImageModel(model) { return DUOMI_IMAGE_MODELS.includes(String(model || "").trim()); }`，并在 `image.ts` 导入 `requestDuomiImages`、`duomiReferenceUrls`、`isDuomiImageModel`、`isDuomiNanoBananaModel`。

在 `requestGeneration` 中，在 Gemini 分支前处理 `requestConfig.imageApiFormat === "duomi"`：白名单外模型抛出“不是已确认的多米图片模型”；否则以 `referenceUrls: []` 调用 `requestDuomiImages`。

在 `requestEdit` 中，在 Gemini 分支前处理多米：若模型不是 NANO-BANANA，抛出“多米 gpt-image-2 第一阶段仅支持文生图”；否则用 `references.map((image) => image.url || image.dataUrl)` 调用 `duomiReferenceUrls`，通过后传给 `requestDuomiImages`。多米分支禁止调用 `imageToDataUrl`、`FormData` 和 `dataUrlToFile`，确保本地图片请求在联网前被拒绝。

- [ ] **Step 4: 验证接口入口未破坏标准调用**

Run:

```powershell
npm.cmd run typecheck
node --test web/server/duomi-image-provider-utils.test.mjs
```

Expected: PASS，`requestGeneration` 与 `requestEdit` 仍返回 `{ id, dataUrl }[]`。

- [ ] **Step 5: 提交入口集成**

```powershell
git add web/src/services/api/image.ts web/src/services/api/duomi-image-provider-utils.mjs web/src/services/api/duomi-image-provider-utils.d.ts web/server/duomi-image-provider-utils.test.mjs
git commit -m "feat: route image generation through duomi adapter"
```

### Task 5: 用户文档、验证与交付

**Files:**
- Modify: `docs/content/docs/overview/features.mdx:60-84`
- Modify: `docs/content/docs/canvas/canvas-node-manual.mdx:27-44`
- Modify: `docs/content/docs/progress/pending-test.mdx`
- Modify: `CHANGELOG.md:3-35`

- [ ] **Step 1: 写入使用文档**

在功能说明中加入：多米渠道手动配置 `gpt-image-2`、`gemini-2.5-flash-image`、`gemini-3-pro-image-preview`、`gemini-3.1-flash-image-preview`；其 `/v1/models` 不可用；NANO-BANANA 图生图只接受 1 至 10 张公网 HTTP/HTTPS URL，浏览器本地图片不会自动上传。

在画布手册中加入：选择“多米 API 异步图片”后，创建后会显示生成中并自动轮询，取消会停止轮询；本地、剪贴板和仅浏览器保存的参考图会在请求前提示公网 URL 限制。

- [ ] **Step 2: 写入真实 Key 待测项与日志**

`pending-test.mdx` 添加：四个模型文生图、三个 NANO-BANANA 模型的公网参考图编辑、401/403、429、任务失败、超时、取消、`/v1/models` 404 后手动配置。

`CHANGELOG.md` 的 `Unreleased` 添加：

```md
+ [新增] 生图渠道支持多米 API 异步图片协议，可接入 gpt-image-2 与 NANO-BANANA 文生图，并支持公网参考图编辑。
```

- [ ] **Step 3: 运行完整验证**

Run:

```powershell
npm.cmd run format:check
node --test web/server/duomi-image-provider-utils.test.mjs
npm.cmd run test:proxy
npm.cmd run typecheck
npm.cmd run build
```

Expected: 全部 PASS。若格式检查失败，仅格式化本次修改文件后重试，不格式化无关文件。

- [ ] **Step 4: 浏览器验收**

1. 新增渠道，选择“多米 API 异步图片”，确认四个建议模型进入模型列表。
2. 在模型页将其中一个模型设为默认生图模型。
3. 使用本地参考图调用 NANO-BANANA，确认请求前出现“公网图片 URL”错误且没有网络请求。
4. 配置真实 Key 和公网参考图后，验证创建、轮询、结果回填与取消停止轮询。

- [ ] **Step 5: 提交文档**

```powershell
git add docs/content/docs/overview/features.mdx docs/content/docs/canvas/canvas-node-manual.mdx docs/content/docs/progress/pending-test.mdx CHANGELOG.md
git commit -m "docs: document duomi image channels"
```

## 实施约束

- 不新增图片上传服务、回调地址、服务器持久化或通用 Provider 框架。
- 不向未经用户配置的第三方发送本地图片或 API Key。
- 不改变现有 OpenAI、Gemini、视频与音频调用路径。
