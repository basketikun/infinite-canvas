# 新版画布服务端模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development.

**Goal:** 让当前 Vite 画布保留本地直连模式，并可在登录后切换到由 Go 控制平面代理的服务端模式。

**Architecture:** 新增 `web/src/services/control-plane/` 作为唯一后端客户端；`use-config-store` 不再强制 `channelMode: local`。服务端模式构造虚拟 `server` 渠道，并只用用户 Bearer token 调用 `/api/v1`，不读取或持久化供应商 API Key。

### Task 1: 认证和控制平面客户端

**Files:** Create `web/src/services/control-plane/{client,auth,types}.ts` and `*.test.ts`; modify `web/src/stores/use-user-store.ts`, `web/src/constant/runtime-config.ts`.

- [ ] 用 Bun test 先写 `/api/auth/login`、`/api/auth/me` 的请求、错误 envelope 和 `Authorization: Bearer` 测试。
- [ ] 实现 `requestControlPlane<T>(path, init, token)`：基础 URL 读取 `VITE_CONTROL_PLANE_URL`，只接受 `{code:0,data}`，非零 code 抛出 `msg`。
- [ ] 将 `LocalUser` 扩展为 v0.3.0 `AuthUser` 字段，持久化 token，并在应用启动调用 `fetchCurrentUser` 验证/清理过期会话。
- [ ] 新增 `/login` 路由和简洁中文登录页；未登录时本地模式仍可完整使用。
- [ ] 运行 `bun test web/src/services/control-plane`、`bun run typecheck`，提交 `feat(web): add control plane session`。

### Task 2: 模型与请求适配

**Files:** Modify `web/src/stores/use-config-store.ts`, `web/src/services/api/{image,video,audio}.ts`, `web/src/components/model-picker.tsx`, `web/src/components/layout/app-config-modal.tsx`.

- [ ] 先测试：服务端模式下模型来自 `/api/settings` 的公开 `availableModels`，配置 UI 不显示渠道 API Key 输入。
- [ ] 增加 `channelMode` 分支：`local` 保持现有 `resolveModelRequestConfig`；`remote` 将图片、聊天、音频、视频、参考媒体路径映射为 `/api/v1/*` 并带用户 token。
- [ ] 删除 `useEffectiveConfig` 中硬编码的 `channelMode: "local"`；服务端模式使用固定虚拟渠道，不接受浏览器自定义 `baseUrl` 或 `apiKey`。
- [ ] 为模式选择使用分段控制，显示登录状态、余额和服务端模型；失败时保留本地模式配置。
- [ ] 用 MSW 或原生 `fetch` mock 覆盖图片、聊天、视频和无 token 拒绝路径；运行 `bun test`、`bun run typecheck`、`bun run build`。
- [ ] 提交 `feat(web): add remote model mode`。

### Task 3: 端到端部署验收

**Files:** Modify root Docker/Compose deployment docs and `pending-test.mdx`.

- [ ] Compose 加入当前 Vite web 服务，设置 `VITE_CONTROL_PLANE_URL` 与控制平面允许来源。
- [ ] 验证本地模式可不登录生效；服务端模式登录后调用仅命中 Go `/api/v1`，浏览器 DevTools 中没有供应商 Key。
- [ ] 记录图片、聊天、音频、视频、积分扣减与失败退款的人工验收项并提交。
