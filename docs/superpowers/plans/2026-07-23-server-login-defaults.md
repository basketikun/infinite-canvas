# 服务端登录默认行为 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将服务端账户入口放入画布右上角，并使服务端/本地模式和主题默认值符合已确认的优先级规则。

**Architecture:** `use-config-store` 负责保存模式、用户手动偏好标记及自动决策，所有 UI 入口只调用其公共动作。`ClientRootInit` 在认证会话完成水合后应用首次默认值；公共顶栏操作组件复用认证 store 提供登录、切换与退出操作。

**Tech Stack:** React 19、TypeScript、Zustand persist、Ant Design、Lucide、Bun test、Vite。

---

### Task 1: 为模式默认规则建立可测试的 store API

**Files:**
- Modify: `web/src/stores/use-config-store.ts`
- Modify: `web/src/stores/use-config-store.remote.test.ts`
- Create: `web/src/stores/use-theme-store.test.ts`

- [x] **Step 1: 编写失败的模式偏好测试**

在 `web/src/stores/use-config-store.remote.test.ts` 追加：

```ts
test("未手动选择时按有效服务端会话决定默认模式", () => {
    useConfigStore.setState({ channelModePreferenceSet: false, config: { ...defaultConfig, channelMode: "local" } });
    useConfigStore.getState().applyDefaultChannelMode(true);
    expect(useConfigStore.getState().config.channelMode).toBe("remote");

    useConfigStore.setState({ channelModePreferenceSet: false });
    useConfigStore.getState().applyDefaultChannelMode(false);
    expect(useConfigStore.getState().config.channelMode).toBe("local");
});

test("手动选择模式后自动默认逻辑不得覆盖选择", () => {
    useConfigStore.setState({ channelModePreferenceSet: false, config: { ...defaultConfig, channelMode: "remote" } });
    useConfigStore.getState().setChannelMode("local");
    useConfigStore.getState().applyDefaultChannelMode(true);
    expect(useConfigStore.getState().config.channelMode).toBe("local");
    expect(useConfigStore.getState().channelModePreferenceSet).toBeTrue();
});
```

同时创建 `web/src/stores/use-theme-store.test.ts`：

```ts
import { expect, test } from "bun:test";
import { useThemeStore } from "./use-theme-store";

test("主题 store 对没有持久化偏好的用户默认使用浅色", () => {
    expect(useThemeStore.getState().theme).toBe("light");
});
```

- [x] **Step 2: 运行测试确认失败**

运行：`bun test src/stores/use-config-store.remote.test.ts src/stores/use-theme-store.test.ts`

预期：模式 API 不存在，且主题断言期望 `light` 但当前为 `dark`。

- [x] **Step 3: 实现最小模式 API 与浅色默认值**

在 `ConfigStore` 添加：

```ts
channelModePreferenceSet: boolean;
setChannelMode: (mode: AiConfig["channelMode"], userInitiated?: boolean) => void;
applyDefaultChannelMode: (remoteAvailable: boolean) => void;
```

默认值为 `channelModePreferenceSet: false`；`setChannelMode` 更新 `config.channelMode`，并在 `userInitiated !== false` 时将标记设为 `true`。`applyDefaultChannelMode` 仅当标记为 `false` 时，写入 `remoteAvailable ? "remote" : "local"`。在 `partialize` 中持久化标记，在 `merge` 中以 `persistedState.channelModePreferenceSet === true` 恢复。将 `use-theme-store.ts` 初始主题改成 `light`。

- [x] **Step 4: 运行 store 测试确认通过**

运行：`bun test src/stores/use-config-store.remote.test.ts src/stores/use-theme-store.test.ts`

预期：所有断言通过。

- [x] **Step 5: 提交 store 改动**

运行：

```bash
git add web/src/stores/use-config-store.ts web/src/stores/use-config-store.remote.test.ts web/src/stores/use-theme-store.ts web/src/stores/use-theme-store.test.ts
git commit -m "feat(web): persist server mode preference"
```

### Task 2: 在会话水合后应用首次模式默认值

**Files:**
- Modify: `web/src/components/layout/client-root-init.tsx`

- [x] **Step 1: 更新初始化订阅与 effect**

订阅 `useUserStore` 的 `isReady` 和 `useConfigStore` 的 `applyDefaultChannelMode`。在调用 `hydrateUser` 的 effect 后新增：

```ts
useEffect(() => {
    if (!isUserReady) return;
    applyDefaultChannelMode(Boolean(token && CONTROL_PLANE_URL));
}, [applyDefaultChannelMode, isUserReady, token]);
```

这保证失效令牌被认证请求清除后才落到本地直连，且用户手动偏好不会被覆盖。

- [x] **Step 2: 类型检查验证**

运行：`bun run typecheck`

预期：退出码为 0。

- [x] **Step 3: 提交初始化改动**

运行：

```bash
git add web/src/components/layout/client-root-init.tsx
git commit -m "feat(web): choose channel mode after session hydration"
```

### Task 3: 在右上角提供服务端账户入口

**Files:**
- Modify: `web/src/components/layout/user-status-actions.tsx`
- Modify: `web/src/components/layout/app-config-modal.tsx`

- [x] **Step 1: 在公共顶栏操作组件添加账户登录与菜单**

在 `UserStatusActions` 引入 `App`、`Dropdown`、`Form`、`Input`、`Modal`、`LogIn`、`UserRound`、`CONTROL_PLANE_URL`、`useUserStore` 和 `useState`。当控制平面 URL 存在时：

- 无令牌显示含 `LogIn` 图标的“登录服务端”按钮，点击打开 `Modal`；表单使用用户名和密码调用 `login`。
- 成功后调用 `setChannelMode("remote", false)`、关闭弹窗并用 `message.success` 提示。
- 已登录显示用户名下拉菜单，菜单项目调用 `setChannelMode("remote")` 或 `setChannelMode("local")`，并以当前模式禁用对应项目；退出调用 `clearSession()` 和 `setChannelMode("local", false)`。

按钮沿用 `naturalIconClass`、`iconStyle` 与 `canvas` 变体，令普通页和画布页共享一致行为。密码或网络错误通过 `message.error` 显示。

- [x] **Step 2: 让设置窗口复用 store 动作**

在 `AppConfigPanel` 订阅 `setChannelMode`。将 Segmented 的 `onChange` 从：

```tsx
onChange={(value) => updateConfig("channelMode", value as AiConfig["channelMode"])}
```

改为：

```tsx
onChange={(value) => setChannelMode(value as AiConfig["channelMode"])}
```

将登录成功分支改为：

```ts
.then(() => {
    setChannelMode("remote", false);
    message.success("已登录控制平面");
})
```

- [x] **Step 3: 运行类型检查与前端构建**

运行：

```bash
bun run typecheck
bun run build
```

预期：两个命令退出码均为 0。

- [x] **Step 4: 提交账户入口改动**

运行：

```bash
git add web/src/components/layout/user-status-actions.tsx web/src/components/layout/app-config-modal.tsx
git commit -m "feat(web): add top bar server login"
```

### Task 4: 全量验证与发布准备

**Files:**
- Verify only: `web/src/**`

- [x] **Step 1: 运行前端单元测试**

运行：`bun test`

预期：所有 Bun 测试通过。

- [x] **Step 2: 重新运行生产检查**

运行：

```bash
bun run typecheck
bun run build
git diff --check
git status --short --branch
```

预期：类型检查、构建和差异检查通过，工作树仅可能显示本计划文档。

- [x] **Step 3: 提交计划文档并推送当前分支**

运行：

```bash
git add docs/superpowers/plans/2026-07-23-server-login-defaults.md
git commit -m "docs: plan server login defaults"
git push origin integration/backend-control-plane
```

预期：所有本次提交推送至 `origin/integration/backend-control-plane`，随后可由发布工作流构建新的 web 镜像。
