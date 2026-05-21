# 前后端接口响应约定

后端业务接口统一返回 JSON：

```json
{
  "code": 0,
  "data": {},
  "msg": "ok"
}
```

- `code`: 业务状态码，`0` 表示成功，非 `0` 表示失败。
- `data`: 业务数据。失败时通常为 `null`。
- `msg`: 响应消息。成功默认为 `ok`，失败时放错误原因。

前端请求逻辑以 `code` 判断业务是否成功。当前后端业务失败也会返回 HTTP 200，前端不要只依赖 HTTP 状态码判断结果。

接口连接失败、服务不可达、返回体不是约定 JSON 时，前端按网络或接口异常处理。

## /api/v1 反代

`/api/v1/images/generations`、`/api/v1/images/edits`、`/api/v1/models` 由后端反代 OpenAI 兼容接口，仍走 `{code, data, msg}` 包装。

`/api/v1/images/edits` 接受**两种**入参（按请求头 `Content-Type` 分流）：

| Content-Type | body | 适用场景 |
|---|---|---|
| `application/json` | `{ prompt, n?, size?, quality?, references: ["img-xxx", ...] }` | 参考图都已经在 `images` 表里（前端先调过 `POST /api/images` 拿到 id）。后端按 owner 校验后从磁盘读取，自己拼 multipart 上送。请求体 KB 级，**首选** |
| `multipart/form-data` | 传统 multipart：`file=...`（多张就多个 file 字段）+ `prompt` / `n` / `size` / `quality` | 画布里截屏 / 裁剪后还没存盘的瞬时图。请求体 MB 级 |

JSON 路径限制：
- references 最多 **8** 张
- 每条 references[i] 必须能在 `images` 表查到，且 `user_id` 等于当前请求用户；否则返回 `参考图不存在` 或 `参考图无权访问`

生图接口成功时 `data` 形如：

```json
{
  "upstream": { "data": [{ "b64_json": "..." }] },
  "remaining": 3
}
```

- `upstream`：原始 OpenAI 兼容响应。
- `remaining`：当前用户剩余生图额度；管理员返回 `-1` 表示无限制。

`/api/v1/chat/completions` 走流式 SSE 透传，**不**包装为 `{code, data, msg}`。

常见错误 `msg`：

- `请先登录`：未携带或携带的 JWT 已失效。
- `未配置启用的模型，请联系管理员`：管理后台尚未启用任何 AI 配置。
- `额度不足，请联系管理员`：普通用户调用生图但 `credits <= 0`。
- `请求过于频繁，请约 N 秒后再试`：文本问答超过每分钟 5 次的限流。
- `权限不足`：普通用户访问仅管理员可用的反代端点（如 `/api/v1/models`）。

## 用户数据接口

下列接口都走 `OptionalAuth`，handler 内 `requireUser`；未登录返回 `请先登录`。

- `GET /api/user/profile` → `{ user, totalConsumed, totalGranted, generatedCount }`
- `GET /api/user/credit-logs?page=&pageSize=` → 分页流水
- `GET /api/canvases?page=&pageSize=&keyword=` → 当前用户的画布概要（无 data）
- `GET /api/canvases/:id` → 完整画布
- `POST /api/canvases` → upsert；id 可由前端生成
- `DELETE /api/canvases/:id`
- `GET /api/generations?page=&pageSize=` → 当前用户的生图历史
- `POST /api/generations` → 工作台完成一次生成后写入；缩略图字段只保存 storageKey
- `DELETE /api/generations/:id`
- `GET /api/assets/me`、`POST /api/assets/me`、`DELETE /api/assets/me/:id`：当前用户的私有素材

公开素材库仍走 `GET /api/assets`（按 `visibility=public` 过滤）。

## 管理后台 — 全局统计

仅 `role=admin` 可调，命中 `AdminAuth` 中间件，未登录 / 非管理员都会返回 `未登录或权限不足`。

- `GET /api/admin/generations?keyword=&status=&page=&pageSize=` → `{ items, total }`，items 每项是 `Generation` 加 `username`；`keyword` 同时匹配 `prompt` 和 `username`；`status` 可选 `success` / `partial` / `failed`。
- `GET /api/admin/credit-logs?keyword=&type=&page=&pageSize=` → `{ items, total }`，items 每项是 `CreditLog` 加 `username` 和 `operatorUsername`（管理员调整时）；`keyword` 匹配 `username` / `remark` / `model`；`type` 可选 `consume` / `admin_adjust` / `signup_bonus`。

## 图片接口

- `POST /api/images`（需登录，multipart `file` 字段）→ `{ id, url, mimeType, size }`，`url` 是相对路径 `/api/images/{id}` 可直接喂 `<img src>`
- `GET /api/images/:id`（**公开**，无需 token）→ 流式返回图片二进制，附 `Cache-Control: public, max-age=86400, immutable`
- `DELETE /api/images/:id`（需登录且必须为 owner）→ 同步删 DB 行和磁盘文件

二进制本身落盘到 `IMAGE_DIR`（默认 `data/uploads`），DB 只保留 path。开放公开读是因为 `id` 是 UUID 不可枚举，等价于 imgur 式的"难以猜中"链接。
