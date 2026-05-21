# CHANGELOG

## Unreleased

+ [修复] 生图工作台点开始生成后，UI 立刻把所有 slot 渲染成"生成被中断，请点击重试"。根因是 v0.0.12 引入两阶段入库后，左侧记录列表立刻插入了 status=running 的 placeholder，用户/列表点击或自动联动到这条 placeholder 时 `previewGenerationLog` 看到 `status=running` 就按"中断"占位刷成 failed 卡片，把当前会话还在跑的 task 进度盖掉了。`previewGenerationLog` 现在判断「`status=running` 且本会话正在跑（running===true）」时仅切 URL 不重写 results，把 pending → success/failed 的控制权交还 generate() 自身。`/admin/generations` 上游响应区已能看到上游 chatgpt2api 真实报错信息（如 `/backend-api/conversation/... failed: status=500`），便于排查上游故障。

+ [修复] 上传图片接口 `/api/images` 偶发"一直在待处理"：multipart 大文件经 Next.js `rewrites` 默认转发时，会被 buffer 整个请求体再转给后端，加上生产模式下 rewrites 自身的 30/60s 响应超时，前端 fetch 容易长时间挂起。新增 `src/app/api/images/route.ts`（POST 上传）与 `src/app/api/images/[id]/route.ts`（GET 下载 / DELETE 删除）两个 Route Handler，沿用 `/api/v1/images/*` 已经验证过的 `duplex: "half"` streaming + `maxDuration = 5min` 模式直转后端，绕过 rewrites 卡顿。
+ [调整] 生图工作台点击「开始生成」后**立即**入库一条 `status=running` 占位记录，URL 同时切到 `/image/{id}`。之前要等所有 task 跑完才写库，过程中关页面/网络抖动会丢掉整次调用；现在两阶段：先 POST 创建占位 → 跑完 task → 用 id upsert 最终状态（success/partial/failed）。后端 `GenerationStatus` 枚举加 `running`；前端类型同步；左侧记录卡显示「进行中」金色 tag；管理后台「生图记录」状态筛选/列表也支持 running 项。若用户在 task 完成前关闭页面再回来，历史里仍能看到这条记录，被中断的 slot 显示「生成被中断，请点击重试」与真实"生成失败"做语义区分。
+ [新增] 管理后台「生图记录」详情弹窗在原有"提示词 + 参考图 + 生成结果"之上，新增「错误信息 / 请求参数 / 上游响应」三块审计区。`generations` 表加 `errors` / `request_params` / `upstream_meta` 三个字段：失败 slot 的 error.message 全部记录、调用反代时实际带的 size/quality/n/referenceCount 等参数透明可查、上游 OpenAI 兼容接口的原始响应 JSON（去掉 b64_json 大字段后）也落库。无论生成成功、部分成功、还是全部失败，admin 都能在一个页面看到完整调用细节。
+ [新增] 所有用户主动上传图片的位置（生图工作台参考图、剪贴板、画布拖入、画布节点替换、节点裁剪、素材库新增、公开素材库"加入我的素材"等）统一走新的 `useImageUploader` hook：上传期间右上角 antd `message.loading` 实时显示「正在上传XX…」，失败时换成中文错误提示。AI 生图结果自动落库不弹（避免与"正在生成图片"占位卡片重复反馈）。
+ [修复] 管理后台「生图记录」「积分流水」「用户管理」和个人中心 `/profile` 的时间显示比本地少 8 小时。根因是服务器进程跑在 UTC 时区，`time.Now().Format(time.RFC3339)` 输出 `…Z` 字符串，前端原样渲染。新增 `lib/format-datetime.ts` 工具按浏览器时区做 `toLocaleString("zh-CN")` 转换，所有"创建时间 / 时间 / 注册时间"列统一调用；后端时间格式保持 UTC + RFC3339 不动，避免再去碰镜像 TZ 设置。
+ [新增] 顶栏版本号变成可点击链接，跳转到 `/changelog` 更新日志页：以 Ant Design Timeline 时间线形式列出每个版本的「新增 / 修复 / 调整 / 安全 / 文档」条目，按 CHANGELOG.md 解析生成（不入库，发版改 markdown 自动同步）。Unreleased 标记「开发中」灰色节点。
+ [补录] 修复 CHANGELOG 中遗漏 `979f1fa config(next): 配置 TypeScript 构建错误忽略选项` 提交，补到 v0.0.2。

## v0.0.11 - 2026-05-21

+ [调整] 图片上传遇到 413 不再原样把"图片上传失败 HTTP 413""请求失败：413"等技术字符串显示给用户，统一换成中文友好提示：上传走「图片素材太大了（最多 50MB），请压缩或裁剪后再上传」；图生图等 multipart 接口走「请求体过大（超过 50MB），请压缩参考图或减少同时上传的图片数量」。前端在 `uploadImage` 上传前先按 50MB 预判，超过直接拦截，省一次网络往返。顺手把 401（未登录）/504（超时）也做了中文化。
+ [修复] 切换账号后 `/canvas` 列表仍短暂展示上一个用户的画布，需要手动刷新。根因是 `useCanvasStore` 是模块级 zustand state，登出/切账号时没被清空，新账号的 React Query 还在 pending 那段时间 UI 一直读旧数据。`useCanvasListSync` 现在监听 `userId` 变化，立即清空 store 并切回 loading 状态；queryKey 也从易变的 token 改为更稳定的 userId，避免 JWT 续签触发无谓重拉。
+ [修复] 画布助手面板标题误显示「画布助手(未开发)」。该面板（对话、生图、历史会话、参考图等）实际早已完整可用，标题恢复成「画布助手」。
+ [新增] 画布助手输入区支持点击「上传图片」按钮选取本地文件，以及把图片拖拽到输入框上传，与原本的粘贴上传效果一致；支持一次拖多张，非图片类型自动忽略。拖入时输入框出现蓝色高亮提示。
+ [新增] 画布内的所有图片现在都可以点击放大查看（复用 Ant Design `<Image>` 自带的预览浮层，支持缩放/旋转/键盘上下张切换，无需额外依赖）：
  - 图片节点：hover 工具栏新增「放大查看」按钮，与「下载图片」相邻；
  - 画布助手消息里的生图结果、参考图缩略图：直接点击即可放大；
  - 配置节点上下游输入预览缩略图：直接点击即可放大；点击不会触发节点拖拽。

## v0.0.10 - 2026-05-21

+ [调整] 画布详情页 Config 节点生图次数默认值：之前硬编码 `3`（4 处）。现在跟 size 一样走 `useAiConfigStore.config.count` → `defaultConfig.count` 的回退链，新建节点使用当前账号的偏好（默认新用户 1）。已存的旧节点 metadata 里的 3 不变，手动改一次或重新建节点即可。
+ [新增] 管理后台增加「生图记录」菜单 `/admin/generations`：跨用户分页展示所有生图调用（用户名、模式、状态、成功/总数、模型、尺寸、耗时、时间），支持按用户名/提示词关键词搜索与状态筛选；点击行可看到完整提示词、参考图、生成结果缩略图。
+ [新增] 管理后台增加「积分流水」菜单 `/admin/credit-logs`：跨用户分页展示所有积分变动，附带操作员用户名（管理员调整）和备注，支持按用户名/备注/模型关键词搜索与类型筛选。
+ [新增] 后端新增 `GET /api/admin/generations` 与 `GET /api/admin/credit-logs`，仅管理员可调用；列表会一次性 join `users` 表把 `username` 填到响应里。

## v0.0.9 - 2026-05-21

+ [修复] 生图工作台「重试」流程只更新本地 state、不写库：刷新页面后重试出来的图和参考图都丢失。现在重试成功后会带 `id` 调 `saveGeneration` upsert，同时把当前的 references 也写入记录，刷新后能完整恢复。
+ [新增] `generations` 表加 `references` 字段（JSON 数组，存参考图 storageKey），切换历史记录时左侧参考图能恢复，跨设备/换浏览器同样可见。
+ [安全] 后端 `service.SaveGeneration`：传入的 id 必须是当前用户自己的记录，否则报"权限不足"；id 指向不存在的记录直接报错而不是创建，避免客户端伪造 id。

## v0.0.8 - 2026-05-21

+ [调整] 图片不再以 BLOB 存数据库，改为落盘到 `IMAGE_DIR`（默认 `data/uploads`）目录，DB `images` 表只保留 `path` 元数据。Docker 镜像和 `docker-compose.yml` 已带挂载，升级老库不做迁移（按 AGENTS 约定），旧 BLOB 数据失效请重新生成或重新上传。
+ [调整] `GET /api/images/:id` 改为公开访问（id 是 UUID 不可枚举），方便 `<img src="/api/images/{id}">` 直接渲染；上传仍需登录，DELETE 仍需 owner。上传接口响应新增 `url` 字段。
+ [调整] 前端 `resolveImageUrl` 跨刷新场景不再 fetch + ObjectURL，直接返回相对 URL `/api/images/{id}`；本地刚上传的图仍走 ObjectURL 避免多一次往返。
+ [修复] 生产环境 nginx 上传图片返回 413：服务器 nginx 配置加上 `client_max_body_size 50M;`，并新增 `/api/images` 长接口 location（`proxy_request_buffering off`、`proxy_read_timeout 600s`）。

## v0.0.7 - 2026-05-21

+ [新增] 生图工作台支持深链：点击左侧生成记录会把 URL 切到 `/image/{id}`，直接访问 `/image/{id}` 也会自动展开对应记录，可以收藏/分享/刷新。生成新图后 URL 也会切到新记录的 id。
+ [调整] 生图历史里图片缓存丢失（多发生在换浏览器、清缓存、隐身模式）时，原本会被当成"生成失败"展示。现在用独立的琥珀色「图片缓存丢失」卡片与真实失败区分，并解释原因；底层数据/提示词/参数仍可查看，仅原图无法找回。
+ [新增] 图片二进制全面上云：新增 `images` 表（owner 隔离）+ `/api/images` 上传/读取/删除接口；前端 `uploadImage` 改为 POST 到服务端，`resolveImageUrl` 改为带 JWT 拉取后构造 ObjectURL。画布节点、参考图、生图结果、素材等所有 27 处调用点不变，新数据天然跨设备可见，彻底解决换浏览器/清缓存丢图的根因。迁移前 `image:` 前缀的旧 storageKey 仍兜底读取原浏览器 IndexedDB，新写入一律走服务器。
+ [新增] 用户生图默认偏好（`quality`、`size`、`count`）上云到 `users.preferences`，新增 `PUT /api/user/preferences` 接口；登录后从服务端拉取覆盖本地，修改后 600ms 防抖推送。换设备/换浏览器都能保留个人偏好。
+ [清理] 移除未被任何模块引用的 `web/src/lib/localforage-storage.ts` 死代码。

## v0.0.6 - 2026-05-20

+ [修复] 生图工作台 `/image` 在生成记录列表里切换记录时，左侧提示词/参考图/生成次数/尺寸/质量没有回填，右侧"生成结果"对全失败记录显示空白。现在切换记录会同步回填表单（参考图除外，历史未存原图），全失败记录会按张数渲染失败占位卡片。
+ [修复] 生产环境（`next start`）下生图、图生图请求经反向代理时仍然出现 504 Gateway Time-out。原因是 `next start` 的 rewrites 内部也存在响应头超时（约 30 秒），与 dev 模式同病。现在生产模式也走 `src/app/api/v1/images/*` 的 Route Handler，与 dev 行为统一，并把 `maxDuration` 设为 5 分钟；同时 nginx 反代配置 `/api/v1/` 长接口 `proxy_read_timeout 300s` + `proxy_buffering off`。

## v0.0.5 - 2026-05-20

+ [新增] 管理后台增加「用户管理」菜单，支持账号 CRUD、设置普通/管理员角色和生图额度。
+ [新增] 管理后台增加「模型配置」菜单，支持多套 Base URL/API Key/图像与文本模型，可启用其中一个并提供连通测试。
+ [调整] AI 调用改为后端反代 `/api/v1/images/generations`、`/api/v1/images/edits`、`/api/v1/chat/completions`，API Key 不再下发到前端，前台配置弹窗下线。
+ [新增] 普通用户每生成成功一张图片扣 1 点额度，余额不足时禁止调用并提示联系管理员；管理员账号不消耗额度。
+ [新增] 文本问答按用户限流，每分钟最多 5 次。
+ [新增] 重新开放注册，新注册账号默认赠送 4 次生图额度。
+ [调整] 前台顶部用户区显示剩余生图额度，仅管理员能看到「管理后台」入口。
+ [新增] 我的画布、我的素材、生图历史改为按用户隔离，画布数据与历史记录上云同步到后端数据库。
+ [新增] 个人中心 `/profile`：展示当前积分、累计消耗、累计获赠、生图次数和分页积分流水。
+ [新增] 注册赠送、管理员调整额度、生图扣减都会写入积分流水。
+ [调整] 默认生成尺寸调整为 `auto`、默认生成次数调整为 `1`；旧用户本地保存的偏好会一次性重置。
+ [调整] `/canvas`、`/image`、`/assets`、`/profile` 需要登录后才能访问；未登录会被跳转到 `/login`。
+ [调整] 浏览器本地图片缓存按用户 ID 分桶（`image_files_${userId}`），换账号互不可见。
+ [新增] 管理后台「模型配置」新增/编辑弹窗支持「获取模型列表」按钮，填好 Base URL 和 API Key 后可一键拉取上游 `/v1/models`，并把结果作为图像/文本模型输入框的下拉建议；新增配置时默认填入聊天模型 `gpt-5.4`、生图模型 `gpt-image-2`。
+ [修复] 生图、图生图请求经 Next.js dev rewrites 转发时，超过 30 秒会被切断返回 `Internal Server Error / socket hang up`。dev 模式改走 Route Handler 直转后端绕过超时，生产模式（`next start`）仍由 rewrites 直接代理避免多一跳 Node 中转；同时新增 `dev:turbo` 脚本可选 Turbopack。
+ [调整] 画布详情页（`/canvas/[id]`）顶部浮动条新增积分 Tag，普通用户显示「N 积分」、管理员显示「∞」，点击跳转 `/profile`，行为与首页顶栏一致。

## v0.0.4 - 2026-05-20


+ [调整] Docker 运行入口改为 Next.js 对外提供页面，`/api/*` 由 Next.js 代理到内部 Go 服务。
+ [修复] 文本复制在局域网 IP 访问时可能失败的问题。

## v0.0.3 - 2026-05-19

+ [修复] 更新 nanoid 依赖并修改 ID 生成方式，防止其他ip无法使用crypto模块导致的ID生成失败问题。

## v0.0.2 - 2026-05-19

+ [新增] 增加生图工作台功能，支持文生图、图生图、查看历史记录，并增加移动端适配。
+ [修复] 画布生成尺寸控件支持选择更多常用比例，并可直接输入自定义比例。
+ [修复] 生成配置节点恢复拖拽操作，避免面板控件拦截整块节点拖动。
+ [调整] `next.config.ts` 开启 `typescript.ignoreBuildErrors`，允许 build 阶段跳过 TypeScript 错误，避免开发期类型未完全收敛阻塞镜像构建。
+ [文档] 增加 Render 部署说明。

## v0.0.1 - 2026-05-19

+ [新增] 首次开源版本，包含无限画布能力：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
+ [新增] AI 创作能力：支持 OpenAI 兼容接口的文生图、图生图、参考图编辑和文本问答。
+ [新增] 画布助手能力：支持围绕选中节点和上游节点对话、生图，并把结果插回画布。
+ [新增] 提示词库能力：抓取多个 GitHub 开源项目，按案例整理数百个图片提示词。
