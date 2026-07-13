# 多米 Grok 视频模型接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Infinite Canvas 增加多米 `grok-video-1.5` 文生视频和公网参考图生视频，并通过多米渠道模板一次配置图片、视频协议及建议模型。

**Architecture:** 每个模型渠道新增独立的 `videoApiFormat`。标准渠道继续走当前 OpenAI、xAI 和 Seedance 流程；多米渠道从 `video.ts` 分发给独立的视频创建与查询客户端。公共的原始鉴权、代理目标和公网 URL 安全校验抽到共享多米工具，视频协议解析和任务 HTTP 生命周期保持分离。

**Tech Stack:** React 19、TypeScript、Zustand、Ant Design、Axios、Node.js `node:test`、Vite、Prettier。

---

## 文件结构

新增：

- `web/src/services/api/duomi-provider-utils.mjs`：多米图片和视频共用的 Base URL、原始鉴权、代理目标、请求超时和公网 URL 校验。
- `web/src/services/api/duomi-provider-utils.d.ts`：共享工具的 TypeScript 声明。
- `web/server/duomi-provider-utils.test.mjs`：共享传输和公网 URL 校验测试。
- `web/src/services/api/duomi-video-provider-utils.mjs`：多米视频模型、路径、请求体、任务状态、错误和视频 URL 的纯协议逻辑。
- `web/src/services/api/duomi-video-provider-utils.d.ts`：视频纯协议工具的 TypeScript 声明。
- `web/server/duomi-video-provider-utils.test.mjs`：视频协议单元测试。
- `web/src/services/api/duomi-video-lifecycle.mjs`：可注入请求函数的任务创建与单次查询生命周期。
- `web/src/services/api/duomi-video-lifecycle.d.mts`：生命周期 TypeScript 声明。
- `web/server/duomi-video-lifecycle.test.mjs`：创建、查询、失败、取消和异常响应测试。
- `web/src/services/api/duomi-video.ts`：Axios、代理、鉴权和错误翻译适配。

修改：

- `web/src/services/api/duomi-image-provider-utils.mjs`：复用共享多米工具并保留现有导出契约。
- `web/src/services/api/duomi-image-provider-utils.d.ts`：重新导出共享传输声明。
- `web/server/duomi-image-provider-utils.test.mjs`：确认图片 1 至 10 张限制与共享校验重构后不变。
- `web/src/stores/use-config-store.ts`：新增、迁移并解析 `videoApiFormat`。
- `web/src/components/layout/app-config-modal.tsx`：新增视频协议、渠道模板菜单和模型建议合并。
- `web/src/services/api/video.ts`：将多米渠道分发到多米视频客户端。
- `web/src/components/video-settings-panel.tsx`：多米视频明确显示固定 `720p`。
- `web/src/pages/video/index.tsx`：视频创作台轮询使用多米间隔和多米超时提示。
- `docs/content/docs/overview/features.mdx`：记录多米渠道模板和视频能力。
- `docs/content/docs/canvas/canvas-node-manual.mdx`：记录画布视频用法和公网参考图限制。
- `docs/content/docs/progress/pending-test.mdx`：区分自动测试和真实计费联调。
- `CHANGELOG.md`：增加 `Unreleased` 记录。

### Task 1: 提取共享多米传输与公网 URL 校验

**Files:**

- Create: `web/src/services/api/duomi-provider-utils.mjs`
- Create: `web/src/services/api/duomi-provider-utils.d.ts`
- Create: `web/server/duomi-provider-utils.test.mjs`
- Modify: `web/src/services/api/duomi-image-provider-utils.mjs`
- Modify: `web/src/services/api/duomi-image-provider-utils.d.ts`
- Test: `web/server/duomi-image-provider-utils.test.mjs`

- [ ] **Step 1: 写共享工具失败测试**

创建 `web/server/duomi-provider-utils.test.mjs`，覆盖原始鉴权、代理目标和可空公网 URL 数组：

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  duomiPublicReferenceUrls,
  duomiRequestHeaders,
  duomiRequestUrl,
  isDuomiRequestTimeout,
} from "../src/services/api/duomi-provider-utils.mjs";

test("builds direct and proxy requests with raw authorization", () => {
  assert.equal(
    duomiRequestUrl(
      "https://duomiapi.com/v1/",
      "/v1/videos/generations",
      false,
      "",
    ),
    "https://duomiapi.com/v1/videos/generations",
  );
  assert.equal(
    duomiRequestUrl(
      "https://duomiapi.com/v1/",
      "/v1/videos/generations",
      true,
      "/api/ai-proxy/v1/videos/generations",
    ),
    "/api/ai-proxy/v1/videos/generations",
  );
  assert.deepEqual(
    duomiRequestHeaders("https://duomiapi.com/v1", "secret", true, {
      "x-existing": "kept",
    }),
    {
      "x-existing": "kept",
      Authorization: "secret",
      "Content-Type": "application/json",
      "x-ai-proxy-target-base-url": "https://duomiapi.com",
    },
  );
});

test("accepts an empty video reference list and preserves public URL order", () => {
  assert.deepEqual(
    duomiPublicReferenceUrls([], {
      min: 0,
      errorMessage: "多米 Grok 参考图仅支持公网图片 URL",
    }),
    [],
  );
  assert.deepEqual(
    duomiPublicReferenceUrls(
      ["https://assets.example.com/a.png", "http://cdn.example.org/b.jpg"],
      { min: 0 },
    ),
    ["https://assets.example.com/a.png", "http://cdn.example.org/b.jpg"],
  );
});

test("rejects local, private, blob and base64 references", () => {
  for (const url of [
    "data:image/png;base64,abc",
    "blob:http://localhost/id",
    "http://localhost/a.png",
    "http://127.0.0.1/a.png",
    "http://192.168.1.2/a.png",
    "http://[::1]/a.png",
  ]) {
    assert.throws(
      () =>
        duomiPublicReferenceUrls([url], {
          min: 0,
          errorMessage: "多米 Grok 参考图仅支持公网图片 URL",
        }),
      /公网图片 URL/,
    );
  }
});

test("recognizes request timeout errors", () => {
  assert.equal(isDuomiRequestTimeout({ code: "ECONNABORTED" }), true);
  assert.equal(isDuomiRequestTimeout({ code: "ETIMEDOUT" }), true);
  assert.equal(isDuomiRequestTimeout(new Error("network")), false);
});
```

- [ ] **Step 2: 运行测试并确认缺少模块**

Run from repository root:

```powershell
node --test web/server/duomi-provider-utils.test.mjs
```

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 并指向 `duomi-provider-utils.mjs`。

- [ ] **Step 3: 实现共享工具并保持图片契约**

在 `duomi-provider-utils.mjs` 导出：

```js
export function duomiRequestUrl(baseUrl, path, useProxy, proxyUrl) {
  return useProxy ? proxyUrl : `${normalizedBaseUrl(baseUrl)}${path}`;
}

export function duomiRequestHeaders(
  baseUrl,
  apiKey,
  useProxy,
  proxyHeaders = {},
  proxyTargetHeader = "x-ai-proxy-target-base-url",
) {
  return {
    ...proxyHeaders,
    Authorization: apiKey,
    "Content-Type": "application/json",
    ...(useProxy ? { [proxyTargetHeader]: normalizedBaseUrl(baseUrl) } : {}),
  };
}

export function isDuomiRequestTimeout(error) {
  return (
    isRecord(error) &&
    (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")
  );
}

export function duomiPublicReferenceUrls(
  urls,
  {
    min = 0,
    max = Number.POSITIVE_INFINITY,
    errorMessage = "参考图必须是公网图片 URL",
  } = {},
) {
  if (
    !Array.isArray(urls) ||
    urls.length < min ||
    urls.length > max ||
    !urls.every(isPublicHttpUrl)
  )
    throw new Error(errorMessage);
  return [...urls];
}
```

把当前 `duomi-image-provider-utils.mjs` 中的 `normalizedBaseUrl`、请求头、请求 URL、超时识别及完整 IPv4/IPv6 公网判断移动到共享文件。图片文件从共享文件导入这些函数，并保留原导出：

```js
export {
  duomiRequestHeaders,
  duomiRequestUrl,
  isDuomiRequestTimeout,
} from "./duomi-provider-utils.mjs";

export function duomiReferenceUrls(urls) {
  return duomiPublicReferenceUrls(urls, {
    min: 1,
    max: 10,
    errorMessage: "参考图必须是 1 至 10 个公网图片 URL",
  });
}
```

在 `duomi-provider-utils.d.ts` 声明四个共享导出；在图片声明文件中重新导出三个原有传输函数，确保现有 TypeScript 导入不变。

- [ ] **Step 4: 运行共享和图片回归测试**

```powershell
node --test web/server/duomi-provider-utils.test.mjs web/server/duomi-image-provider-utils.test.mjs
```

Expected: PASS，现有图片 `1 至 10` 张限制、私网拒绝和代理鉴权测试继续通过。

- [ ] **Step 5: 提交共享工具**

```powershell
git add web/src/services/api/duomi-provider-utils.mjs web/src/services/api/duomi-provider-utils.d.ts web/src/services/api/duomi-image-provider-utils.mjs web/src/services/api/duomi-image-provider-utils.d.ts web/server/duomi-provider-utils.test.mjs web/server/duomi-image-provider-utils.test.mjs
git commit -m "refactor: share duomi request validation"
```

### Task 2: 实现多米视频纯协议工具

**Files:**

- Create: `web/src/services/api/duomi-video-provider-utils.mjs`
- Create: `web/src/services/api/duomi-video-provider-utils.d.ts`
- Create: `web/server/duomi-video-provider-utils.test.mjs`

- [ ] **Step 1: 写协议失败测试**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  DUOMI_VIDEO_MODEL_SUGGESTIONS,
  DUOMI_VIDEO_POLL_INTERVAL_MS,
  DUOMI_VIDEO_POLL_MAX_ATTEMPTS,
  duomiVideoCreatePath,
  duomiVideoRequestBody,
  duomiVideoTaskErrorMessage,
  duomiVideoTaskIdFromPayload,
  duomiVideoTaskPath,
  duomiVideoTaskStatusFromPayload,
  duomiVideoUrlsFromPayload,
  isDuomiVideoModel,
  mergeFetchedVideoModels,
  normalizeVideoApiFormat,
} from "../src/services/api/duomi-video-provider-utils.mjs";

test("publishes only the documented Duomi Grok video model", () => {
  assert.deepEqual(DUOMI_VIDEO_MODEL_SUGGESTIONS, ["grok-video-1.5"]);
  assert.equal(isDuomiVideoModel("grok-video-1.5"), true);
  assert.equal(isDuomiVideoModel("grok-imagine-video"), false);
  assert.equal(normalizeVideoApiFormat("duomi"), "duomi");
  assert.equal(normalizeVideoApiFormat(undefined), "standard");
});

test("builds the documented request and task paths", () => {
  assert.equal(duomiVideoCreatePath(), "/v1/videos/generations");
  assert.equal(
    duomiVideoTaskPath("id/with space"),
    "/v1/videos/tasks/id%2Fwith%20space",
  );
  assert.deepEqual(
    duomiVideoRequestBody({
      model: "grok-video-1.5",
      prompt: "海边灯塔",
      size: "1280x720",
      seconds: "6",
      referenceUrls: [],
    }),
    {
      model: "grok-video-1.5",
      prompt: "海边灯塔",
      aspect_ratio: "16:9",
      duration: 6,
      quality: "720p",
      image_urls: [],
      oversea: false,
    },
  );
});

test("keeps every public reference URL without inventing a count limit", () => {
  const referenceUrls = Array.from(
    { length: 12 },
    (_, index) => `https://assets.example.com/${index}.png`,
  );
  assert.deepEqual(
    duomiVideoRequestBody({
      model: "grok-video-1.5",
      prompt: "动起来",
      size: "720x1280",
      seconds: "20",
      referenceUrls,
    }).image_urls,
    referenceUrls,
  );
});

test("reads Duomi task ids, statuses, errors and video URLs", () => {
  assert.equal(duomiVideoTaskIdFromPayload({ id: " task-1 " }), "task-1");
  assert.equal(
    duomiVideoTaskStatusFromPayload({ state: "succeeded" }),
    "completed",
  );
  assert.equal(
    duomiVideoTaskStatusFromPayload({ state: "failed", msg: "内容被拒绝" }),
    "failed",
  );
  assert.equal(
    duomiVideoTaskStatusFromPayload({ state: "provider-new-running-state" }),
    "pending",
  );
  assert.equal(
    duomiVideoTaskErrorMessage({ error: { message: "余额不足" } }),
    "余额不足",
  );
  assert.deepEqual(
    duomiVideoUrlsFromPayload({
      data: {
        videos: [
          { url: " https://cdn.example.com/a.mp4 " },
          {},
          { url: "https://cdn.example.com/b.mp4" },
        ],
      },
    }),
    ["https://cdn.example.com/a.mp4", "https://cdn.example.com/b.mp4"],
  );
});

test("merges video suggestions without deleting current channel models", () => {
  assert.deepEqual(
    mergeFetchedVideoModels("duomi", ["gpt-image-2"], ["remote-model"]),
    ["gpt-image-2", "remote-model", "grok-video-1.5"],
  );
  assert.deepEqual(
    mergeFetchedVideoModels("standard", ["old-model"], ["remote-model"]),
    ["remote-model"],
  );
  assert.equal(DUOMI_VIDEO_POLL_INTERVAL_MS, 2500);
  assert.equal(DUOMI_VIDEO_POLL_MAX_ATTEMPTS, 120);
});
```

- [ ] **Step 2: 运行测试并确认缺少视频工具**

```powershell
node --test web/server/duomi-video-provider-utils.test.mjs
```

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现最小视频协议工具**

在 `.mjs` 中实现以下公开契约：

```js
import { duomiPublicReferenceUrls } from "./duomi-provider-utils.mjs";
import { xaiVideoAspectRatioFromSize } from "./video-provider-utils.mjs";

export const DUOMI_VIDEO_MODELS = ["grok-video-1.5"];
export const DUOMI_VIDEO_MODEL_SUGGESTIONS = [...DUOMI_VIDEO_MODELS];
export const DUOMI_VIDEO_POLL_INTERVAL_MS = 2500;
export const DUOMI_VIDEO_POLL_MAX_ATTEMPTS = 120;

export function normalizeVideoApiFormat(value) {
  return value === "duomi" ? "duomi" : "standard";
}

export function mergeFetchedVideoModels(
  videoApiFormat,
  currentModels,
  fetchedModels,
) {
  if (videoApiFormat !== "duomi") return uniqueModels(fetchedModels);
  return uniqueModels([
    ...currentModels,
    ...fetchedModels,
    ...DUOMI_VIDEO_MODEL_SUGGESTIONS,
  ]);
}

export function duomiVideoCreatePath() {
  return "/v1/videos/generations";
}

export function duomiVideoTaskPath(id) {
  return `/v1/videos/tasks/${encodeURIComponent(String(id || ""))}`;
}

export function duomiVideoRequestBody({
  model,
  prompt,
  size,
  seconds,
  referenceUrls,
}) {
  if (!isDuomiVideoModel(model))
    throw new Error(`${model} 不是已确认的多米视频模型`);
  return {
    model,
    prompt,
    aspect_ratio: xaiVideoAspectRatioFromSize(size),
    duration: normalizeDuration(seconds),
    quality: "720p",
    image_urls: duomiPublicReferenceUrls(referenceUrls, {
      min: 0,
      errorMessage: "多米 Grok 参考图仅支持公网图片 URL",
    }),
    oversea: false,
  };
}
```

状态规则必须满足：`succeeded/completed/success/done` 为完成，`failed/error/cancelled/canceled/expired` 或明确错误字段为失败，其他无错误状态为处理中。任务 ID 只读取顶层 `id`。视频 URL 只读取 `data.videos[].url`，不接受其他响应形状冒充成功。

在 `.d.ts` 完整声明常量、`VideoApiFormat`、请求体、三态状态及所有导出函数。

- [ ] **Step 4: 运行视频协议测试**

```powershell
node --test web/server/duomi-video-provider-utils.test.mjs
```

Expected: PASS，12 张公网参考图保持原顺序，本地与私网 URL 由共享工具拒绝。

- [ ] **Step 5: 提交视频协议工具**

```powershell
git add web/src/services/api/duomi-video-provider-utils.mjs web/src/services/api/duomi-video-provider-utils.d.ts web/server/duomi-video-provider-utils.test.mjs
git commit -m "feat: add duomi video protocol utilities"
```

### Task 3: 增加视频协议配置和多米渠道模板

**Files:**

- Modify: `web/src/stores/use-config-store.ts`
- Modify: `web/src/components/layout/app-config-modal.tsx`
- Modify: `web/server/duomi-video-provider-utils.test.mjs`

- [ ] **Step 1: 扩展配置纯函数测试**

在 `duomi-video-provider-utils.test.mjs` 增加：

```js
test("normalizes persisted video protocols and deduplicates fetched models", () => {
  assert.equal(normalizeVideoApiFormat("unexpected"), "standard");
  assert.deepEqual(
    mergeFetchedVideoModels(
      "duomi",
      ["grok-video-1.5", "custom"],
      ["custom", "remote"],
    ),
    ["grok-video-1.5", "custom", "remote"],
  );
});
```

- [ ] **Step 2: 运行测试确认现有纯函数通过，再让 TypeScript 暴露缺口**

```powershell
node --test web/server/duomi-video-provider-utils.test.mjs
Set-Location web
npm.cmd run typecheck
```

Expected: 协议测试 PASS；在开始修改配置 UI 后，TypeScript 必须持续运行，用于捕获 `ModelChannel` 缺少 `videoApiFormat` 或 Ant Design 菜单类型错误。

- [ ] **Step 3: 在配置存储中新增和迁移视频协议**

在 store 中增加：

```ts
export type VideoApiFormat = "standard" | "duomi";

export type ModelChannel = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiCallFormat;
  imageApiFormat: ImageApiFormat;
  videoApiFormat: VideoApiFormat;
  useProxy: boolean;
  models: string[];
};
```

`createModelChannel` 使用 `normalizeVideoApiFormat(channel?.videoApiFormat)`。`defaultConfig.channels[0]` 显式填写 `videoApiFormat: "standard"`。`resolveModelRequestConfig` 返回 `videoApiFormat: channel.videoApiFormat`。旧持久化渠道经过 `normalizeChannels -> createModelChannel` 自动得到 `standard`，不要在顶层 `AiConfig` 新增持久化字段。

- [ ] **Step 4: 增加视频协议选择和渠道模板菜单**

在配置弹窗：

```ts
const videoApiFormatOptions: Array<{ label: string; value: VideoApiFormat }> = [
  { label: "标准 OpenAI / xAI / Seedance", value: "standard" },
  { label: "多米 API 异步视频", value: "duomi" },
];

const channelTemplateItems = [
  { key: "blank", label: "空白渠道" },
  { key: "duomi", label: "多米 API" },
];
```

新增处理函数：

```ts
const updateChannelVideoApiFormat = (
  channel: ModelChannel,
  videoApiFormat: VideoApiFormat,
) => {
  const models =
    videoApiFormat === "duomi"
      ? uniqueModels([...channel.models, ...DUOMI_VIDEO_MODEL_SUGGESTIONS])
      : channel.models;
  updateChannel(channel.id, { videoApiFormat, models });
};

const addChannelFromTemplate = (template: string) => {
  const channel =
    template === "duomi"
      ? createModelChannel({
          name: "多米 API",
          baseUrl: "https://duomiapi.com",
          apiFormat: "openai",
          imageApiFormat: "duomi",
          videoApiFormat: "duomi",
          models: uniqueModels([
            ...DUOMI_IMAGE_MODEL_SUGGESTIONS,
            ...DUOMI_VIDEO_MODEL_SUGGESTIONS,
          ]),
        })
      : createModelChannel({ name: `渠道 ${config.channels.length + 1}` });
  updateChannels([...config.channels, channel]);
};
```

使用 Ant Design `Dropdown` 包裹现有带 `Plus` 图标的“新增渠道”按钮。菜单选择调用 `addChannelFromTemplate(info.key)`。在“图片协议”旁增加“视频协议” Select。模型说明在任一多米协议启用时显示，并分别说明图片和视频的公网参考图限制。

模型拉取时先调用 `mergeFetchedImageModels`，再调用：

```ts
mergeFetchedVideoModels(
  channel.videoApiFormat,
  imageMergedModels,
  imageMergedModels,
);
```

这样标准视频不会删除图片协议加入的模型，多米视频会在结果上补充 `grok-video-1.5`。

- [ ] **Step 5: 运行配置相关验证**

```powershell
Set-Location web
node --test server/duomi-image-provider-utils.test.mjs server/duomi-video-provider-utils.test.mjs
npm.cmd run typecheck
```

Expected: 全部 PASS；旧渠道类型路径通过 `standard` 默认值编译。

- [ ] **Step 6: 提交渠道配置**

```powershell
git add web/src/stores/use-config-store.ts web/src/components/layout/app-config-modal.tsx web/src/services/api/duomi-video-provider-utils.mjs web/src/services/api/duomi-video-provider-utils.d.ts web/server/duomi-video-provider-utils.test.mjs
git commit -m "feat: configure duomi video channels"
```

### Task 4: 实现多米视频任务创建和查询客户端

**Files:**

- Create: `web/src/services/api/duomi-video-lifecycle.mjs`
- Create: `web/src/services/api/duomi-video-lifecycle.d.mts`
- Create: `web/server/duomi-video-lifecycle.test.mjs`
- Create: `web/src/services/api/duomi-video.ts`

- [ ] **Step 1: 写生命周期失败测试**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  createDuomiVideoLifecycleTask,
  pollDuomiVideoLifecycleTask,
} from "../src/services/api/duomi-video-lifecycle.mjs";

const request = {
  model: "grok-video-1.5",
  prompt: "云层穿梭",
  size: "1280x720",
  seconds: "6",
  referenceUrls: [],
};

test("creates a Duomi task with the documented body", async () => {
  const task = await createDuomiVideoLifecycleTask({
    model: request.model,
    signal: new AbortController().signal,
    create: async ({ path, body }) => {
      assert.equal(path, "/v1/videos/generations");
      assert.deepEqual(body.image_urls, []);
      return { id: "task-1" };
    },
    request,
  });
  assert.deepEqual(task, {
    id: "task-1",
    provider: "duomi",
    model: "grok-video-1.5",
  });
});

test("rejects create responses without a task id", async () => {
  await assert.rejects(
    () =>
      createDuomiVideoLifecycleTask({
        model: request.model,
        request,
        create: async () => ({}),
      }),
    /缺少任务 ID/,
  );
});

test("maps polling success, failure and unknown states", async () => {
  const completed = await pollDuomiVideoLifecycleTask({
    task: { id: "task-1", provider: "duomi", model: request.model },
    poll: async () => ({
      state: "succeeded",
      data: { videos: [{ url: "https://cdn.example.com/result.mp4" }] },
    }),
  });
  assert.deepEqual(completed, {
    status: "completed",
    result: {
      url: "https://cdn.example.com/result.mp4",
      mimeType: "video/mp4",
    },
  });
  const failed = await pollDuomiVideoLifecycleTask({
    task: { id: "task-1", provider: "duomi", model: request.model },
    poll: async () => ({ state: "failed", msg: "内容被拒绝" }),
  });
  assert.deepEqual(failed, { status: "failed", error: "内容被拒绝" });
  const pending = await pollDuomiVideoLifecycleTask({
    task: { id: "task-1", provider: "duomi", model: request.model },
    poll: async () => ({ state: "provider-running-v2" }),
  });
  assert.deepEqual(pending, { status: "pending" });
});

test("rejects completed responses without a video URL and keeps the task id", async () => {
  await assert.rejects(
    () =>
      pollDuomiVideoLifecycleTask({
        task: { id: "task-1", provider: "duomi", model: request.model },
        poll: async () => ({ state: "succeeded", data: { videos: [] } }),
      }),
    /task-1.*没有返回视频 URL/,
  );
});

test("does not call create or poll after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    () =>
      createDuomiVideoLifecycleTask({
        model: request.model,
        request,
        signal: controller.signal,
        create: async () => {
          calls += 1;
          return { id: "task-1" };
        },
      }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  await assert.rejects(
    () =>
      pollDuomiVideoLifecycleTask({
        task: { id: "task-1", provider: "duomi", model: request.model },
        signal: controller.signal,
        poll: async () => {
          calls += 1;
          return {};
        },
      }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(calls, 0);
});

test("rejects local references before calling create", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      createDuomiVideoLifecycleTask({
        model: request.model,
        request: { ...request, referenceUrls: ["data:image/png;base64,abc"] },
        create: async () => {
          calls += 1;
          return { id: "task-1" };
        },
      }),
    /公网图片 URL/,
  );
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: 运行生命周期测试并确认缺少模块**

```powershell
node --test web/server/duomi-video-lifecycle.test.mjs
```

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现可注入的生命周期**

```js
import {
  duomiVideoCreatePath,
  duomiVideoRequestBody,
  duomiVideoTaskErrorMessage,
  duomiVideoTaskIdFromPayload,
  duomiVideoTaskPath,
  duomiVideoTaskStatusFromPayload,
  duomiVideoUrlsFromPayload,
} from "./duomi-video-provider-utils.mjs";

export async function createDuomiVideoLifecycleTask({
  model,
  request,
  create,
  signal,
}) {
  throwIfAborted(signal);
  const payload = await create({
    path: duomiVideoCreatePath(),
    body: duomiVideoRequestBody(request),
    signal,
  });
  throwIfAborted(signal);
  const id = duomiVideoTaskIdFromPayload(payload);
  if (!id) throw new Error("多米视频协议错误：任务创建响应缺少任务 ID");
  return { id, provider: "duomi", model };
}

export async function pollDuomiVideoLifecycleTask({ task, poll, signal }) {
  throwIfAborted(signal);
  const payload = await poll({ path: duomiVideoTaskPath(task.id), signal });
  throwIfAborted(signal);
  const status = duomiVideoTaskStatusFromPayload(payload);
  if (status === "completed") {
    const [url] = duomiVideoUrlsFromPayload(payload);
    if (!url)
      throw new Error(`多米视频任务 ${task.id} 已完成但没有返回视频 URL`);
    return { status: "completed", result: { url, mimeType: "video/mp4" } };
  }
  if (status === "failed")
    return {
      status: "failed",
      error: duomiVideoTaskErrorMessage(payload) || "多米视频生成失败",
    };
  return { status: "pending" };
}
```

`throwIfAborted` 必须在请求前和请求后检查 `signal.aborted` 并抛出 `DOMException("Aborted", "AbortError")`。声明文件写出注入函数参数、任务和返回三态。

- [ ] **Step 4: 实现 Axios 适配层**

`duomi-video.ts` 导出：

```ts
export async function createDuomiVideoGenerationTask(
  config: Pick<AiConfig, "baseUrl" | "apiKey" | "useProxy">,
  model: string,
  prompt: string,
  references: ReferenceImage[],
  size: string,
  seconds: string,
  options?: { signal?: AbortSignal },
): Promise<{ id: string; provider: "duomi"; model: string }>;

export async function pollDuomiVideoGenerationTask(
  config: Pick<AiConfig, "baseUrl" | "apiKey" | "useProxy">,
  task: { id: string; provider: "duomi"; model: string },
  options?: { signal?: AbortSignal },
): Promise<
  | { status: "pending" }
  | { status: "completed"; result: { url: string; mimeType: string } }
  | { status: "failed"; error: string }
>;
```

创建时使用 `references.map((image) => image.url || image.dataUrl)`，不得调用 `imageToDataUrl`、`dataUrlToFile` 或 `FormData`。传给多米请求体的模型名必须先经过 `modelOptionName(model)` 去掉渠道编码；生命周期返回后再把任务的 `model` 改回原始渠道编码值，保证后续查询仍能解析到同一个渠道：

```ts
const modelName = modelOptionName(model);
const task = await createDuomiVideoLifecycleTask({
  model: modelName,
  request: { model: modelName, prompt, size, seconds, referenceUrls },
  signal: options?.signal,
  create,
});
return { ...task, model };
```

生命周期注入函数中的 Axios 请求必须使用：

```ts
const proxyUrl = config.useProxy ? buildApiUrl(config.baseUrl, path, true) : "";
const url = duomiRequestUrl(config.baseUrl, path, config.useProxy, proxyUrl);
const proxyHeaders = buildAiProxyHeaders({
  baseUrl: config.baseUrl,
  apiFormat: "openai",
  useProxy: config.useProxy,
});
const headers = duomiRequestHeaders(
  config.baseUrl,
  config.apiKey,
  config.useProxy,
  proxyHeaders,
  AI_PROXY_TARGET_HEADER,
);
```

401/403 返回“多米视频鉴权失败，请检查 API Key、账户余额或模型权限”；429 返回“多米视频请求被限流或额度不足，请稍后重试”；取消保持 `AbortError`；Axios 超时返回“多米视频生成超时，请稍后重试”；其他响应优先读取 `duomiVideoTaskErrorMessage`。

- [ ] **Step 5: 运行生命周期和类型检查**

```powershell
Set-Location web
node --test server/duomi-provider-utils.test.mjs server/duomi-video-provider-utils.test.mjs server/duomi-video-lifecycle.test.mjs
npm.cmd run typecheck
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交任务客户端**

```powershell
git add web/src/services/api/duomi-video-lifecycle.mjs web/src/services/api/duomi-video-lifecycle.d.mts web/server/duomi-video-lifecycle.test.mjs web/src/services/api/duomi-video.ts
git commit -m "feat: add duomi video task lifecycle"
```

### Task 5: 接入主视频流程并同步视频设置

**Files:**

- Modify: `web/src/services/api/video.ts`
- Modify: `web/src/components/video-settings-panel.tsx`
- Modify: `web/src/pages/video/index.tsx`
- Test: `web/server/video-provider-utils.test.mjs`
- Test: `web/server/duomi-video-lifecycle.test.mjs`

- [ ] **Step 1: 增加主流程类型和分发代码**

把任务类型扩展为：

```ts
export type VideoGenerationTask = {
  id: string;
  provider: "openai" | "seedance" | "duomi";
  model: string;
};
```

在 `createVideoGenerationTask` 中，解析渠道后先处理多米协议：

```ts
if (requestConfig.videoApiFormat === "duomi") {
  if (videoReferences.length || audioReferences.length)
    throw new Error("多米 Grok 视频不支持参考视频或参考音频，请移除对应素材");
  return createDuomiVideoGenerationTask(
    requestConfig,
    selectedModel,
    prompt,
    references,
    requestConfig.size,
    requestConfig.videoSeconds,
    options,
  );
}
```

该分支必须位于 `isSeedanceVideoConfig` 和 `createOpenAIVideoTask` 之前，确保 `grok-video-1.5` 不进入现有 `isUnsupportedXaiVideoModel` 错误分支。

在查询函数增加：

```ts
if (task.provider === "duomi")
  return pollDuomiVideoGenerationTask(requestConfig, task, options);
return task.provider === "seedance"
  ? pollSeedanceTask(requestConfig, task, options)
  : pollOpenAIVideoTask(requestConfig, task, options);
```

`requestVideoGeneration` 使用 `DUOMI_VIDEO_POLL_INTERVAL_MS` 和 `DUOMI_VIDEO_POLL_MAX_ATTEMPTS`，避免复制数值。最后一次仍未完成时，多米任务抛出“多米视频生成超时，请稍后重试”，Seedance 和标准视频保留当前提示。

`web/src/pages/video/index.tsx` 的日志轮询也使用同一常量：Seedance 仍为 5 秒，多米和标准视频为 2.5 秒；达到最后一次时根据 `log.task.provider === "duomi"` 显示多米超时提示。不要改变现有待处理日志恢复行为。

- [ ] **Step 2: 让设置界面准确反映固定 720p**

在 `VideoSettingsPanel` 中解析当前视频模型渠道：

```ts
const requestConfig = resolveModelRequestConfig(
  config,
  config.model || config.videoModel,
);
const isDuomiVideo = requestConfig.videoApiFormat === "duomi";
```

多米视频时只显示选中的 `720p` 控件，不显示可编辑的自定义分辨率输入，并显示简短辅助文字“多米 Grok 视频当前固定使用 720p”。尺寸和时长仍使用现有控件，发送时由多米适配器转换为 `aspect_ratio` 和整数 `duration`。

- [ ] **Step 3: 运行视频回归测试和构建检查**

```powershell
Set-Location web
node --test server/video-provider-utils.test.mjs server/duomi-video-provider-utils.test.mjs server/duomi-video-lifecycle.test.mjs
npm.cmd run test:proxy
npm.cmd run typecheck
npm.cmd run build
```

Expected: 所有 Node 测试 PASS，TypeScript PASS，Vite 生产构建 PASS；仅允许保留项目既有的分包体积警告。

- [ ] **Step 4: 提交主流程接线**

```powershell
git add web/src/services/api/video.ts web/src/components/video-settings-panel.tsx web/src/pages/video/index.tsx
git commit -m "feat: route video generation through duomi"
```

### Task 6: 更新文档并完成浏览器验收

**Files:**

- Modify: `docs/content/docs/overview/features.mdx`
- Modify: `docs/content/docs/canvas/canvas-node-manual.mdx`
- Modify: `docs/content/docs/progress/pending-test.mdx`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新用户文档**

在功能说明中写明：

```md
- “新增渠道”菜单提供“多米 API”模板，自动填写 `https://duomiapi.com`，启用多米图片和视频协议，并加入已确认的图片模型与 `grok-video-1.5`。
- 多米 Grok 视频支持文生视频和公网图片 URL 参考图生视频，创建后自动查询 `/v1/videos/tasks/{task_id}`。
- 多米 Grok 视频当前固定使用 `720p`；本地、剪贴板、Base64、Blob、localhost 和私网参考图不会自动上传，会在请求前被拒绝。
```

在画布手册中给出操作顺序：创建多米模板渠道、填写 API Key、选择 `grok-video-1.5` 为默认视频模型、使用无参考图或公网参考图生成、停止生成后本地不再轮询。

在 `pending-test.mdx` 把模拟测试与真实线上请求分开：自动测试覆盖路径、鉴权、请求体、状态、取消、私网拒绝和配置迁移；真实 API Key 下的文生视频、参考图视频、余额不足、内容拒绝和任务超时仍标记为待联调。

在 `CHANGELOG.md` 的 `Unreleased` 增加：

```md
- [新增] 多米渠道模板支持 grok-video-1.5 异步文生视频与公网参考图生视频。
```

- [ ] **Step 2: 运行最终自动验证**

```powershell
Set-Location web
node --test server/duomi-provider-utils.test.mjs server/duomi-image-provider-utils.test.mjs server/duomi-image-lifecycle.test.mjs server/duomi-image-batch.test.mjs server/duomi-video-provider-utils.test.mjs server/duomi-video-lifecycle.test.mjs server/video-provider-utils.test.mjs
npm.cmd run test:proxy
npm.cmd run typecheck
npm.cmd run build
npx.cmd prettier --check src/services/api/duomi-provider-utils.mjs src/services/api/duomi-provider-utils.d.ts src/services/api/duomi-image-provider-utils.mjs src/services/api/duomi-image-provider-utils.d.ts src/services/api/duomi-video-provider-utils.mjs src/services/api/duomi-video-provider-utils.d.ts src/services/api/duomi-video-lifecycle.mjs src/services/api/duomi-video-lifecycle.d.mts src/services/api/duomi-video.ts src/services/api/video.ts src/stores/use-config-store.ts src/components/layout/app-config-modal.tsx src/components/video-settings-panel.tsx server/duomi-provider-utils.test.mjs server/duomi-image-provider-utils.test.mjs server/duomi-video-provider-utils.test.mjs server/duomi-video-lifecycle.test.mjs
```

Expected: 测试、类型检查、构建和本次文件定向格式检查全部 PASS。不要把全仓既有格式问题作为本次失败归因。

- [ ] **Step 3: 启动隔离服务并执行浏览器验收**

在端口未占用时运行：

```powershell
Set-Location web
npm.cmd run dev -- --port 3010
```

浏览器验收：

1. 打开 `http://127.0.0.1:3010`，进入配置的“渠道”页。
2. 从“新增渠道”菜单选择“多米 API”。
3. 确认 Base URL、图片协议、视频协议和五个建议模型正确，API Key 为空。
4. 切换视频协议到标准再切回多米，确认模型列表不丢失且 `grok-video-1.5` 去重。
5. 把 `grok-video-1.5` 设为默认视频模型，确认视频设置只显示固定 `720p`。
6. 使用模拟服务生成文生视频，确认创建路径、原始 `Authorization`、请求体和查询路径正确，成功 URL 进入视频结果。
7. 使用公网参考图，确认 URL 原顺序进入 `image_urls`。
8. 使用本地剪贴板图片或 `http://127.0.0.1/...`，确认出现“仅支持公网图片 URL”，且网络面板没有多米创建请求。
9. 取消进行中的任务，确认停止后不再查询。

- [ ] **Step 4: 提交文档和验收记录**

```powershell
git add docs/content/docs/overview/features.mdx docs/content/docs/canvas/canvas-node-manual.mdx docs/content/docs/progress/pending-test.mdx CHANGELOG.md
git commit -m "docs: document duomi grok video channels"
```

- [ ] **Step 5: 检查最终工作树和提交序列**

```powershell
git status --short --branch
git log -8 --oneline
```

Expected: 工作树只保留任务开始前就存在的用户改动；本次实现文件全部已提交，最近提交按 Task 1 至 Task 6 的顺序可审查。
