# 多米 API 图片模型接入设计

## 1. 目标

为 Infinite Canvas 增加多米 API 图片协议适配，使同一多米渠道能够使用以下图片模型：

- `gpt-image-2`
- `gemini-2.5-flash-image`（nano-banana）
- `gemini-3-pro-image-preview`（nano-banana-pro）
- `gemini-3.1-flash-image-preview`（nano-banana-2）

第一阶段支持文生图，以及参考图已经是公网 HTTP/HTTPS 地址时的图生图。第一阶段不建设图片上传服务，不把浏览器本地 Base64、Blob URL 或 IndexedDB 图片自动上传到第三方。

## 2. 现状与兼容差异

Infinite Canvas 当前图片生成分为两类：

- OpenAI 格式：调用 `/v1/images/generations` 或 `/v1/images/edits`，并期望首次响应直接包含 `data[].url` 或 `data[].b64_json`。
- Gemini 格式：调用 Google Gemini `generateContent`，并期望同步返回 `inlineData` 或 `fileData`。

多米 API 的图片接口均为异步任务协议，不能直接套用以上任一流程。

### 2.1 gpt-image-2

- 创建：`POST /v1/images/generations`
- 查询：`GET /v1/tasks/{id}`
- 创建响应：顶层 `id`
- 成功状态：`state === "succeeded"`
- 图片结果：`data.images[].url`

### 2.2 NANO-BANANA

- 文生图：`POST /api/gemini/nano-banana`
- 图生图：`POST /api/gemini/nano-banana-edit`
- 查询：`GET /api/gemini/nano-banana/{id}`
- 创建响应：`data.task_id`
- 成功状态：`data.state === "succeeded"`
- 图片结果：`data.data.images[].url`

NANO-BANANA 图生图的 `image_urls` 最多接收 10 个公网链接，不接受 Base64。其 `aspect_ratio` 支持 `auto`、`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9`，`image_size` 使用大写的 `1K`、`2K`、`4K`。

接口文档示例出现了 `gemini-3.1-flash-lite-image`，但模型枚举中没有该值。第一阶段不将它加入内置建议模型；只有真实接口验证通过后才补充。

## 3. 方案选择

采用独立的“多米图片适配器”，不在现有 OpenAI 和 Gemini 请求函数中按模型名堆积接口分支，也不增加必须部署的同步转换服务。

选择该方案的原因：

- 保持当前浏览器直连模型渠道的架构。
- 将异步创建、轮询和结果解析集中在清晰边界内。
- gpt-image-2 与 NANO-BANANA 可以复用任务生命周期，同时保留各自不同的创建路径和请求体。
- 不改变其他 OpenAI、Gemini、视频和音频渠道的行为。

## 4. 配置设计

在模型渠道中增加独立的图片协议字段 `imageApiFormat`：

- `standard`：沿用当前 OpenAI 或 Gemini 图片行为。
- `duomi`：使用多米图片适配器。

该字段只影响图片生成，不替代渠道现有的 `apiFormat`。这样同一渠道的文本、音频或视频能力仍可继续使用原有调用格式。

多米渠道的推荐配置为：

- Base URL：`https://duomiapi.com`
- 图片协议：`多米 API`
- API Key：用户自己的多米密钥
- 模型：手动加入所需图片模型

多米 `/v1/models` 当前返回 404。配置页不伪造模型列表；点击拉取模型失败时继续允许手动录入，并为多米图片协议显示上述四个已确认模型作为建议项。

## 5. 组件边界

### 5.1 多米图片请求服务

新增独立服务负责：

- 根据模型和参考图数量选择创建接口。
- 构造多米请求体。
- 使用原始 `Authorization: <API Key>`，不自动添加 `Bearer`。
- 从创建响应提取任务 ID。
- 轮询任务状态并解析图片 URL。
- 处理取消、失败、超时和异常响应。

现有 `requestGeneration` 和 `requestEdit` 只负责根据渠道图片协议分发到标准实现或多米实现，返回值仍保持当前 `{ id, dataUrl }[]` 结构。

### 5.2 纯协议工具

延续现有视频 provider 工具模式，将以下纯逻辑放在可独立测试的 `.mjs` 文件中：

- 多米模型族识别。
- 创建路径选择。
- 任务 ID 提取。
- 状态归一化。
- 结果 URL 提取。
- 尺寸、比例和质量映射。
- 公网参考图 URL 校验。

TypeScript 调用侧通过对应声明文件获得类型信息。

### 5.3 渠道配置界面

渠道配置增加“图片协议”选择。选择多米 API 时：

- 保留 Base URL 和 API Key 输入。
- 模型列表允许手动添加。
- 显示已确认的多米图片模型建议。
- 提示模型列表接口不可用，需要手动选择模型。
- 不新增上传服务、回调地址或其他当前阶段不使用的配置。

## 6. 请求数据流

### 6.1 gpt-image-2 文生图

1. 将画布提示词、模型、尺寸和质量传给多米适配器。
2. 请求 `POST /v1/images/generations`。
3. 从顶层 `id` 获取任务 ID。
4. 轮询 `GET /v1/tasks/{id}`。
5. `state` 为 `pending` 或 `running` 时继续等待。
6. `state` 为 `succeeded` 时读取 `data.images[].url`。
7. 将远程图片交给现有图片存储流程并创建画布节点。

### 6.2 NANO-BANANA 文生图

1. 无参考图时请求 `POST /api/gemini/nano-banana`。
2. 请求体使用 `model`、`prompt`、`aspect_ratio` 和按需提供的 `image_size`。
3. 从 `data.task_id` 获取任务 ID。
4. 轮询 `GET /api/gemini/nano-banana/{id}`。
5. 成功后读取 `data.data.images[].url`。

### 6.3 NANO-BANANA 图生图

1. 有参考图时先验证所有参考图是否为公网 HTTP/HTTPS URL。
2. 参考图数量必须为 1 至 10 张，超过限制时在请求前明确报错，不静默截断。
3. 请求 `POST /api/gemini/nano-banana-edit`，使用 `image_urls` 数组。
4. 单张参考图默认不发送 `aspect_ratio`，遵循中转站文档建议；用户显式修改比例时才发送。
5. 创建后的轮询和结果解析与 NANO-BANANA 文生图相同。

## 7. 参数映射

- Infinite Canvas 比例值直接映射到 NANO-BANANA `aspect_ratio`；不支持的像素尺寸转换为最接近的已支持比例。
- `quality=low` 映射为 `image_size=1K`。
- `quality=medium` 或 `standard` 映射为 `image_size=2K`。
- `quality=high` 或 `hd` 映射为 `image_size=4K`。
- `gpt-image-2` 保持多米文档支持的 `size` 和 `quality` 字段，不发送中转站文档未声明的 `response_format`、`output_format`。
- 第一阶段每个异步任务生成一张图片。画布数量大于 1 时创建多个独立任务，并复用现有批量结果展示逻辑。

## 8. 任务生命周期与错误处理

- 默认每 2 秒查询一次，最长等待 5 分钟。
- 使用现有 `AbortSignal` 取消创建请求和轮询等待。
- `pending`、`running` 归一化为处理中。
- `succeeded` 归一化为成功。
- `error`、`failed`、`cancelled` 或包含错误消息的响应归一化为失败。
- HTTP 401/403 显示密钥、余额或模型权限提示。
- HTTP 429 显示限流或额度不足提示。
- 超时显示“任务仍未完成，请稍后重试”，不伪造失败结果。
- 成功状态没有图片 URL 时显示协议错误并保留任务 ID，便于排查。
- NANO-BANANA 收到本地 Base64、Blob URL 或不可公开访问的参考图时，在请求前说明该渠道只支持公网图片 URL。

## 9. CORS 与代理

已对以下接口执行浏览器预检验证，当前均返回允许跨域的响应：

- `/v1/images/generations`
- `/api/gemini/nano-banana`
- `/api/gemini/nano-banana-edit`
- `/api/gemini/nano-banana/{id}`

因此默认使用浏览器直连，不强制开启服务端代理。现有代理开关仍可保留作为部署环境兼容手段，但不是本次功能的前置条件。

## 10. 测试策略

纯协议工具使用 `node:test`，覆盖：

- 两类创建响应的任务 ID 提取。
- 两类查询响应的状态和图片 URL 提取。
- 错误状态、空结果和异常结构。
- gpt-image-2 与三个已确认 NANO-BANANA 模型的路由。
- 比例、质量和分辨率映射。
- 公网 URL、Base64、Blob URL 和超过 10 张参考图的校验。
- 取消和超时不继续发起轮询。

人工联调使用用户提供的有效多米 API Key，分别验证：

- gpt-image-2 文生图。
- 三个已确认 NANO-BANANA 模型的文生图。
- 公网单参考图和多参考图编辑。
- 余额不足、无模型权限、内容拒绝、任务失败和超时提示。
- 模型列表拉取 404 后仍能手动配置模型。

## 11. 文档与变更记录

实现完成后更新：

- 图片渠道配置和模型选择说明。
- 画布节点生成手册。
- `pending-test.mdx` 中的待验证项目。
- `CHANGELOG.md` 的 `Unreleased` 修复或新增记录。

文档必须明确：多米 NANO-BANANA 图生图第一阶段只支持公网参考图 URL，不支持自动上传浏览器本地图片。

## 12. 第一阶段验收标准

- 多米图片协议不会影响现有 OpenAI 和 Gemini 图片渠道。
- 用户能手动配置多米渠道和模型。
- gpt-image-2 和三个已确认 NANO-BANANA 模型能创建异步任务并轮询到图片结果。
- 画布取消生成后停止继续轮询。
- 失败、超时和无图片结果均有明确中文提示。
- 公网参考图可以进入 NANO-BANANA 编辑接口。
- 本地参考图在请求前被拒绝，并清楚说明公网 URL 限制。
- 不新增图片上传服务，不把本地图片发送给未经用户配置的第三方。

## 13. 后续阶段

只有在用户明确需要本地参考图直连多米图生图后，才单独设计图片上传能力。后续设计需要重新确认上传目的地、访问控制、生命周期、隐私、成本和清理策略，不纳入本次接入。
