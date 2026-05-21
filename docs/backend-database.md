# 后端数据库说明

本文档记录后端当前已经使用，以及后续规划会用到的主要数据表。

## 数据库

后端使用 GORM 管理数据库连接和表结构迁移。

支持的存储驱动：

- `sqlite`
- `mysql`
- `postgresql`

当前启动时执行 `AutoMigrate`，自动维护以下表：

- `users`
- `prompts`
- `assets`
- `ai_configs`
- `canvases`
- `generations`
- `credit_logs`
- `images`

后续新增表时，优先保持表数量少，能用字段或 JSON 表达的配置、状态、统计和扩展信息先不拆表。

### users

系统用户表。用户基础信息、角色、算力点余额和邀请关系放在该表中。

| 字段              | 类型     | 说明                       |
|-----------------|--------|--------------------------|
| `id`            | string | 主键                       |
| `username`      | string | 用户名，唯一索引                 |
| `password`      | string | 密码哈希                     |
| `email`         | string | 邮箱                       |
| `display_name`  | string | 昵称                       |
| `avatar_url`    | string | 头像地址                     |
| `role`          | string | 角色：`user`、`admin`        |
| `credits`       | number | 生图剩余额度，注册默认 4，管理员账号不消耗   |
| `preferences`   | json   | 跨设备偏好（生图默认 `quality`、`size`、`count` 等） |
| `aff_code`      | string | 用户自己的邀请码，唯一索引，规划字段       |
| `aff_count`     | number | 已邀请用户数量，冗余统计字段，规划字段      |
| `inviter_id`    | string | 邀请人用户 ID，规划字段            |
| `github_id`     | string | GitHub 用户 ID，规划字段        |
| `linux_do_id`   | string | Linux.do 用户 ID，规划字段      |
| `wechat_id`     | string | 微信用户 ID，规划字段             |
| `status`        | string | 用户状态：`active`、`ban`，规划字段 |
| `last_login_at` | string | 最近登录时间                   |
| `extra`         | json   | 扩展信息                     |
| `created_at`    | string | 创建时间                     |
| `updated_at`    | string | 更新时间                     |

### prompts

提示词表。后续公开提示词、内置 GitHub 系统提示词、分类和扩展信息都优先放在该表字段或 JSON 中。

| 字段           | 类型     | 说明                           |
|--------------|--------|------------------------------|
| `id`         | string | 主键                           |
| `title`      | string | 标题                           |
| `cover_url`  | string | 封面图                          |
| `prompt`     | string | 提示词内容                        |
| `tags`       | json   | 标签列表                         |
| `category`   | string | 分类标识                         |
| `visibility` | string | 可见性：公开、私有、系统内置等，规划字段         |
| `preview`    | text   | Markdown 展示内容，可包含文本、图片、视频链接等 |
| `extra`      | json   | 扩展信息                         |
| `created_at` | string | 创建时间                         |
| `updated_at` | string | 更新时间                         |

`github_url` 仅用于接口返回，不写入数据库。

### assets

素材表。`visibility=public` 由管理员通过后台维护（前台 `/asset-library` 展示）；`visibility=private` 由用户在画布/工作台保存到「我的素材」，通过 `/api/assets/me` 端点管理。

| 字段               | 类型     | 说明                            |
|------------------|--------|-------------------------------|
| `id`             | string | 主键                            |
| `user_id`        | string | 所属用户，为空表示公开素材                 |
| `title`          | string | 标题                            |
| `type`           | string | 素材类型：`text`、`image`、`video` 等 |
| `visibility`     | string | 可见性：`public`、`private`         |
| `cover_url`      | string | 封面图                           |
| `tags`           | json   | 标签列表                          |
| `category`       | string | 分类标识                          |
| `description`    | string | 描述                            |
| `content`        | text   | 文本或 Markdown 内容               |
| `url`            | string | 图片、视频等媒体地址                    |
| `like_count`     | number | 点赞量，规划字段                      |
| `favorite_count` | number | 收藏量，规划字段                      |
| `view_count`     | number | 查看量，规划字段                      |
| `extra`          | json   | 扩展信息，规划字段                     |
| `created_at`     | string | 创建时间                          |
| `updated_at`     | string | 更新时间                          |

### ai_configs

OpenAI 兼容接口的连接配置。同一时间最多一条记录的 `enabled=true`，所有反代请求都使用启用的那条配置。

| 字段            | 类型      | 说明                              |
|---------------|---------|---------------------------------|
| `id`          | string  | 主键                              |
| `name`        | string  | 配置名称                            |
| `base_url`    | string  | OpenAI 兼容接口的根地址，可省略 `/v1` 后缀    |
| `api_key`     | string  | 调用密钥，仅后端持有；列表接口返回前会脱敏           |
| `image_model` | string  | 图像模型 ID，反代生图时强制使用，覆盖前端请求体中的 `model` |
| `text_model`  | string  | 文本模型 ID，反代 chat 时强制使用             |
| `enabled`     | bool    | 是否启用；启用某条时其他记录会自动置为 false       |
| `created_at`  | string  | 创建时间                            |
| `updated_at`  | string  | 更新时间                            |

### canvases

用户私有画布。`data` 字段保存前端 `CanvasProject` 整体的 JSON 序列化结果（包含 nodes、connections、chatSessions、viewport 等）。同一用户多个画布通过 `user_id` 索引区分。

| 字段           | 类型     | 说明                       |
|--------------|--------|--------------------------|
| `id`         | string | 主键，前端可生成传入               |
| `user_id`    | string | 所属用户，索引                  |
| `title`      | string | 画布名称                     |
| `cover_url`  | string | 列表展示用封面，可选               |
| `data`       | json   | 完整画布 JSON               |
| `created_at` | string | 创建时间                     |
| `updated_at` | string | 更新时间                     |

注：画布中图片节点的 Blob 已上云到 `images` 表（按 `user_id` 隔离）；`data` 中保存的 `storageKey` 是 `images.id`，跨设备可恢复。迁移前用 `image:` 前缀的 storageKey 仍保留浏览器 IndexedDB 兜底读取，新写入一律走服务器。

### generations

生图工作台历史，按用户隔离。`thumbnails` 中保存的是 `images.id` 列表，跨设备可恢复原图；早期的 `image:` 前缀仍能在原浏览器 IndexedDB 中兜底读取，丢了会显示"图片缓存丢失"。

| 字段              | 类型     | 说明                                       |
|-----------------|--------|------------------------------------------|
| `id`            | string | 主键                                       |
| `user_id`       | string | 所属用户，索引                                  |
| `prompt`        | string | 提示词                                      |
| `mode`          | string | `image`（文生图）或 `edit`（图生图）                |
| `model`         | string | 调用时启用配置中的 imageModel                     |
| `size`          | string | 请求尺寸                                     |
| `quality`       | string | 请求质量                                     |
| `count`         | number | 请求数量                                     |
| `success_count` | number | 成功张数                                     |
| `fail_count`    | number | 失败张数                                     |
| `duration_ms`   | number | 耗时（毫秒）                                  |
| `status`        | string | `running` / `success` / `partial` / `failed`（`running` 是点击"开始生成"立即写入的占位状态，task 跑完会被 upsert 为后三种之一） |
| `thumbnails`    | json   | `images.id` 列表（最多 6 张）                   |
| `references`    | json   | 参考图 `images.id` 列表，便于切换记录时恢复参考图   |
| `errors`        | json   | 失败 slot 的 error.message 列表，供 admin 排查    |
| `request_params`| json   | 最近一次反代调用的请求参数（mode/n/size/quality/referenceCount） |
| `upstream_meta` | text   | 最近一次成功反代上游响应 raw JSON 字符串（已脱敏：b64_json 替换为 `<N bytes redacted>`） |
| `created_at`    | string | 创建时间                                     |

### images

用户上传 / 生成图片的元信息表。二进制本身**落到磁盘**（`IMAGE_DIR`，默认 `data/uploads`），DB 只保留路径引用，避免数据库膨胀；画布节点、参考图、生图结果、素材都通过 `storageKey = images.id` 引用。`GET /api/images/:id` **公开访问**（id 是不可枚举的 UUID），方便 `<img src>` 直接渲染；上传仍需登录，删除仅 owner。

| 字段           | 类型     | 说明                              |
|--------------|--------|---------------------------------|
| `id`         | string | 主键，前端通过 `POST /api/images` 获得   |
| `user_id`    | string | 所属用户，索引                         |
| `mime_type`  | string | MIME 类型，例如 `image/png`           |
| `size`       | number | 字节数                             |
| `path`       | string | 相对 `IMAGE_DIR` 的文件路径，例如 `userId/img-xxx.png` |
| `created_at` | string | 创建时间                             |

文件结构按 `{IMAGE_DIR}/{userId 安全化}/{id}.{ext}` 组织；扩展名根据 MIME 推导，未知类型落到 `.bin`。删除一条记录会同步 `os.Remove` 对应文件。

### credit_logs

用户积分流水。仅追加，无更新与删除。

| 字段            | 类型     | 说明                                       |
|---------------|--------|------------------------------------------|
| `id`          | string | 主键                                       |
| `user_id`     | string | 所属用户，索引                                  |
| `type`        | string | `consume` / `admin_adjust` / `signup_bonus` |
| `amount`      | number | 变动量，扣减为负、增加为正                            |
| `balance`     | number | 变动后剩余积分                                  |
| `model`       | string | `consume` 时记录使用的模型                       |
| `related_id`  | string | 关联业务 ID（如 generation.id），可空              |
| `operator_id` | string | `admin_adjust` 时记录操作管理员 ID               |
| `remark`      | string | 备注                                       |
| `created_at`  | string | 创建时间                                     |

### settings

系统配置表，只保存两行数据：`public` 放前端可读取的公开配置，`private` 放仅后端和管理员可读取的私有配置，配置值都用 JSON。

| 字段           | 类型     | 说明                    |
|--------------|--------|-----------------------|
| `key`        | string | 主键：`public`、`private` |
| `value`      | json   | 配置内容                  |
| `created_at` | string | 创建时间                  |
| `updated_at` | string | 更新时间                  |

`public.value` 常放前端展示和可公开读取的配置，例如模型列表、订阅套餐、功能开关等。
`private.value` 常放渠道密钥、支付配置、奖励规则、后台内部开关等。

### dicts

字典表。一个字典一行，具体字典项数据放在 `items`。

| 字段           | 类型     | 说明    |
|--------------|--------|-------|
| `code`       | string | 字典编码  |
| `name`       | string | 字典名称  |
| `remark`     | string | 备注    |
| `items`      | text   | 字典值数据 |
| `created_at` | string | 创建时间  |
| `updated_at` | string | 更新时间  |

可维护分类、标签、业务枚举、模型分类、日志类型等。

### credit_logs

用户算力点变更流水表。充值、消费、订阅扣减、邀请奖励、后台调整等余额变化都写入该表。

| 字段           | 类型     | 说明                       |
|--------------|--------|--------------------------|
| `id`         | string | 主键                       |
| `user_id`    | string | 关联用户 ID                  |
| `type`       | string | 类型：充值、消费、订阅扣减、邀请奖励、后台调整等 |
| `amount`     | number | 本次变动数量，增加为正，扣减为负         |
| `balance`    | number | 变动后的用户算力点余额              |
| `related_id` | string | 关联订单、任务或日志 ID，可为空        |
| `remark`     | string | 备注                       |
| `extra`      | json   | 扩展信息                     |
| `created_at` | string | 创建时间                     |

### orders

订单表。统一记录充值、订阅购买等支付订单。

| 字段                  | 类型     | 说明                   |
|---------------------|--------|----------------------|
| `id`                | string | 主键                   |
| `user_id`           | string | 关联用户 ID              |
| `type`              | string | 订单类型：充值、订阅等          |
| `provider`          | string | 支付渠道：Linux LDC、聚合支付等 |
| `amount`            | number | 支付金额                 |
| `credits`           | number | 到账算力点                |
| `status`            | string | 订单状态：待支付、已支付、失败、关闭等  |
| `provider_order_id` | string | 第三方订单号               |
| `extra`             | json   | 扩展信息                 |
| `created_at`        | string | 创建时间                 |
| `paid_at`           | string | 支付时间                 |
| `updated_at`        | string | 更新时间                 |

### subscriptions

用户订阅表。一个用户可以有多个订阅记录，套餐配置放在 `settings.public.value` 中。

| 字段              | 类型     | 说明                                       |
|-----------------|--------|------------------------------------------|
| `id`            | string | 主键                                       |
| `user_id`       | string | 关联用户 ID                                  |
| `plan_key`      | string | 套餐标识，对应 `settings.public.value` 中的订阅套餐配置 |
| `order_id`      | string | 关联订单 ID，可为空                              |
| `status`        | string | 状态：生效中、已过期、已取消等                          |
| `total_credits` | number | 订阅总额度                                    |
| `used_credits`  | number | 已使用额度                                    |
| `started_at`    | string | 开始时间                                     |
| `expired_at`    | string | 过期时间                                     |
| `extra`         | json   | 扩展信息                                     |
| `created_at`    | string | 创建时间                                     |
| `updated_at`    | string | 更新时间                                     |

### files

文件表。用于统一管理上传图片、视频等文件，保存最终可访问地址。缩略图和视频封面优先按 URL 命名规则推导，特殊情况放在
`extra.coverUrl`。

| 字段           | 类型     | 说明          |
|--------------|--------|-------------|
| `id`         | string | 主键          |
| `user_id`    | string | 上传用户 ID，可为空 |
| `name`       | string | 原始文件名       |
| `url`        | string | 完整可访问地址     |
| `mime_type`  | string | MIME 类型     |
| `size`       | number | 文件大小        |
| `extra`      | json   | 扩展信息        |
| `created_at` | string | 创建时间        |

### canvases

画布表。保存用户私有画布、公开画布和模板，分享、协作、审核等低频配置放在 `extra`。

| 字段               | 类型     | 说明                                          |
|------------------|--------|---------------------------------------------|
| `id`             | string | 主键                                          |
| `user_id`        | string | 所属用户 ID                                     |
| `title`          | string | 画布标题                                        |
| `description`    | string | 描述                                          |
| `cover_url`      | string | 封面图                                         |
| `data`           | json   | 画布节点、边、视图等数据                                |
| `visibility`     | string | 可见性：`private`、`public`                      |
| `status`         | string | 状态：`draft`、`pending`、`published`、`rejected` |
| `is_template`    | bool   | 是否模板                                        |
| `view_count`     | number | 查看量                                         |
| `like_count`     | number | 点赞量                                         |
| `favorite_count` | number | 收藏量                                         |
| `copy_count`     | number | 复制量                                         |
| `extra`          | json   | 扩展信息，如分享、协作、审核备注等                           |
| `created_at`     | string | 创建时间                                        |
| `updated_at`     | string | 更新时间                                        |

### generation_tasks

接口调用队列表。用于图片、文本、图生图等后端模型调用的排队、状态和结果记录。

| 字段            | 类型     | 说明                   |
|---------------|--------|----------------------|
| `id`          | string | 主键                   |
| `user_id`     | string | 发起用户 ID              |
| `type`        | string | 任务类型：文本生成、文生图、图生图等   |
| `model`       | string | 使用模型                 |
| `channel`     | string | 使用渠道                 |
| `status`      | string | 状态：排队中、执行中、成功、失败、取消等 |
| `credits`     | number | 扣除算力点                |
| `input`       | json   | 请求参数                 |
| `output`      | json   | 生成结果                 |
| `error`       | string | 错误信息                 |
| `extra`       | json   | 扩展信息                 |
| `created_at`  | string | 创建时间                 |
| `started_at`  | string | 开始时间                 |
| `finished_at` | string | 完成时间                 |
